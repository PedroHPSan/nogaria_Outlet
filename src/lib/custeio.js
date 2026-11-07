// Custeio do lote: modo 'rateio' (valor do lote fixo, rateado entre os itens) ou 'soma' (custo do lote =
// soma do custo direto dos itens), mais custos adicionais (frete, separador…) no lote ou num item.
// O banco mantém lotes.custo_total e pricing_lote_custo por trigger (migration custeio_lote_produto).
import { supabase } from "./supabase";
import { limparCache } from "./motorPrecoDb";
import { loteSemCusto } from "./custoLote.js";

export { TIPOS_EXTRA, rotuloTipo, toNum, emTexto, formInicial, totalPrevisto, lerColado } from "./custeioCore.js";
import { toNum, formInicial } from "./custeioCore.js";

// Todas as páginas (PostgREST corta em 1.000).
async function paginado(montar) {
  let out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await montar().range(from, from + 999);
    if (error) throw error;
    out = out.concat(data || []);
    if (!data || data.length < 1000) break;
  }
  return out;
}

export const carregarItensCusto = (lote) =>
  paginado(() => supabase.from("itens")
    .select("sku,produto,status,custo_direto,valor_vendido,preco_sugerido").eq("lote", lote).order("sku"));

export async function carregarExtras(lote) {
  const { data, error } = await supabase.from("lote_custos_extra").select("id,sku,tipo,descricao,valor").eq("lote", lote).order("id");
  if (error) throw error;
  return data || [];
}

export async function salvarCusteio({ lote, form, diretosAlterados }) {
  const valor = toNum(form.valor);
  if (form.modo === "rateio" && !(valor > 0)) throw new Error("Informe o valor pago pelo lote.");
  const { data: u } = await supabase.auth.getUser();
  const email = u?.user?.email || null;

  // 1) custo direto dos itens primeiro (o trigger do modo "soma" recalcula a cada item)
  const entradas = Object.entries(diretosAlterados);
  for (let i = 0; i < entradas.length; i += 20) {
    const res = await Promise.all(entradas.slice(i, i + 20).map(([sku, v]) =>
      supabase.from("itens").update({ custo_direto: toNum(v), upd_by: email }).eq("sku", sku)));
    const falha = res.find((r) => r.error);
    if (falha) throw falha.error;
  }
  // 2) adicionais: substitui a lista inteira do lote
  const del = await supabase.from("lote_custos_extra").delete().eq("lote", lote.lote);
  if (del.error) throw del.error;
  const linhas = form.extras.filter((e) => toNum(e.valor) > 0).map((e) => ({
    lote: lote.lote, sku: e.sku.trim() || null, tipo: e.tipo, descricao: e.descricao.trim() || null,
    valor: toNum(e.valor), criado_por: email,
  }));
  if (linhas.length) {
    const ins = await supabase.from("lote_custos_extra").insert(linhas);
    if (ins.error) throw ins.error;
  }
  // 3) o lote vira "composto"; fretes/outros legados já foram para os adicionais
  const comissao = toNum(form.comissao) ?? 0, taxa = toNum(form.taxa) ?? 0;
  const up = await supabase.from("lotes").update({
    modo_custeio: form.modo, custo_origem: "composto",
    lance_final: form.modo === "rateio" ? valor : (lote.lance_final ?? null),
    comissao_leiloeiro: form.modo === "rateio" ? comissao : (lote.comissao_leiloeiro ?? null),
    taxa_hisa: form.modo === "rateio" ? taxa : (lote.taxa_hisa ?? null),
    valor_pago_hisa: form.modo === "rateio" ? valor + comissao + taxa : (lote.valor_pago_hisa ?? null),
    frete_retirada: null, frete_transferencia: null, outros_custos: null,
  }).eq("lote", lote.lote);
  if (up.error) throw up.error;
  limparCache();
}


// Custo de UMA peça (ficha do item). Lote sem custo → vira "por peça" (soma dos itens); lote composto → só o custo direto;
// lote legado com custo geral → recusa com a explicação (não descarta o custo que já existe).
export async function salvarCustoItem({ lote, item, valor }) {
  const v = toNum(valor);
  if (v == null || v < 0) throw new Error("Informe um valor válido.");
  if (!lote) throw new Error("Esta peça não tem lote.");
  if (lote.custo_origem === "composto") {
    const { data: u } = await supabase.auth.getUser();
    const r = await supabase.from("itens").update({ custo_direto: v, upd_by: u?.user?.email || null }).eq("sku", item.sku);
    if (r.error) throw r.error;
    limparCache();
    return { convertido: false };
  }
  if (!loteSemCusto(lote)) {
    throw new Error(`O lote ${lote.lote} já tem um custo geral cadastrado. Para dar custo por peça, abra "Custo do lote" e escolha "Soma dos itens".`);
  }
  const form = { ...formInicial(lote, await carregarExtras(lote.lote)), modo: "soma" };
  await salvarCusteio({ lote, form, diretosAlterados: { [item.sku]: String(v).replace(".", ",") } });
  return { convertido: true };
}
