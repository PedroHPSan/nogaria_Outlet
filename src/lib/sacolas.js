// Sacolas de venda pelo WhatsApp: separar → pagar → entregar, sobre a tabela `orcamentos`
// (origem 'whatsapp'). Pagar reaproveita confirmarVenda (1 registrarVenda por SKU).
import { supabase } from "./supabase";
import { gerarSlug } from "./catalogoPublico";
import { EMPRESA } from "./empresa";
import { marcarEntregue } from "./vendas";
import { listarOrcamentos, confirmarVenda, cancelarOrcamento, mudarStatus } from "./orcamentos";
import { codigoOrcamento, proximoSeq, totais, prazoSacola } from "./orcamentosCore";
import { sacolaAbertaDe, adicionarItem, removerItem, soDigitos, PRAZOS_RENOVACAO } from "./sacolasCore";

export const listarSacolas = async (opts = {}) =>
  (await listarOrcamentos(opts)).filter((o) => o.origem === "whatsapp");

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
  const validade = prazoSacola();
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
    p_origem_ref: sacola.codigo, p_expira_em: validade, p_user: user?.email,
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
  const { error: eLib } = await supabase.rpc("liberar_reserva", { p_origem_tipo: "sacola", p_origem_ref: sacola.codigo, p_sku: sku });
  if (eLib) throw eLib;
  if (!itens.length) return cancelarOrcamento(sacola);
  const { data, error } = await supabase.from("orcamentos")
    .update({ itens, total: totais(itens, sacola.desconto_pct).total, atualizado_em: new Date().toISOString() })
    .eq("id", sacola.id).select("*").single();
  if (error) throw error;
  return data;
}

// Pagamento confirmado: os itens viram VENDIDO (canal WhatsApp) e a sacola guarda forma/valor.
// Antes de baixar, a RPC sacola_preparar_pagamento resolve itens cuja campanha já terminou: sem `manterPromo` ela recusa
// com DECISAO_CAMPANHA (a tela pergunta); true mantém o preço promocional, false cobra o preço cheio atual.
export async function registrarPagamento(sacola, { forma, valor }, user, { manterPromo = null } = {}) {
  const pago = Number(valor);
  if (!(pago > 0)) throw new Error("Informe o valor recebido.");
  const { data: pronta, error: eP } = await supabase.rpc("sacola_preparar_pagamento", {
    p_id: sacola.id, p_manter_promo: manterPromo, p_user: user?.email ?? null,
  });
  if (eP) throw eP;
  const vendida = await confirmarVenda(pronta, user, { canal: "WhatsApp" });
  const { data, error } = await supabase.from("orcamentos")
    .update({ pago_em: new Date().toISOString(), forma_pagamento: forma || null, valor_pago: pago })
    .eq("id", vendida.id).select("*").single();
  if (error) throw error;
  return data;
}

export async function registrarEntrega(sacola, user) {
  for (const i of sacola.itens) await marcarEntregue(i.sku, user);
  return mudarStatus(sacola, "ENTREGUE", { entregue_em: new Date().toISOString() });
}

export { cancelarOrcamento as cancelarSacola };
