// Custeio do lote: modo 'rateio' (valor do lote fixo, rateado entre os itens) ou 'soma' (custo do lote =
// soma do custo direto dos itens), mais custos adicionais (frete, separador…) no lote ou num item.
// O banco mantém lotes.custo_total e pricing_lote_custo por trigger (migration custeio_lote_produto).
import { supabase } from "./supabase";
import { limparCache } from "./motorPrecoDb";

export const TIPOS_EXTRA = [
  ["frete_retirada", "Frete de retirada"],
  ["frete_transferencia", "Frete de transferência"],
  ["separador", "Separador / mão de obra"],
  ["embalagem", "Embalagem"],
  ["impostos", "Impostos"],
  ["outros", "Outros"],
];
export const rotuloTipo = (t) => (TIPOS_EXTRA.find(([k]) => k === t) || [t, t])[1];

export const toNum = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
export const emTexto = (v) => (v == null ? "" : String(v).replace(".", ","));

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

// Estado inicial do formulário. Lote legado: o "valor do lote" parte de lance_final ou custo_total, e os
// fretes/outros que existiam em colunas viram lançamentos adicionais (a tela os grava como tal ao salvar).
export function formInicial(lote, extras) {
  const legado = lote.custo_origem !== "composto";
  const valor = lote.lance_final ?? (legado ? lote.custo_total : null);
  const comissao = lote.comissao_leiloeiro ?? (lote.lance_final != null ? Math.round(Number(lote.lance_final) * 5) / 100 : 0);
  const lista = extras.map((e) => ({ sku: e.sku || "", tipo: e.tipo, descricao: e.descricao || "", valor: emTexto(e.valor) }));
  if (legado) {
    for (const [col, tipo] of [["frete_retirada", "frete_retirada"], ["frete_transferencia", "frete_transferencia"], ["outros_custos", "outros"]]) {
      if (Number(lote[col]) > 0) lista.push({ sku: "", tipo, descricao: "", valor: emTexto(lote[col]) });
    }
  }
  return {
    modo: lote.modo_custeio || "rateio",
    valor: emTexto(valor), comissao: emTexto(comissao), taxa: emTexto(lote.taxa_hisa ?? 0),
    extras: lista,
  };
}

// Total calculado na tela (espelha custo_total_composto no banco).
export function totalPrevisto(form, diretos) {
  const extras = form.extras.reduce((s, e) => s + (toNum(e.valor) || 0), 0);
  const base = form.modo === "soma"
    ? Object.values(diretos).reduce((s, v) => s + (toNum(v) || 0), 0)
    : (toNum(form.valor) || 0) + (toNum(form.comissao) || 0) + (toNum(form.taxa) || 0);
  return { base, extras, total: base + extras };
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
