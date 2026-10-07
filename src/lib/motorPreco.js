// Motor de preço v2 (PURO, sem rede). Roda em PARALELO ao motor atual (pricing.js): só SUGERE e
// explica; quem grava preço é sempre uma ação humana (validar). Regras do Pedro:
//   imposto 13% (receita bruta, Nogaria) · comissão do vendedor 3% · frete estimado 10% (por canal)
//   custo administrativo 10% · reserva de devolução 3% · taxa do canal · margem mínima 25% (única).
// O preço de MERCADO (alvo) vem do motor atual (derivarPreco().recomendado = ref × condição ×
// embalagem × risco); este módulo cuida do CUSTO (rateio do lote) e da viabilidade.
import { arredondarPsicologico } from "./precoRapido.js";
import { normalizarCanal } from "./pricing.js";

export const REGRAS = {
  imposto: 0.13,
  comissaoVendedor: 0.03,
  adm: 0.10,
  reserva: 0.03,
  margemMin: 0.25,
  precoMinAnuncio: { ML: 29.9, SHOPEE: 19.9 }, // abaixo disso tarifa+embalagem comem >30% do preço
  limiteKit: 40, // p_ref < R$40 → candidato a kit/combo
  degrauML: 79,
};

// taxa do canal, tarifa fixa por item e frete estimado (% do preço). Editáveis aqui até virar tabela.
export const CANAIS_V2 = {
  ML: { nome: "Mercado Livre Clássico", taxa: 0.12, fixo: (p) => (p < 79 ? 6.5 : 0), frete: 0.10 },
  SHOPEE: { nome: "Shopee", taxa: 0.20, fixo: () => 4, frete: 0.10 },
  TIKTOK: { nome: "TikTok Shop", taxa: 0.06, fixo: () => 2, frete: 0.10 },
  MAGALU: { nome: "Magalu", taxa: 0.16, fixo: () => 0, frete: 0.10 },
  AMAZON: { nome: "Amazon", taxa: 0.12, fixo: () => 2, frete: 0.10 },
  SITE: { nome: "Site próprio", taxa: 0.05, fixo: () => 0, frete: 0.10 },
  B2B: { nome: "B2B / atacado", taxa: 0.02, fixo: () => 0, frete: 0.025 },
  LOCAL: { nome: "Venda local", taxa: 0, fixo: () => 0, frete: 0 },
};

/**
 * Sobrescreve as constantes com parâmetros do banco (pricing_v2_param / pricing_v2_canal).
 * Valor ausente/inválido mantém o padrão. Chamado uma vez por sessão (motorPrecoDb.carregarConfig).
 */
export function aplicarConfig({ params, canais } = {}) {
  const n = (v) => { if (v == null || v === "") return null; const x = Number(v); return Number.isFinite(x) ? x : null; }; // null do banco ≠ 0
  const mapa = {
    imposto: (v) => { REGRAS.imposto = v; }, comissao_vendedor: (v) => { REGRAS.comissaoVendedor = v; },
    adm: (v) => { REGRAS.adm = v; }, reserva: (v) => { REGRAS.reserva = v; }, margem_min: (v) => { REGRAS.margemMin = v; },
    preco_min_ml: (v) => { REGRAS.precoMinAnuncio.ML = v; }, preco_min_shopee: (v) => { REGRAS.precoMinAnuncio.SHOPEE = v; },
    limite_kit: (v) => { REGRAS.limiteKit = v; },
  };
  for (const r of params || []) { const v = n(r.valor); if (v != null && mapa[r.chave]) mapa[r.chave](v); }
  for (const c of canais || []) {
    const taxa = n(c.taxa), fixo = n(c.fixo_valor) ?? 0, abaixo = n(c.fixo_abaixo_de), frete = n(c.frete_pct);
    if (taxa == null || frete == null) continue;
    CANAIS_V2[c.codigo] = { nome: c.nome || c.codigo, taxa, frete, fixo: (p) => (abaixo == null || p < abaixo ? fixo : 0) };
  }
}

