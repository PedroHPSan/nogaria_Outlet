// Custo REAL do lote (PURO): lance + comissão do leiloeiro (5%) + taxa HISA + frete de aquisição.
// `lotes.custo_total` hoje é lance × 1,05 e subestima o custo. Aqui o custo é composto e cada
// componente carrega a ORIGEM (real | estimado) para a UI nunca fingir certeza.
//
// RISCO ANOTADO: a taxa HISA real parece seguir degraus por faixa de lance (resíduo de ~12–28%
// do lance nos lotes pagos). O padrão de 2,5% vale só para lotes SEM resíduo conhecido e tende a
// SUBESTIMAR o custo de lotes futuros até a regra ser confirmada com a HISA.

export const COMISSAO_LEILOEIRO = 0.05;
export const TAXA_HISA_PADRAO = 0.025; // estimativa (sem confirmação)
export const FRETE_TOTAL_ESTIMADO = 8000; // R$ total da operação, rateado pelo lance (estimativa)

// Resíduo REAL = pago_hisa − lance − 5% (LOTES_PAGOS.pdf, informado pelo Pedro).
export const TAXA_HISA_REAL = {
  3: 440, 12: 702, 42: 440, 43: 288, 52: 314, 68: 314, 69: 314, 71: 219, 83: 440, 89: 440,
  90: 314, 91: 288, 92: 440, 95: 219, 100: 1435, 103: 1870, 105: 440, 110: 875, 111: 1435,
  112: 1235, 116: 1235, 119: 1435, 120: 1235, 121: 702, 122: 1235, 123: 1435, 125: 1435,
};

// Lotes cujo custo_total JÁ é o valor pago (fora do sistema / origem desconhecida): não somar nada.
export const LOTES_CUSTO_FIXO = new Set([1, 7, 74, 75]);

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Peso do lote no rateio do frete: lance (ou custo_total quando não há lance).
const pesoFrete = (l) => num(l.lance_final) || num(l.custo_total);

/**
 * @param {{lote:number, lance_final?:number, custo_total?:number}} lote
 * @param {Array} todosLotes  todos os lotes (para ratear o frete pelo lance)
 * @param {{freteTotal?:number, taxaPadrao?:number}} [opts]
 * @returns {{lote, lance, comissao, taxaHisa, taxaOrigem, frete, freteOrigem, total, origem}}
 */
export function custoRealLote(lote, todosLotes = [], opts = {}) {
  const freteTotal = opts.freteTotal ?? FRETE_TOTAL_ESTIMADO;
  const taxaPadrao = opts.taxaPadrao ?? TAXA_HISA_PADRAO;
  const somaPesos = todosLotes.reduce((s, l) => s + pesoFrete(l), 0);
  const frete = somaPesos > 0 ? r2(freteTotal * pesoFrete(lote) / somaPesos) : 0;

  // Composição REAL gravada no banco (migration lotes_custo_composicao): tem prioridade sobre as
  // estimativas. Frete NULL = ainda sem dado → mantém a estimativa (nunca assume 0).
  if (lote.valor_pago_hisa != null || lote.taxa_hisa != null) {
    const lance = num(lote.lance_final);
    const comissao = lote.comissao_leiloeiro != null ? num(lote.comissao_leiloeiro) : r2(lance * COMISSAO_LEILOEIRO);
    const taxaHisa = num(lote.taxa_hisa);
    const temFrete = lote.frete_retirada != null || lote.frete_transferencia != null;
    const freteReal = num(lote.frete_retirada) + num(lote.frete_transferencia);
    const freteFinal = temFrete ? r2(freteReal) : frete;
    return {
      lote: lote.lote, lance, comissao, taxaHisa, taxaOrigem: "real",
      frete: freteFinal, freteOrigem: temFrete ? "real" : "estimado",
      total: r2(lance + comissao + taxaHisa + freteFinal + num(lote.outros_custos)),
      origem: temFrete ? "real (composição no banco)" : "real (HISA) + frete estimado",
    };
  }
  // Custo fixo: já é o valor pago. Só soma o frete estimado.
  if (LOTES_CUSTO_FIXO.has(lote.lote) || !(num(lote.lance_final) > 0)) {
    const base = num(lote.custo_total);
    return {
      lote: lote.lote, lance: null, comissao: null, taxaHisa: null, taxaOrigem: "incluida",
      frete, freteOrigem: "estimado", total: r2(base + frete), origem: "custo_total + frete estimado",
    };
  }
  const lance = num(lote.lance_final);
  const comissao = r2(lance * COMISSAO_LEILOEIRO);
  const real = TAXA_HISA_REAL[lote.lote];
  const taxaHisa = real != null ? real : r2(lance * taxaPadrao);
  return {
    lote: lote.lote, lance, comissao, taxaHisa, taxaOrigem: real != null ? "real" : "estimado",
    frete, freteOrigem: "estimado", total: r2(lance + comissao + taxaHisa + frete),
    origem: real != null ? "real (HISA) + frete estimado" : "estimado (taxa 2,5% + frete)",
  };
}
