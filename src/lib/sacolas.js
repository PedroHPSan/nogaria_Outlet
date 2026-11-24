// Sacolas de venda pelo WhatsApp: separar → pagar → entregar, sobre a tabela `orcamentos`
// (origem 'whatsapp'). Pagar = recebimentos em `orcamento_pagamentos` (parcial, várias formas, crediário); só na
// quitação (ou liberação por gestor com saldo) os itens são baixados via confirmarVenda (1 registrarVenda por SKU).
import { supabase } from "./supabase";
import { gerarSlug } from "./catalogoPublico";
import { EMPRESA } from "./empresa";
import { marcarEntregue } from "./vendas";
import { listarOrcamentos, confirmarVenda, cancelarOrcamento, mudarStatus } from "./orcamentos";
import { codigoOrcamento, proximoSeq, totais, prazoSacola } from "./orcamentosCore";
import { sacolaAbertaDe, adicionarItem, removerItem, soDigitos, PRAZOS_RENOVACAO, FORMAS_COM_TAXA } from "./sacolasCore";

export const listarSacolas = async (opts = {}) =>
  (await listarOrcamentos(opts)).filter((o) => o.origem === "whatsapp");

// Sacolas com `pagamentos` (todos, inclusive estornados) e `parcelas` (plano de crediário) anexados — para a tela de sacolas.
export async function listarSacolasComFinanceiro(opts = {}) {
  const lista = await listarSacolas(opts);
  const pagamentos = new Map(), parcelas = new Map();
  for (let i = 0; i < lista.length; i += 100) {
    const ids = lista.slice(i, i + 100).map((s) => s.id);
    const [a, b] = await Promise.all([
      supabase.from("orcamento_pagamentos").select("*").in("orcamento_id", ids).order("recebido_em").order("criado_em"),
      supabase.from("orcamento_parcelas").select("*").in("orcamento_id", ids).order("numero"),
    ]);
    if (a.error) throw a.error;
    if (b.error) throw b.error;
    for (const p of a.data) pagamentos.set(p.orcamento_id, [...(pagamentos.get(p.orcamento_id) || []), p]);
    for (const p of b.data) parcelas.set(p.orcamento_id, [...(parcelas.get(p.orcamento_id) || []), p]);
  }
  return lista.map((s) => ({ ...s, pagamentos: pagamentos.get(s.id) || [], parcelas: parcelas.get(s.id) || [] }));
}

async function codigoNovo() {
  const { data } = await supabase.from("orcamentos").select("codigo").order("codigo", { ascending: false }).limit(1);
  return codigoOrcamento(proximoSeq(data?.[0]?.codigo || null));
}

// Separa 1 item para o cliente: cria a sacola (se não houver aberta) ou soma nela, e reserva
// todos os itens dela até o prazo (RPC `reservar_itens`, atômica). Se a reserva falhar (item
// separado por outra origem ou fora de estoque), desfaz a alteração na sacola.
// Promoção vigente do item para a sacola (linha de precos_efetivos) ou null. O preço vem SEMPRE do servidor.
// Item que o bot do WhatsApp já tinha reservado vale pelo momento do pedido (reservas.criado_em), não pelo de agora.
export async function promoParaSacola(item) {
  try {
    const { data: r } = await supabase.from("reservas").select("criado_em")
      .eq("sku", item.sku).eq("status", "ATIVA").eq("origem_tipo", "carrinho_wa").maybeSingle();
    const { data, error } = await supabase.rpc("precos_efetivos", { p_skus: [item.sku], p_canal: "whatsapp", p_em: r?.criado_em || new Date().toISOString() });
    if (error) return null;
    return (data || []).find((x) => x.campanha_id) || null;
  } catch { return null; }
}