// Perda esperada (não vende/descarta) por grupo — estimativa a calibrar com vendas reais.
const PERDA_GRUPO = [
  [/diversos|n[aã]o classificado/i, 0.40],
  [/acess[oó]rios? celular|capa/i, 0.35],
  [/livro|papelaria/i, 0.30],
  [/vestu[aá]rio|roupa/i, 0.25],
  [/cal[cç]ado/i, 0.20],
  [/ferrament|port[aá]til|eletro/i, 0.10],
  [/notebook|smartphone|celular|tv|console|rob[oô]/i, 0.05],
];
export const PERDA_PADRAO = 0.15;
export const perdaDoGrupo = (grupo) => {
  const g = String(grupo || "");
  const hit = PERDA_GRUPO.find(([re]) => re.test(g));
  return hit ? hit[1] : PERDA_PADRAO;
};

// Embalagem por porte (substitui os R$25 fixos): P R$2 · M R$5 · G R$12 · GG R$20.
export function embalagemPorPeso(pesoKg) {
  const p = Number(pesoKg);
  if (!Number.isFinite(p) || p <= 0) return 5; // sem peso: porte M
  if (p < 0.3) return 2;
  if (p < 2) return 5;
  if (p < 8) return 12;
  return 20;
}

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const CODS_V2 = Object.keys(CANAIS_V2);
export const canalV2 = (txt) => {
  const c = normalizarCanal(txt);
  return CODS_V2.includes(c) ? c : "ML";
};

// % do preço que NÃO é custo de aquisição (tudo menos o fixo por item e a margem).
export function pctVariavel(canalCod) {
  const c = CANAIS_V2[canalCod] || CANAIS_V2.ML;
  return REGRAS.imposto + REGRAS.comissaoVendedor + REGRAS.adm + REGRAS.reserva + c.taxa + c.frete;
}

// Menor preço p tal que p·(1 − var − margem) = base + fixo(p). A tarifa fixa do ML depende do
// próprio preço (só < R$79): resolve nos dois lados do degrau sem oscilar.
export function precoParaMargem(base, canalCod, margem = 0) {
  const c = CANAIS_V2[canalCod] || CANAIS_V2.ML;
  const den = 1 - pctVariavel(canalCod) - margem;
  if (!(den > 0)) return Infinity;
  const comFixo = (base + c.fixo(0.01)) / den; // fixo do lado "barato"
  if (c.fixo(comFixo) === c.fixo(0.01)) return r2(comFixo);
  const semFixo = base / den;
  if (c.fixo(semFixo) === 0) return r2(Math.max(semFixo, REGRAS.degrauML));
  return REGRAS.degrauML;
}

// Lucro (R$) e margem vendendo a `preco`, dado o custo de aquisição + embalagem.
export function lucroEm(preco, base, canalCod) {
  const c = CANAIS_V2[canalCod] || CANAIS_V2.ML;
  const lucro = preco - base - c.fixo(preco) - preco * pctVariavel(canalCod);
  return { lucro: r2(lucro), margem: preco > 0 ? lucro / preco : 0 };
}

