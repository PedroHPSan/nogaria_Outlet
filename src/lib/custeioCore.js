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
  const lista = extras.map((e) => ({ id: e.id ?? null, sku: e.sku || "", tipo: e.tipo, descricao: e.descricao || "", valor: emTexto(e.valor), regra_rateio: e.regra_rateio || "motor" }));
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


export const REGRAS_RATEIO = [["motor", "Padrão (pelo valor)"], ["igual", "Igual por peça"], ["valor", "Pelo valor da peça"], ["peso", "Pelo peso"]];

// Argumentos da RPC salvar_custeio_lote a partir do formulário (puro; testável).
export function payloadCusteio(lote, form, diretosAlterados) {
  const lance = toNum(form.valor);
  return {
    p_lote: lote.lote, p_modo: form.modo,
    p_lance: form.modo === "rateio" ? lance : null,
    p_comissao: form.modo === "rateio" ? (toNum(form.comissao) ?? 0) : null,
    p_taxa: form.modo === "rateio" ? (toNum(form.taxa) ?? 0) : null,
    p_extras: form.extras.filter((e) => toNum(e.valor) > 0).map((e) => ({
      id: e.id ?? null, sku: (e.sku || "").trim() || null, tipo: e.tipo, descricao: (e.descricao || "").trim() || null,
      valor: toNum(e.valor), regra_rateio: e.regra_rateio || "motor",
    })),
    p_diretos: Object.fromEntries(Object.entries(diretosAlterados || {}).map(([sku, v]) => [sku, toNum(v)])),
  };
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

// ---- Custos globais ----
export const BASES_GLOBAL = [["por_item", "Valor por peça"], ["por_lote", "Valor por lote (dividido entre as peças)"], ["pct_custo_lote", "% sobre o custo da peça"]];
export const globalVazio = () => ({ id: null, nome: "", tipo: "outros", valor: "", base: "por_item", regra_rateio: "valor", grupos: "", lotes: "", vigencia_inicio: "", vigencia_fim: "", ativo: true });

export const lerListaTexto = (t) => String(t || "").split(/[;,\n]+/).map((x) => x.trim()).filter(Boolean);
export const lerListaLotes = (t) => [...new Set(lerListaTexto(t).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0))];

// Valida o formulário do custo global; devolve a lista de problemas (vazia = ok).
export function validarGlobal(f) {
  const e = [];
  if (String(f?.nome || "").trim().length < 2) e.push("Dê um nome ao custo.");
  const v = toNum(f?.valor);
  if (v == null || v < 0) e.push("Informe o valor.");
  if (f?.base === "pct_custo_lote" && v != null && v > 100) e.push("Percentual de 0 a 100.");
  if (!f?.vigencia_inicio) e.push("Informe o início da vigência.");
  if (f?.vigencia_inicio && f?.vigencia_fim && f.vigencia_fim < f.vigencia_inicio) e.push("O fim da vigência é antes do início.");
  if (String(f?.lotes || "").trim() && !lerListaLotes(f.lotes).length) e.push("Lotes: use números separados por vírgula.");
  if (f?.tipo === "embalagem") e.push("Atenção: o motor de preço já desconta embalagem (R$ 25 + por peso). Um global de embalagem soma ao custo da peça e conta em dobro, a menos que você ajuste a embalagem do motor.");
  return e;
}
// Avisos (não impedem salvar) × erros: o aviso da embalagem começa com "Atenção".
export const soErros = (lista) => lista.filter((m) => !m.startsWith("Atenção"));

export const BASE_ROTULO = Object.fromEntries(BASES_GLOBAL.map(([k, r]) => [k, r]));
export function descreverGlobal(g) {
  const v = Number(g.valor);
  const valor = g.base === "pct_custo_lote" ? `${String(v).replace(".", ",")}%` : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const escopo = [g.grupos?.length ? `grupos: ${g.grupos.join(", ")}` : "todos os grupos", g.lotes?.length ? `lotes: ${g.lotes.join(", ")}` : "todos os lotes"].join(" · ");
  return `${valor} · ${BASE_ROTULO[g.base] || g.base} · ${escopo}`;
}
// Vigente numa data (YYYY-MM-DD)?
export const globalVigente = (g, dia) => !!g.ativo && dia >= g.vigencia_inicio && (!g.vigencia_fim || dia <= g.vigencia_fim);
