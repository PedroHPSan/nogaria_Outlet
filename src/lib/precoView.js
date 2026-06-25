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
  const pct = (f) => Math.round((f ?? 1) * 100);
  const embLabel = embalagemLabel(embalagem);
  const derivacao = [
    {
      passo: "Referência", detalhe: fonteRef, fator: null, valor: r2(refEff),
      ajuda: `Preço de um item igual a este${fonteRef && fonteRef !== "—" ? ` (fonte: ${fonteRef})` : ""}. É a base de todo o cálculo do teto.`,
    },
    {
      passo: "Condição do produto", detalhe: it.estado || "—", fator: r.fCond, valor: v1,
      ajuda: `${it.estado || "Esta condição"} vale ${pct(r.fCond)}% do valor de ${r.ancora === "NOVO" ? "um novo" : "um usado"}.`,
    },
    {
      passo: "Embalagem", detalhe: embLabel, fator: r.fEmb, valor: v2,
      ajuda: r.fEmb < 1 ? `Caixa "${embLabel}": corte de ${100 - pct(r.fEmb)}% no preço.` : `Caixa "${embLabel}": sem corte.`,
    },
    {
      passo: "Risco", detalhe: risco, fator: r.fRisco, valor: recomendado,
      ajuda: `Risco ${risco} da categoria: mantém ${pct(r.fRisco)}% (desconto pela chance de devolução/disputa).`,
    },
  ];

  // Lucro/margem em QUALQUER preço (mesma fórmula do motor): lucro(P) = P − custos
  // diretos − P×(comissão+reserva). Em P=recomendado bate com economia.lucro; em
  // P=piso a margem bate com a margem mínima. Deixa o card reagir ao preço digitado.
  const custosDiretos = r2(r.custoItem + r.frete + r.custoEmbalagem + r.fixo);
  const taxaSobreVenda = r.takeRate + r.reserva;
  const lucroEm = (p) => {
    const v = Number(p);
    if (!Number.isFinite(v) || v <= 0) return null;
    return r2(v - custosDiretos - v * taxaSobreVenda);
  };
  const margemEm = (p) => {
    const v = Number(p), l = lucroEm(p);
    return l == null || v <= 0 ? null : r2(l / v);
  };

  // Memória de cálculo com VALORES (R$): o piso (custos ÷ (1−taxas−margem)) e o teto
  // (referência × fatores). Cada linha leva o "porquê" em português.
  const memoria = {
    piso: {
      componentes: [
        { label: "Custo do item", valor: r.custoItem, ajuda: "Quanto esta unidade custou (rateio do custo do lote)." },
        { label: "Frete estimado", valor: r.frete, ajuda: "Envio ao cliente. Zero em canais locais (OLX/B2B)." },
        { label: "Embalagem", valor: r.custoEmbalagem, ajuda: "Caixa, plástico e material de envio." },
        { label: "Tarifa fixa do canal", valor: r.fixo, ajuda: "Custo fixo por venda cobrado pela plataforma." },
      ],
      custosDiretos,
      partes: { comissao: r.takeRate, reserva: r.reserva, margem: r.margemMin },
      denom: r2(1 - r.takeRate - r.reserva - r.margemMin),
      resultado: r.pPiso,
      inviavel: !(r.pPiso > 0),
    },
    teto: derivacao,
  };

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
    economia: {
      custo: r.custoItem, frete: r.frete, taxa: r.takeRate, fixo: r.fixo,
      reserva: r.reserva, custoEmbalagem: r.custoEmbalagem,
      // Plataforma em R$ (no recomendado): comissão, reserva e o total que ela leva.
      custoTaxa: r.custoTaxa, custoReserva: r.custoReserva, custoPlataforma: r.custoPlataforma,
      receita: recomendado, lucro: r.lucroLiquido, margem: r.margemLiquida,
      margemMin: r.margemMin, viavel: r.viavel, sugestao: r.sugestao,
    },
    manual,
    delta,
    flags,
    memoria,
    lucroEm,
    margemEm,
  };
}