const mediana = (arr) => {
  const a = arr.filter((x) => x > 0).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/**
 * Rateia o custo do lote por CONTRIBUIÇÃO LÍQUIDA (o que cada item devolve ao caixa), com peso
 * manual k (0,25–4) e α (parte igualitária só em lote homogêneo). Σ custo == custoLote, sempre.
 * @param {Array<{sku, alvo:number, grupo?, canal?, pesoKg?, k?:number}>} itens  alvo = preço de mercado
 * @returns {Map<string,{custo:number, w:number, contrib:number, refEstimada:boolean, alvoEfetivo:number}>}
 */
export function ratearLote(itens, custoLote) {
  const out = new Map();
  if (!itens.length) return out;
  const positivos = itens.map((i) => Number(i.alvo) || 0).filter((x) => x > 0);
  const medLote = mediana(positivos);
  const medGrupo = {};
  for (const i of itens) {
    const g = i.grupo || "";
    if (!(g in medGrupo)) medGrupo[g] = mediana(itens.filter((x) => (x.grupo || "") === g).map((x) => Number(x.alvo) || 0));
  }
  // α pelo coeficiente de variação dos preços
  const media = positivos.length ? positivos.reduce((s, x) => s + x, 0) / positivos.length : 0;
  const dp = positivos.length ? Math.sqrt(positivos.reduce((s, x) => s + (x - media) ** 2, 0) / positivos.length) : 0;
  const cv = media > 0 ? dp / media : 0;
  const alpha = cv > 1 ? 0 : cv >= 0.5 ? 0.3 : 0.6;

  const linhas = itens.map((i) => {
    let alvo = Number(i.alvo) || 0;
    let refEstimada = false;
    if (!(alvo > 0)) { // sem referência: nunca custo 0 — estima pela mediana e pesa metade
      alvo = medGrupo[i.grupo || ""] || medLote * 0.5;
      refEstimada = true;
    }
    const canal = CANAIS_V2[i.canal] ? i.canal : "ML";
    const c = CANAIS_V2[canal];
    const vel = alvo * (1 - perdaDoGrupo(i.grupo));
    const contrib = Math.max(0, vel * (1 - pctVariavel(canal)) - c.fixo(alvo) - embalagemPorPeso(i.pesoKg));
    const k = Math.min(4, Math.max(0.25, Number(i.k) || 1)) * (refEstimada ? 0.5 : 1);
    return { sku: i.sku, contrib, peso: contrib * k, refEstimada, alvoEfetivo: alvo };
  });
  const soma = linhas.reduce((s, l) => s + l.peso, 0);
  const n = linhas.length;
  let acumulado = 0;
  linhas.forEach((l, idx) => {
    const w = soma > 0 ? alpha / n + (1 - alpha) * (l.peso / soma) : 1 / n;
    // o último absorve os centavos residuais: a soma fecha exatamente em custoLote
    const custo = idx === n - 1 ? r2(custoLote - acumulado) : r2(custoLote * w);
    acumulado += custo;
    out.set(l.sku, { custo, w, contrib: l.contrib, refEstimada: l.refEstimada, alvoEfetivo: l.alvoEfetivo });
  });
  return out;
}

/**
 * Preços e decisão de UM item. `alvoMercado` = derivarPreco().recomendado; `custoAloc` = rateio.
 * Status: SEM_REF · KIT · ANUNCIAR (alvo ≥ mínimo) · GIRO (piso ≤ alvo < mínimo) · LOCAL · INVIAVEL.
 */
export function precificarV2({ alvoMercado, custoAloc, canal, pesoKg, refEstimada = false }) {
  const cod = canalV2(canal);
  const alvo = Number(alvoMercado) || 0;
  const emb = embalagemPorPeso(pesoKg);
  const custo = Number(custoAloc) || 0;
  const base = custo + emb;
  const piso = precoParaMargem(base, cod, 0);
  const minimo = precoParaMargem(base, cod, REGRAS.margemMin);
  const pctVar = pctVariavel(cod);
  const res = { canal: cod, custoAloc: r2(custo), embalagem: emb, piso, minimo, alvo, pctVar, refEstimada, comp: null };

  if (!(alvo > 0) || refEstimada) return { ...res, status: "SEM_REF", sugerido: null, lucro: null, margem: null, motivo: "Sem preço de referência confiável do produto." };

  const minAbs = REGRAS.precoMinAnuncio[cod] || 0;
  let sugerido = arredondarPsicologico(alvo, "perto");
  if (cod === "ML" && sugerido >= 72 && sugerido < REGRAS.degrauML && alvo >= REGRAS.degrauML - 1) sugerido = REGRAS.degrauML; // evita R$72–78,99
  const { lucro, margem } = lucroEm(sugerido, base, cod);
  const completo = { ...res, sugerido, lucro, margem };

  if (alvo < REGRAS.limiteKit || alvo < minAbs) return { ...completo, status: "KIT", motivo: `Preço (R$ ${alvo.toFixed(2)}) é baixo para anúncio individual: agrupar em kit/combo.` };
  if (sugerido >= minimo) return { ...completo, status: "ANUNCIAR", motivo: "Cobre a margem mínima." };
  if (sugerido >= piso) return { ...completo, status: "GIRO", motivo: "Dá lucro, mas abaixo da margem mínima — validar." };
  // inviável no canal: testa venda local (custos menores)
  const baseL = base;
  const minL = precoParaMargem(baseL, "LOCAL", REGRAS.margemMin);
  const pisoL = precoParaMargem(baseL, "LOCAL", 0);
  const sugL = arredondarPsicologico(alvo, "perto");
  if (cod !== "LOCAL" && sugL >= minL) {
    const l = lucroEm(sugL, baseL, "LOCAL");
    return { ...completo, status: "LOCAL", sugerido: sugL, canal: "LOCAL", piso: pisoL, minimo: minL, lucro: l.lucro, margem: l.margem, motivo: "Não fecha margem no canal escolhido; fecha em venda local." };
  }
  return { ...completo, status: "INVIAVEL", motivo: "Abaixo do piso: não cobre custo e taxas." };
}

/**
 * Custo MÁXIMO que o lote suporta para fechar a margem mínima: Σ por item de
 * max(0, VEL·(1 − %variável − margem) − fixo − embalagem). `itens` = [{alvo, grupo, canal, pesoKg}].
 * Itens sem referência ficam de fora (não há como estimar o que devolvem).
 */
export function custoMaximoLance(itens) {
  let total = 0;
  for (const i of itens) {
    const alvo = Number(i.alvo) || 0;
    if (!(alvo > 0)) continue;
    const canal = CANAIS_V2[i.canal] ? i.canal : "ML";
    const vel = alvo * (1 - perdaDoGrupo(i.grupo));
    total += Math.max(0, vel * (1 - pctVariavel(canal) - REGRAS.margemMin) - CANAIS_V2[canal].fixo(alvo) - embalagemPorPeso(i.pesoKg));
  }
  return r2(total);
}

const BRL = (n) => `R$ ${Number(n).toFixed(2).replace(".", ",")}`;
const PCT = (n) => `${(Number(n) * 100).toFixed(1).replace(".", ",")}%`;

/** Texto "de onde chegamos a esse preço" (linhas curtas para a UI). */
export function explicar(r, { condicao = "", loteCusto = null } = {}) {
  const c = CANAIS_V2[r.canal] || CANAIS_V2.ML;
  const p = r.sugerido ?? r.alvo;
  const linhas = [];
  linhas.push(`Mercado: referência já ajustada pela condição${condicao ? ` (${condicao})` : ""} = ${BRL(r.alvo)}.`);
  linhas.push(`Custo do lote: ${BRL(r.custoAloc)} rateados${loteCusto ? ` do custo composto do lote (${BRL(loteCusto)})` : ""}${r.refEstimada ? " — referência ESTIMADA, baixa confiança" : ""} + embalagem ${BRL(r.embalagem)}.`);
  if (p > 0) {
    const t = (v) => BRL(p * v);
    linhas.push(`Custos sobre o preço (${PCT(r.pctVar)} = ${BRL(p * r.pctVar)}): imposto 13% ${t(REGRAS.imposto)} + comissão vendedor 3% ${t(REGRAS.comissaoVendedor)} + frete ${PCT(c.frete)} ${t(c.frete)} + administrativo 10% ${t(REGRAS.adm)} + ${c.nome} ${PCT(c.taxa)} ${t(c.taxa)}${c.fixo(p) ? ` + tarifa fixa ${BRL(c.fixo(p))}` : ""} + reserva de devolução 3% ${t(REGRAS.reserva)}.`);
  }
  linhas.push(`Piso (zero a zero): ${BRL(r.piso)} · Mínimo (25% de margem): ${BRL(r.minimo)}.`);
  if (r.lucro != null) linhas.push(`Lucro esperado a ${BRL(p)}: ${BRL(r.lucro)} (${PCT(r.margem)} do preço). ${r.motivo}`);
  else linhas.push(r.motivo);
  return linhas;
}
