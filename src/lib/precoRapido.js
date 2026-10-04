// Preço rápido (PURO, sem rede): aplica sobre o preço RECOMENDADO do motor
// (derivarPreco) um desconto por tempo parado em estoque, arredonda para um preço
// "de vitrine" e nunca deixa o resultado abaixo do piso. Casos que exigem decisão
// humana (queda grande, item A+, piso inviável) saem marcados — nunca aplicados.

// Faixas padrão (dias parado → % de desconto). Sobrescritas pela tabela
// pricing_markdown_idade quando existir (precoRapidoDb.carregarFaixas).
export const FAIXAS_PADRAO = [
  { dias_min: 0, dias_max: 30, pct: 0 },
  { dias_min: 31, dias_max: 60, pct: 10 },
  { dias_min: 61, dias_max: 90, pct: 20 },
  { dias_min: 91, dias_max: null, pct: 30 },
];

export const LIMITE_APROVACAO_PCT = 40; // queda > 40 % sobre o preço atual exige aprovação
const MS_DIA = 86400000;

// Dias que o item está parado, a partir do 1º carimbo disponível. null = sem data
// (nesse caso NÃO há desconto por idade: melhor não mexer do que chutar).
export function diasParado(item, hoje = new Date()) {
  const bruto = item?.disponivel_desde || item?.criado_em || item?.created_at;
  if (!bruto) return null;
  const t = new Date(bruto).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((new Date(hoje).getTime() - t) / MS_DIA));
}

export function markdownPorIdade(dias, faixas = FAIXAS_PADRAO) {
  if (dias == null) return 0;
  const f = faixas.find((x) => dias >= x.dias_min && (x.dias_max == null || dias <= x.dias_max));
  return f ? Number(f.pct) || 0 : 0;
}

// Preço de vitrine: < R$ 1.000 → termina em 9 (89, 289, 489); ≥ R$ 1.000 → múltiplo
// de 50 (1.250, 1.300). modo "baixo" | "perto" | "cima" (cima serve para respeitar o piso).
export function arredondarPsicologico(v, modo = "perto") {
  const n = Number(v);
  if (!(n > 0)) return 0;
  const fn = modo === "baixo" ? Math.floor : modo === "cima" ? Math.ceil : Math.round;
  if (n >= 1000) return fn(n / 50) * 50;
  // candidatos terminados em 9: 9, 19, 29 … 999
  const k = fn((n + 1) / 10) * 10 - 1;
  return Math.max(9, k);
}

const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

// item: linha de itens; derivado: retorno de derivarPreco(item,…) ({ recomendado, piso }).
// opts: { hoje, faixas, arredondar=true, aprovacaoPct, markdown=true }.
export function calcularPrecoRapido(item, derivado, opts = {}) {
  const { hoje = new Date(), faixas = FAIXAS_PADRAO, arredondar = true, markdown = true, aprovacaoPct = LIMITE_APROVACAO_PCT } = opts;
  const atual = Number(item?.preco_ideal) > 0 ? Number(item.preco_ideal) : null;
  const recomendado = Number(derivado?.recomendado) || 0;
  const piso = Number(derivado?.piso) || 0;
  const base = { sku: item?.sku, atual, recomendado, piso, dias: null, pctMarkdown: 0, novo: null, delta: null, deltaPct: null, aplicar: false, aprovacao: false, motivos: [], ignorado: null };

  if (!(recomendado > 0)) return { ...base, ignorado: "sem recomendação do motor (faltam referências)" };

  const dias = diasParado(item, hoje);
  const pct = markdown ? markdownPorIdade(dias, faixas) : 0;
  let alvo = r2(recomendado * (1 - pct / 100));
  alvo = arredondar ? arredondarPsicologico(alvo) : alvo;

  const motivos = [];
  if (piso > 0 && alvo < piso) {
    alvo = arredondar ? arredondarPsicologico(piso, "cima") : Math.ceil(piso);
    motivos.push("limitado ao piso");
  }
  const pisoInviavel = !(piso > 0);
  if (pisoInviavel) motivos.push("piso inviável/indefinido");

  const delta = atual != null ? r2(alvo - atual) : null;
  const deltaPct = atual ? r2((delta / atual) * 100) : null;
  let aprovacao = false;
  if (pisoInviavel) aprovacao = true;
  if (deltaPct != null && deltaPct < -aprovacaoPct) { aprovacao = true; motivos.push(`queda de ${Math.abs(Math.round(deltaPct))}% sobre o preço atual`); }
  if (item?.classe === "A+" && atual != null && alvo !== atual) { aprovacao = true; motivos.push("item A+ exige aprovação"); }
  if (dias == null && markdown) motivos.push("sem data de entrada: sem desconto por idade");

  const mudou = atual == null || alvo !== atual;
  return { ...base, dias, pctMarkdown: pct, novo: alvo, delta, deltaPct, aprovacao, motivos, aplicar: mudou && !aprovacao };
}

// Plano para uma lista de itens. derivadoDe(item) → derivarPreco(...). Retorna as
// linhas e os totais (quantos aplicam / pedem aprovação / sem mudança; Δ em R$).
export function planoEmMassa(itens, derivadoDe, opts = {}) {
  const linhas = (itens || []).map((it) => ({ item: it, ...calcularPrecoRapido(it, derivadoDe(it), opts) }));
  const aplicaveis = linhas.filter((l) => l.aplicar);
  return {
    linhas,
    totais: {
      total: linhas.length,
      aplicar: aplicaveis.length,
      aprovacao: linhas.filter((l) => l.aprovacao).length,
      semMudanca: linhas.filter((l) => !l.aplicar && !l.aprovacao && !l.ignorado).length,
      ignorados: linhas.filter((l) => l.ignorado).length,
      deltaTotal: r2(aplicaveis.reduce((s, l) => s + (l.delta || 0), 0)),
    },
  };
}
