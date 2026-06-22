// classificacao.js — Reclassificação automática do item após a triagem.
// JS puro, sem dependências (padrão de pricing.js). A partir da condição (triagem),
// da faixa de valor de referência e do volume, sugere a classe A+/A/B/C/D/E e um
// destino/canal típicos. A UI usa como SUGESTÃO (aplicação com 1 clique), nunca
// sobrescreve sozinha.
//
// Tabela de negócio (resumo):
//   A+  > R$1.000, marca/alta liquidez, baixo volume   → ML / B2B
//   A   R$300–1.000, fácil venda, frete viável          → ML / TikTok
//   B   R$100–300, unitário ou kit                      → TikTok / Shopee / ML
//   C   < R$100, bom p/ kit, ruim p/ frete individual    → kits / venda local
//   D   volumoso, frete caro, venda trabalhosa          → SP / OLX / Facebook
//   E   incompleto/quebrado/sem teste/avaria relevante  → peças / lote / descarte

import { DESTINOS } from "./model";

// Faixas de valor (R$) — limites inferiores de cada classe.
export const VALOR_BANDAS = { aplus: 1000, a: 300, b: 100 };

// Limiares de volume ("volumoso" → D). Defaults; sobrepostos por params.config se houver.
export const VOLUME_DEFAULT = {
  pesoKg: 8, // peso efetivo (real ou cubado) a partir do qual é volumoso
  maiorDimCm: 60, // qualquer aresta a partir deste valor
  somaDimCm: 150, // C+L+A a partir deste valor
  divisorCubado: 6000, // (C×L×A)/6000 = peso cubado padrão (cm → kg)
};

// Destino logístico sugerido por classe (usa o enum DESTINOS de model.js).
export const CLASSE_DESTINO = {
  "A+": "A definir",
  A: "Belém",
  B: "SP storage",
  C: "Venda local SP",
  D: "Venda local SP",
  E: "A definir",
};

