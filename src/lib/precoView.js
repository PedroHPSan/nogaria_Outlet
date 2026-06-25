// precoView.js — camada FINA de apresentação da precificação. Consome `precificar()`
// (não recalcula nada) e devolve UM objeto único que a UI lê: a recomendação, o "porquê"
// (derivação passo a passo dos fatores), o piso/economia, e o preço manual + flags.
// NUNCA lê preco_sugerido/preco_novo_est como sugestão.
import { precificar, DEFAULT_PARAMS, estadoToCondicao, normalizarCanal } from "./pricing.js";
import { embalagemLabel } from "./model.js";

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function derivarPreco(item, grupo = {}, params = DEFAULT_PARAMS, custoItem = null) {
  const it = item || {};
  const cond = estadoToCondicao(it.estado, params?.config?.condicaoPadrao);
  const canal = normalizarCanal(it.canal_principal);
  const risco = grupo?.nivelRisco && grupo.nivelRisco !== "None" ? grupo.nivelRisco : "MEDIO";
  const embalagem = it.cond_embalagem || "PERFEITA";
  const refNovo = it.preco_ref_novo ?? grupo?.ancoraNovo ?? it.preco_novo_est ?? 0;
  const refUsado = it.preco_ref_usado ?? grupo?.ancoraUsado ?? null;

  const r = precificar({
    condicaoCod: cond, canalCod: canal, riscoNivel: risco, embalagemCod: embalagem,
    destino: it.destino, pesoKg: it.peso_real_kg ?? it.peso_kg ?? 0,
    refNovo, refUsado, custoItem: custoItem ?? 0,
  }, params);

  const recomendado = r.pAnuncio;
  const refEff = r.refEff || 0;
  const fonteRef = it.preco_ref_novo != null
    ? (it.preco_ref_fonte || "referência salva")
    : (grupo?.ancoraNovo != null ? "âncora da categoria" : "—");

  // Derivação: cada passo aplica um fator até chegar ao recomendado (o "porquê").
  const v1 = r2(refEff * r.fCond);
  const v2 = r2(v1 * r.fEmb);
  const derivacao = [
    { passo: "Referência", detalhe: fonteRef, fator: null, valor: r2(refEff) },
    { passo: "Condição do produto", detalhe: it.estado || "—", fator: r.fCond, valor: v1 },
    { passo: "Embalagem", detalhe: embalagemLabel(embalagem), fator: r.fEmb, valor: v2 },
    { passo: "Risco", detalhe: risco, fator: r.fRisco, valor: recomendado },
  ];

  const manual = Number(it.preco_ideal) > 0 ? Number(it.preco_ideal) : null;
  const delta = manual != null ? r2(manual - recomendado) : null;
  const flags = [];
  if (manual != null && r.pPiso > 0 && manual < r.pPiso) flags.push({ tipo: "erro", msg: "Abaixo do piso (risco de prejuízo)." });
  if (manual != null && recomendado > 0) {
    const ratio = manual / recomendado;
    if (ratio > 1.5) flags.push({ tipo: "aviso", msg: "Bem acima da sugestão." });
    else if (ratio < 0.6) flags.push({ tipo: "aviso", msg: "Bem abaixo da sugestão." });
  }

  return {
    recomendado,
    piso: r.pPiso,
    referencia: { novo: refNovo || null, usado: refUsado, fonte: fonteRef, confianca: it.preco_ref_confianca || null },
    derivacao,
    economia: { custo: r.custoItem, frete: r.frete, taxa: r.takeRate, fixo: r.fixo, lucro: r.lucroLiquido, margem: r.margemLiquida, viavel: r.viavel, sugestao: r.sugestao },
    manual,
    delta,
    flags,
  };
}
