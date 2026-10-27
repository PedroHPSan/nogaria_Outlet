// Sacolas de venda pelo WhatsApp: separar → pagar → entregar, sobre a tabela `orcamentos`
// (origem 'whatsapp'). Pagar reaproveita confirmarVenda (1 registrarVenda por SKU).
import { supabase } from "./supabase";
import { gerarSlug } from "./catalogoPublico";
import { EMPRESA } from "./empresa";
import { marcarEntregue } from "./vendas";
import { listarOrcamentos, confirmarVenda, cancelarOrcamento, mudarStatus } from "./orcamentos";
import { codigoOrcamento, proximoSeq, totais, prazoSacola, reservaAtiva } from "./orcamentosCore";
import { sacolaAbertaDe, adicionarItem, removerItem, soDigitos } from "./sacolasCore";

export const listarSacolas = async (opts = {}) =>
  (await listarOrcamentos(opts)).filter((o) => o.origem === "whatsapp");

async function codigoNovo() {
  const { data } = await supabase.from("orcamentos").select("codigo").order("codigo", { ascending: false }).limit(1);
  return codigoOrcamento(proximoSeq(data?.[0]?.codigo || null));
}

// Separa 1 item para o cliente: cria a sacola (se não houver aberta) ou soma nela, e reserva
// o item até o prazo. Recusa item reservado por outra sacola ou fora de estoque.
export async function separar(item, cliente, user) {
  const { data: atual, error } = await supabase.from("itens")
    .select("sku, status, reservado_ate, reservado_por_orc").eq("sku", item.sku).single();
  if (error) throw error;
  if (["VENDIDO", "ENTREGUE", "DESCARTE"].includes(atual.status)) throw new Error(`${item.sku}: fora de estoque.`);

  const sacolas = await listarSacolas({ status: "ABERTA" });
  const existente = sacolaAbertaDe(sacolas, cliente);
  if (reservaAtiva(atual) && atual.reservado_por_orc !== existente?.codigo)
    throw new Error(`${item.sku}: já separado em ${atual.reservado_por_orc}.`);

  const itens = adicionarItem(existente?.itens, item);
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
  const { error: e2 } = await supabase.from("itens")
    .update({ reservado_ate: validade, reservado_por_orc: sacola.codigo, upd_by: user?.email })
    .in("sku", itens.map((i) => i.sku));
  if (e2) throw e2;
  return sacola;
}

export async function tirarDaSacola(sacola, sku) {
  const itens = removerItem(sacola.itens, sku);
  await supabase.from("itens").update({ reservado_ate: null, reservado_por_orc: null }).eq("sku", sku).eq("reservado_por_orc", sacola.codigo);
  if (!itens.length) return cancelarOrcamento(sacola);
  const { data, error } = await supabase.from("orcamentos")
    .update({ itens, total: totais(itens, sacola.desconto_pct).total, atualizado_em: new Date().toISOString() })
    .eq("id", sacola.id).select("*").single();
  if (error) throw error;
  return data;
}

// Pagamento confirmado: os itens viram VENDIDO (canal WhatsApp) e a sacola guarda forma/valor.
export async function registrarPagamento(sacola, { forma, valor }, user) {
  const pago = Number(valor);
  if (!(pago > 0)) throw new Error("Informe o valor recebido.");
  const vendida = await confirmarVenda(sacola, user, { canal: "WhatsApp" });
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