export async function separar(item, cliente, user) {
  const sacolas = await listarSacolas({ status: "ABERTA" });
  const existente = sacolaAbertaDe(sacolas, cliente);

  const itens = adicionarItem(existente?.itens, item, await promoParaSacola(item));
  const t = totais(itens, existente?.desconto_pct || 0);
  const comPagamento = Number(existente?.valor_pago) > 0;  // com pagamento a separação não vence (só cancelamento expresso)
  const validade = comPagamento ? existente.validade : prazoSacola();
  let sacola = existente;
  if (existente) {
    const { data, error: e } = await supabase.from("orcamentos")
      .update({ itens, total: t.total, validade, atualizado_em: new Date().toISOString() })
      .eq("id", existente.id).select("*").single();
    if (e) throw e;
    sacola = data;
  } else {
    for (let tentativa = 0; tentativa < 3 && !sacola; tentativa++) {
      const { data, error: e } = await supabase.from("orcamentos").insert({
        codigo: await codigoNovo(), slug: gerarSlug(), status: "ABERTA", origem: "whatsapp",
        itens, desconto_pct: 0, total: t.total, validade, criado_por: user?.email,
        cliente_nome: cliente.nome?.trim() || null, cliente_whatsapp: soDigitos(cliente.whatsapp) || null,
        vendedor_whatsapp: EMPRESA.whatsapp,
      }).select("*").single();
      if (!e) sacola = data;
      else if (e.code !== "23505") throw e;
    }
    if (!sacola) throw new Error("Não foi possível gerar o código da sacola. Tente novamente.");
  }
  // A validade da sacola vale para todos os itens dela.
  const { error: e2 } = await supabase.rpc("reservar_itens", {
    p_skus: itens.map((i) => i.sku), p_canal: "whatsapp", p_origem_tipo: "sacola",
    p_origem_ref: sacola.codigo, p_expira_em: comPagamento ? null : validade, p_user: user?.email,
  });
  if (e2) {
    if (existente) {
      await supabase.from("orcamentos")
        .update({ itens: existente.itens, total: existente.total, validade: existente.validade }).eq("id", existente.id);
    } else {
      await supabase.from("orcamentos").delete().eq("id", sacola.id);
    }
    throw e2;
  }
  return sacola;
}

// Reabre uma sacola vencida ou estende o prazo de uma a pagar (RPC atômica renovar_sacola: trava a linha, reserva
// TODOS os itens por `dias` a partir de agora e atualiza a validade; recusa tomar reserva do bot de outro cliente).
// Se algum item foi vendido ou separado por outra origem no meio tempo, a RPC recusa com o motivo e nada muda
// (a tela permite tirar o item da sacola e tentar de novo).
export async function renovarSacola(sacola, dias, user) {
  if (!PRAZOS_RENOVACAO.includes(Number(dias))) throw new Error("Prazo inválido.");
  const { data, error } = await supabase.rpc("renovar_sacola", { p_id: sacola.id, p_dias: Number(dias), p_user: user?.email });
  if (error) throw error;
  return data;
}

export async function tirarDaSacola(sacola, sku) {
  const itens = removerItem(sacola.itens, sku);
  const pago = Number(sacola.valor_pago) || 0;
  if (pago > 0 && totais(itens, sacola.desconto_pct).total < pago - 0.004) {
    throw new Error(`Já foram recebidos ${pago.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}, mais que o novo total. Estorne o excedente antes de tirar o item.`);
  }
  const { error: eLib } = await supabase.rpc("liberar_reserva", { p_origem_tipo: "sacola", p_origem_ref: sacola.codigo, p_sku: sku });
  if (eLib) throw eLib;
  if (!itens.length) return cancelarOrcamento(sacola);
  const { data, error } = await supabase.from("orcamentos")
    .update({ itens, total: totais(itens, sacola.desconto_pct).total, atualizado_em: new Date().toISOString() })
    .eq("id", sacola.id).select("*").single();
  if (error) throw error;
  return data;
}

