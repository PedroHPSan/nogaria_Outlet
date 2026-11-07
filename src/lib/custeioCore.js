// Custeio do lote (PURO, sem rede): formulário, totais e leitura de planilha colada. Importável em testes Node.
// A gravação fica em custeio.js. Spec/plano: módulo de gestão de custos dos lotes.
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


const SKU_RE = /\b[A-Z]{2,5}-\d+(?:-\d+)*\b/i;

/**
 * Lê custos colados da planilha. Aceita:
 *  • "SKU;valor" / "SKU valor" / "SKU<TAB>valor" (uma peça por linha) — casa pelo SKU;
 *  • uma coluna só de valores — vale na ORDEM dos itens (por sku).
 * Devolve { valores: {sku: "12,50"}, ignorados: [linhas], modo: "sku"|"ordem" }. Nunca grava nada.
 */
export function lerColado(texto, skus) {
  const linhas = String(texto || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const valores = {}, ignorados = [];
  const comSku = linhas.filter((l) => SKU_RE.test(l));
  if (comSku.length) {
    const validos = new Set((skus || []).map((s) => s.toUpperCase()));
    for (const l of linhas) {
      const m = l.match(SKU_RE);
      if (!m) { ignorados.push(l); continue; }
      const sku = m[0].toUpperCase();
      const v = toNum(l.replace(m[0], "").replace(/R\$/gi, "").replace(/[;\t]+/g, " ").trim());
      if (!validos.has(sku) || !(v >= 0) || v == null) ignorados.push(l);
      else valores[sku] = emTexto(v);
    }
    return { valores, ignorados, modo: "sku" };
  }
  const ordem = [...(skus || [])].sort();
  linhas.forEach((l, i) => {
    const v = toNum(l.replace(/R\$/gi, "").trim());
    if (v == null || !(v >= 0) || i >= ordem.length) ignorados.push(l); else valores[ordem[i]] = emTexto(v);
  });
  return { valores, ignorados, modo: "ordem" };
}
