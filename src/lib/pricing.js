// pricing.js — Motor de precificação Nogária Outlet (espelho da view vw_precificacao).
// JS puro, sem dependências. Calcula P_anúncio (teto) e P_piso (mínimo) ao vivo na UI.

// Precificação de 2 eixos: a CONDIÇÃO DO PRODUTO (estado de uso/funcionamento) é
// independente da CONDIÇÃO DA EMBALAGEM (caixa). "Novo com caixa amassada" continua
// novo no produto e leva só um pequeno corte de embalagem — não cai pra faixa de usado.

// Mapa do campo itens.estado (ESTADOS em model.js) -> código de condição DO PRODUTO.
// As chaves antigas seguem mapeadas por segurança (dados legados / enum órfão).
export const ESTADO_TO_COND = {
  "Novo": "NOVO_LACRADO",
  // Caixa avariada NÃO é condição de produto: o produto é novo, o eixo embalagem
  // (cond_embalagem) carrega a avaria da caixa. (corrige a queda pra USADO_OK)
  "Embalagem aberta/avariada": "NOVO_LACRADO",
  "Usado": "USADO_OK",
  "Avariado": "AVARIA_ESTETICA",
  "Usado sem teste": "SEM_TESTE",
  // legado:
  "Usado funcionando": "USADO_OK",
  "Incompleto": "SEM_TESTE",
  "Sucata": "DEFEITO_PECAS",
  "NOVO_CAIXA_AVARIADA": "NOVO_LACRADO", // enum de condição legado → produto novo
};
export const estadoToCondicao = (estado, padrao = "USADO_OK") =>
  ESTADO_TO_COND[estado] || padrao;

// Eixo EMBALAGEM: multiplicador pequeno aplicado por cima da condição do produto.
// Calibrado pelo que o mercado online realmente cobra por caixa avariada (~3–12%),
// não pelo corte de usado.
export const EMBALAGEM_FATOR = {
  PERFEITA: 1.00, LEVE: 0.97, MEDIA: 0.93, FORTE: 0.88, SEM_CAIXA: 0.88,
};
// Normaliza texto livre de embalagem (EMBALAGENS em model.js) -> código do eixo.
export const embalagemToCod = (v) => {
  const s = (v || "").toLowerCase();
  if (s.includes("perfeit")) return "PERFEITA";
  if (s.includes("leve")) return "LEVE";
  if (s.includes("medi") || s.includes("méd")) return "MEDIA";
  if (s.includes("forte")) return "FORTE";
  if (s.includes("sem caixa") || s.includes("sem embalagem")) return "SEM_CAIXA";
  return "PERFEITA";
};

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
  // Eixo CONDIÇÃO DO PRODUTO (a caixa sai daqui e vira multiplicador de embalagem).
  condicao: {
    NOVO_LACRADO:    { fator: 0.85, ancora: "NOVO"  }, // era 0.80; +5pts pois a caixa agora ajusta à parte
    NOVO_SEM_LACRE:  { fator: 0.78, ancora: "NOVO"  }, // novo, sem lacre, não usado
    USADO_OK:        { fator: 0.92, ancora: "USADO" },
    AVARIA_ESTETICA: { fator: 0.75, ancora: "USADO" }, // avaria no PRODUTO, não na caixa
    SEM_TESTE:       { fator: 0.55, ancora: "USADO" },
    DEFEITO_PECAS:   { fator: 0.20, ancora: "USADO" },
    // NOVO_CAIXA_AVARIADA: removido — vira NOVO_LACRADO × fator_embalagem
  },
  embalagemFator: EMBALAGEM_FATOR,
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
  // Eixo embalagem: só corta produto novo (caixa de usado já está no fator de condição).
  const fEmb = (P.embalagemFator || EMBALAGEM_FATOR)[inp.embalagemCod] ?? 1;
  const pAnuncio = r2(refEff * cond.fator * fEmb * fRisco);

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
    // Breakdown dos eixos (UI): refEff × fCond (produto) × fEmb (embalagem) × fRisco.
    refEff, fCond: cond.fator, fEmb, fRisco, ancora: cond.ancora,
    sugestao: viavel ? "Publicar" : (isLocal ? "Rever preço/custo" : "Kit/Lote ou canal local"),
  };
}

// Título de anúncio por canal: Marca + Produto + Modelo + Estado + selo outlet.
export function gerarTitulo(item, canalCod = "ML") {
  const partes = [item.marca, item.produto, item.modelo].filter(Boolean);
  let t = partes.join(" ").replace(/\s+/g, " ").trim();
  const selo = item.estado === "Novo" ? "Novo" : "Outlet Testado";
  t = `${t} — ${selo}`;
  // Produto novo com caixa avariada: declarar a avaria da embalagem vira sinal de confiança.
  const novo = item.estado === "Novo" || item.estado === "Embalagem aberta/avariada";
  const caixaAvariada = item.cond_embalagem && item.cond_embalagem !== "PERFEITA";
  if (novo && caixaAvariada) t = `${t} (embalagem com avaria)`;
  const max = canalCod === "ML" ? 60 : 100;
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}