// Canal de venda típico por classe (texto livre; normalizado depois por normalizarCanal).
export const CLASSE_CANAL = {
  "A+": "Mercado Livre",
  A: "Mercado Livre",
  B: "TikTok Shop",
  C: "Local / Kits",
  D: "Local (OLX/Facebook)",
  E: "Peças / Lote",
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Item já marcado para descarte (status/estado legado) conta como E direto.
const ehDescarte = (it) =>
  it?.status === "DESCARTE" || it?.estado === "Sucata";

// Gatilhos de condição (triagem) que derrubam o item para a classe E.
// NÃO considera "sem teste"/testado=false: itens ainda não testados não são
// rebaixados — a classificação por teste só vale depois do teste (funciona=false,
// que só é preenchido após testar, ainda conta como E).
export function condicaoEhE(it) {
  if (!it) return false;
  if (ehDescarte(it)) return true;
  if (it.estado === "Avariado") return true;
  if (it.avaria === true) return true;
  if (it.funciona === false) return true;
  if (it.acessorios_ok === false) return true;
  return false;
}

// Valor de referência (R$), priorizando preço de USADO (o outlet vende usado).
// Espelha o padrão de testeObrigatorio()/pricing.js.
export function valorReferencia(it, params) {
  if (!it) return null;
  const g = params?.grupos?.[it.grupo];
  const conv = params?.config?.convNovoUsado ?? 0.6;
  const usado =
    num(it.preco_ideal) ??
    num(it.preco_sugerido) ??
    num(it.preco_ref_usado) ??
    num(g?.ancoraUsado);
  if (usado != null) return usado;
  const novo = num(it.preco_ref_novo) ?? num(it.preco_novo_est) ?? num(g?.ancoraNovo);
  return novo != null ? novo * conv : null;
}

// Peso efetivo = max(peso informado, peso cubado). null se não há dados de medida.
function pesoEfetivo(it, vol) {
  const c = num(it.comprimento_cm);
  const l = num(it.largura_cm);
  const a = num(it.altura_cm);
  const cubado = c != null && l != null && a != null ? (c * l * a) / vol.divisorCubado : null;
  const real = num(it.peso_real_kg) ?? num(it.peso_kg);
  if (real == null && cubado == null) return null;
  return Math.max(real ?? 0, cubado ?? 0);
}

// Volumoso = frete caro / venda trabalhosa → classe D.
export function isVolumoso(it, params) {
  if (!it) return false;
  const vol = { ...VOLUME_DEFAULT, ...(params?.config?.volume || {}) };
  const c = num(it.comprimento_cm);
  const l = num(it.largura_cm);
  const a = num(it.altura_cm);
  const dims = [c, l, a].filter((n) => n != null);
  if (dims.length && Math.max(...dims) >= vol.maiorDimCm) return true;
  if (c != null && l != null && a != null && c + l + a >= vol.somaDimCm) return true;
  const peso = pesoEfetivo(it, vol);
  if (peso != null && peso >= vol.pesoKg) return true;
  return false;
}

function classePorValor(v) {
  if (v == null) return null;
  if (v > VALOR_BANDAS.aplus) return "A+";
  if (v >= VALOR_BANDAS.a) return "A";
  if (v >= VALOR_BANDAS.b) return "B";
  return "C";
}

const fmtBRLcurto = (v) => `R$${Math.round(v).toLocaleString("pt-BR")}`;

// Classifica o item pela tabela de negócio. Retorna { classe, motivo, destino, canal }.
// classe === null quando faltam dados de preço (e não é E/D) — a UI mostra o motivo
// e não sugere reclassificação A+/A/B/C.
export function classificarItem(it, params) {
  if (!it) return { classe: null, motivo: "Sem item", destino: null, canal: null };

  // 1. Condição (triagem) → E
  if (condicaoEhE(it)) {
    return withDestinoCanal("E", "Condição (avaria/quebrado/incompleto) → E");
  }

  // 2. Volume → D
  if (isVolumoso(it, params)) {
    return withDestinoCanal("D", "Volumoso (frete caro) → D");
  }

  // 3. Faixa de valor → A+/A/B/C
  const v = valorReferencia(it, params);
  const classe = classePorValor(v);
  if (!classe) {
    return {
      classe: null,
      motivo: "Defina um preço de referência para classificar A+/A/B/C",
      destino: null,
      canal: null,
    };
  }
  return withDestinoCanal(classe, `${fmtBRLcurto(v)} → ${classe}`);
}

function withDestinoCanal(classe, motivo) {
  const destino = DESTINOS.includes(CLASSE_DESTINO[classe]) ? CLASSE_DESTINO[classe] : "A definir";
  return { classe, motivo, destino, canal: CLASSE_CANAL[classe] || null };
}

// Peso físico estimado de UM item (kg), para somar no conteúdo de uma caixa.
// Diferente de pesoEfetivo() (que usa max(real, cubado) p/ classificar volume): aqui
// o peso é ADITIVO, então prioriza o peso declarado (real → padrão) e só recorre ao
// peso cubado quando não há peso informado. null quando não há peso nem dimensões.
export function pesoEstimadoItem(it, params) {
  if (!it) return null;
  const real = num(it.peso_real_kg) ?? num(it.peso_kg);
  if (real != null) return real;
  const vol = { ...VOLUME_DEFAULT, ...(params?.config?.volume || {}) };
  const c = num(it.comprimento_cm), l = num(it.largura_cm), a = num(it.altura_cm);
  if (c != null && l != null && a != null) return (c * l * a) / vol.divisorCubado;
  return null;
}

// Soma o peso estimado de uma lista de itens (ex.: conteúdo de uma caixa). Espelha
// estimarValorCaixa: retorna { pesoKg, semPeso, count } — semPeso conta itens sem
// peso nem dimensões (logo o pesoKg é um piso, não o total real).
export function estimarPesoCaixa(itens, params) {
  let pesoKg = 0, semPeso = 0;
  const lista = itens || [];
  for (const it of lista) {
    const p = pesoEstimadoItem(it, params);
    if (p != null) pesoKg += p;
    else semPeso++;
  }
  return { pesoKg, semPeso, count: lista.length };
}

// Valor de venda estimado de um item: preço-alvo (ideal) → sugerido → referência.
export function estimarValorVenda(it, params) {
  return num(it?.preco_ideal) ?? num(it?.preco_sugerido) ?? valorReferencia(it, params);
}

// Soma o valor de venda estimado de uma lista de itens (ex.: conteúdo de uma caixa).
// Retorna { total, semPreco, count } — semPreco conta itens sem nenhum preço de referência.
export function estimarValorCaixa(itens, params) {
  let total = 0, semPreco = 0;
  const lista = itens || [];
  for (const it of lista) {
    const v = estimarValorVenda(it, params);
    if (v != null) total += v;
    else semPreco++;
  }
  return { total, semPreco, count: lista.length };
}

// Classe automática para itens SEM triagem (ex.: parados em "A catalogar").
// Diferente de classificarItem (condição/volume): aqui o sinal é categoria → valor → C,
// e NUNCA retorna vazio — todo item recebe ao menos a classe padrão "C".
export function classeAutomatica(it, params) {
  const grupo = it?.grupo;
  const cat = params?.grupos?.[grupo]?.classe;
  if (cat) return { classe: cat, motivo: `Categoria ${grupo} → ${cat}`, origem: "categoria" };
  const v = valorReferencia(it, params);
  const cv = classePorValor(v);
  if (cv) return { classe: cv, motivo: `${fmtBRLcurto(v)} → ${cv}`, origem: "valor" };
  return { classe: "C", motivo: "Sem categoria/preço → C (padrão)", origem: "fallback" };
}