// Recebimento (parcial ou total) de uma sacola. Fluxo:
//  1. ABERTA: sacola_preparar_pagamento resolve itens cuja campanha já terminou (sem `manterPromo` recusa com
//     DECISAO_CAMPANHA e a tela pergunta; true mantém a promoção, false cobra o preço cheio atual) e fecha o total.
//  2. pagamento_registrar grava o recebimento (recusa valor acima do saldo; `chave` torna a repetição inofensiva) e,
//     com pagamento, a separação deixa de vencer.
//  3. Se o saldo zerou numa sacola ABERTA, baixa os itens (confirmarVenda → VENDIDO). Se a baixa falhar, o pagamento
//     fica registrado e `concluirBaixa` repete só a baixa.
// Sacola já VENDIDA/ENTREGUE (liberada com saldo pelo gestor) só recebe o pagamento.
export async function registrarPagamento(sacola, { forma, valor, obs, parcelasCartao, taxaPct, chave, recebidoEm }, user, { manterPromo = null } = {}) {
  const pago = Number(valor);
  if (!(pago > 0)) throw new Error("Informe o valor recebido.");
  if (sacola.status === "ABERTA") {
    const { error: eP } = await supabase.rpc("sacola_preparar_pagamento", { p_id: sacola.id, p_manter_promo: manterPromo, p_user: user?.email ?? null });
    if (eP) throw eP;
  }
  const { data, error } = await supabase.rpc("pagamento_registrar", {
    p_orcamento: sacola.id, p_valor: pago, p_forma: forma, p_obs: obs || null,
    p_parcelas: forma === "Crédito" ? Number(parcelasCartao) || 1 : null,
    p_taxa: FORMAS_COM_TAXA.includes(forma) && taxaPct !== "" && taxaPct != null ? Number(taxaPct) : null,
    p_chave: chave || null, p_recebido_em: recebidoEm || null, p_user: user?.email ?? null,
  });
  if (error) throw error;
  return quitarSeCompleto(data, user);
}

async function quitarSeCompleto(orc, user) {
  if (orc.status !== "ABERTA") return orc;
  const { data: pgs, error } = await supabase.from("orcamento_pagamentos").select("valor").eq("orcamento_id", orc.id).is("estornado_em", null);
  if (error) throw error;
  const recebido = pgs.reduce((a, p) => a + Number(p.valor), 0);
  if (Number(orc.total) - recebido > 0.004) return orc;  // ainda falta: a sacola segue ABERTA, itens reservados
  return confirmarVenda(orc, user, { canal: "WhatsApp" });
}

// Pagamento já quitou a sacola mas a baixa dos itens não aconteceu (falha no meio): repete só a baixa.
export async function concluirBaixa(sacola, user) {
  const { data, error } = await supabase.from("orcamentos").select("*").eq("id", sacola.id).single();
  if (error) throw error;
  return quitarSeCompleto(data, user);
}

// Gestor: entrega/baixa a sacola com saldo em aberto (fiado). A trava é no banco (orcamentos_guarda_saldo): quem não é
// gestor recebe erro 42501 mesmo chamando a API direto. O saldo segue a receber, com os pagamentos seguintes.
export async function liberarComSaldo(sacola, user, { manterPromo = null } = {}) {
  const { error: eP } = await supabase.rpc("sacola_preparar_pagamento", { p_id: sacola.id, p_manter_promo: manterPromo, p_user: user?.email ?? null });
  if (eP) throw eP;
  const { data, error } = await supabase.from("orcamentos").select("*").eq("id", sacola.id).single();
  if (error) throw error;
  return confirmarVenda(data, user, { canal: "WhatsApp" });
}

// Gestor: estorna um recebimento (fica na trilha, com motivo). Nada é apagado.
export async function estornarPagamento(pagamento, motivo, user) {
  const { data, error } = await supabase.rpc("pagamento_estornar", { p_pagamento: pagamento.id, p_motivo: motivo, p_user: user?.email ?? null });
  if (error) throw error;
  return data;
}

// Plano de parcelas do crediário: [{ valor, vencimento: "AAAA-MM-DD" }] cuja soma é o total da sacola; [] apaga o plano.
export async function definirPlano(sacola, parcelas, user) {
  const { data, error } = await supabase.rpc("plano_parcelas_definir", { p_orcamento: sacola.id, p_parcelas: parcelas, p_user: user?.email ?? null });
  if (error) throw error;
  return data;
}

export async function registrarEntrega(sacola, user) {
  for (const i of sacola.itens) await marcarEntregue(i.sku, user);
  return mudarStatus(sacola, "ENTREGUE", { entregue_em: new Date().toISOString() });
}

export { cancelarOrcamento as cancelarSacola };
