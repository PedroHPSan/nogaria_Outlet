// pricing.js — Motor de precificação Nogária Outlet (espelho da view vw_precificacao).
// JS puro, sem dependências. Calcula P_anúncio (teto) e P_piso (mínimo) ao vivo na UI.

// Mapa do campo itens.estado (ESTADOS em model.js) -> código de condição do motor.
export const ESTADO_TO_COND = {
  "Novo": "NOVO_LACRADO",
  "Usado funcionando": "USADO_OK",
  "Usado sem teste": "SEM_TESTE",
  "Avariado": "AVARIA_ESTETICA",
  "Incompleto": "SEM_TESTE",
  "Sucata": "DEFEITO_PECAS",
};
export const estadoToCondicao = (estado, padrao = "USADO_OK") =>
  ESTADO_TO_COND[estado] || padrao;

// Normaliza o texto livre de canal_principal para um código de canal.
export const normalizarCanal = (txt) => {
  const s = (txt || "").toLowerCase();
  if (s.includes("shopee")) return "SHOPEE";
  if (s.includes("mercado livre") || s === "ml") return "ML";
  if (s.includes("tiktok")) return "TIKTOK";
  if (s.includes("magalu")) return "MAGALU";
  if (s.includes("amazon")) return "AMAZON";
  if (s.includes("b2b")) return "B2B";
  if (s.includes("olx") || s.includes("facebook") || s.includes("local")) return "LOCAL";
  return "ML";
};

// Defaults espelhando os seeds da migration (pesquisa 2026). Em produção carregue do
// banco (pricing_*) via pricingParams.js e passe para precificar().
export const DEFAULT_PARAMS = {
  condicao: {
    NOVO_LACRADO: { fator: 0.80, ancora: "NOVO" },
    NOVO_CAIXA_AVARIADA: { fator: 0.70, ancora: "NOVO" },
    USADO_OK: { fator: 0.92, ancora: "USADO" },
    AVARIA_ESTETICA: { fator: 0.75, ancora: "USADO" },
    SEM_TESTE: { fator: 0.55, ancora: "USADO" },
    DEFEITO_PECAS: { fator: 0.20, ancora: "USADO" },
  },
  risco: { BAIXO: 0.95, MEDIO: 0.90, ALTO: 0.85 },
  canal: {
    ML: { takeRate: 0.14, fixo: 6.75 }, SHOPEE: { takeRate: 0.14, fixo: 20 },
    TIKTOK: { takeRate: 0.06, fixo: 2 }, MAGALU: { takeRate: 0.16, fixo: 0 },
    AMAZON: { takeRate: 0.13, fixo: 2 }, B2B: { takeRate: 0.05, fixo: 0 },
    LOCAL: { takeRate: 0.00, fixo: 0 },
  },
  config: {
    margemSP: 0.30, margemBelem: 0.50, reserva: 0.05, embalagem: 25,
    freteKg: 3.0, freteMin: 15, convNovoUsado: 0.60, condicaoPadrao: "USADO_OK",
  },
};

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Calcula a precificação de um item.
 * @param {object} inp
 *   condicaoCod, canalCod, riscoNivel, destino, pesoKg, refNovo, refUsado
 *   custoItem  -> custo proporcional já calculado (preferido na UI; venha de vw_precificacao)
 *   OU custoLote + somaBaseLote -> para calcular o rateio aqui.
 * @param {object} P parâmetros (default DEFAULT_PARAMS)
 */
export function precificar(inp, P = DEFAULT_PARAMS) {
  const cond = P.condicao[inp.condicaoCod] || P.condicao[P.config.condicaoPadrao];
  const fRisco = P.risco[inp.riscoNivel] ?? 0.9;
  const cn = P.canal[inp.canalCod] || P.canal.ML;

  const refNovo = inp.refNovo ?? 0;
  const refUsado = inp.refUsado ?? refNovo * P.config.convNovoUsado;
  const refEff = cond.ancora === "NOVO" ? refNovo : refUsado;
  const pAnuncio = r2(refEff * cond.fator * fRisco);

  const custoItem = inp.custoItem != null
    ? inp.custoItem
    : (inp.somaBaseLote > 0 ? r2(inp.custoLote * pAnuncio / inp.somaBaseLote) : 0);

  const isLocal = inp.canalCod === "LOCAL" || inp.canalCod === "B2B";
  const frete = isLocal ? 0 : r2(Math.max(P.config.freteMin, (inp.pesoKg || 0) * P.config.freteKg));

  const isBelem = !!inp.destino && /bel[eé]m/i.test(inp.destino);
  const margemMin = isBelem ? P.config.margemBelem : P.config.margemSP;

  const denom = 1 - cn.takeRate - P.config.reserva - margemMin;
  const pPiso = denom > 0 ? r2((custoItem + frete + P.config.embalagem + cn.fixo) / denom) : 0;

  const lucro = r2(pAnuncio - custoItem - frete - P.config.embalagem - cn.fixo - pAnuncio * (cn.takeRate + P.config.reserva));
  const margem = pAnuncio > 0 ? r2((lucro / pAnuncio) * 100) / 100 : 0;
  const viavel = pPiso > 0 && pAnuncio >= pPiso;

  return {
    pAnuncio, pPiso, custoItem, frete, takeRate: cn.takeRate, fixo: cn.fixo, margemMin,
    lucroLiquido: lucro, margemLiquida: margem, viavel,
    sugestao: viavel ? "Publicar" : (isLocal ? "Rever preço/custo" : "Kit/Lote ou canal local"),
  };
}

// Título de anúncio por canal: Marca + Produto + Modelo + Estado + selo outlet.
export function gerarTitulo(item, canalCod = "ML") {
  const partes = [item.marca, item.produto, item.modelo].filter(Boolean);
  let t = partes.join(" ").replace(/\s+/g, " ").trim();
  const selo = item.estado === "Novo" ? "Novo" : "Outlet Testado";
  t = `${t} — ${selo}`;
  const max = canalCod === "ML" ? 60 : 100;
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}
