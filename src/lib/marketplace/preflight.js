// preflight.js — gate de publicação em marketplace (Amazon v1, modo oferta).
// JS puro, sem imports/rede: o cliente usa como UX e a Edge re-valida tudo no servidor.
// Guardrail central de PREÇO: só publica com preco_ideal > 0 e dentro de banda de sanidade.
// NUNCA usa preco_sugerido/preco_min/preco_novo_est (campos quebrados).

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Valida um identificador de produto. EAN-13, UPC-12, GTIN-14 ou ASIN (10 alfanuméricos
// com ao menos uma letra). Retorna { ok, tipo, valor } — tipo p/ o payload da SP-API.
export function gtinValido(g) {
  const s = String(g ?? "").trim().toUpperCase();
  if (/^\d{13}$/.test(s)) return { ok: true, tipo: "EAN", valor: s };
  if (/^\d{12}$/.test(s)) return { ok: true, tipo: "UPC", valor: s };
  if (/^\d{14}$/.test(s)) return { ok: true, tipo: "GTIN", valor: s };
  if (/^[A-Z0-9]{10}$/.test(s) && /[A-Z]/.test(s)) return { ok: true, tipo: "ASIN", valor: s };
  return { ok: false, tipo: null, valor: null };
}

// Só é publicável quando há um preço de venda real (preco_ideal > 0).
export function precoPublicavel(it) {
  const p = num(it?.preco_ideal);
  return p != null && p > 0;
}

// Banda de sanidade: preco_ideal entre min×–max× do preço de referência NOVO.
// Sem referência confiável ⇒ não bloqueia (ok:true, ratio:null).
export function bandaPreco(it, { min = 0.4, max = 2.5 } = {}) {
  const p = num(it?.preco_ideal);
  const ref = num(it?.preco_ref_novo);
  if (p == null || ref == null || ref <= 0) return { ok: true, ratio: null, min, max };
  const ratio = p / ref;
  return { ok: ratio >= min && ratio <= max, ratio, min, max };
}

// Marcas que costumam exigir aprovação (gating) na Amazon BR. Lista ilustrativa —
// só gera AVISO, nunca bloqueia. Ajustar conforme a conta for sendo aprovada.
const MARCAS_GATED = new Set([
  "apple", "samsung", "sony", "lg", "nike", "adidas", "dyson", "bose", "disney", "lego",
  "philips", "xiaomi", "jbl", "hp", "dell",
]);
export function marcaGated(it) {
  const m = String(it?.marca ?? "").trim().toLowerCase();
  if (!m) return { gated: false, semMarca: true };
  return { gated: MARCAS_GATED.has(m), semMarca: false };
}

// Gate completo. ok = todos os checks BLOQUEANTES passam (preco, banda, gtin).
// Avisos (foto, marca) não afetam ok. idProduto = o identificador a usar no payload.
export function preflightAmazon(it) {
  const gv = gtinValido(it?.gtin);
  const banda = bandaPreco(it);
  const mg = marcaGated(it);
  const temPreco = precoPublicavel(it);

  const checks = [
    { id: "preco", label: "Preço de venda definido", bloqueante: true, ok: temPreco,
      motivo: temPreco ? null : "Defina o preço de venda (preco_ideal > 0) — não usar sugerido/mínimo." },
    { id: "banda", label: "Preço na faixa de sanidade (0,4×–2,5× do novo)", bloqueante: true, ok: banda.ok,
      motivo: banda.ok ? null : `Preço ${banda.ratio != null ? banda.ratio.toFixed(2) + "×" : ""} a referência (fora de 0,4×–2,5×).` },
    { id: "gtin", label: "GTIN/EAN/UPC ou ASIN válido", bloqueante: true, ok: gv.ok,
      motivo: gv.ok ? null : "Informe um GTIN/EAN (13), UPC (12), GTIN-14 ou ASIN." },
    { id: "foto", label: "Tem foto", bloqueante: false, ok: it?.foto_feita === true,
      motivo: it?.foto_feita === true ? null : "Sem foto (recomendado para anúncio; não bloqueia)." },
    { id: "marca", label: "Marca não restrita", bloqueante: false, ok: !mg.gated && !mg.semMarca,
      motivo: mg.semMarca ? "Sem marca informada." : (mg.gated ? "Marca pode exigir aprovação na Amazon (gated)." : null) },
  ];

  const ok = checks.filter((c) => c.bloqueante).every((c) => c.ok);
  return { ok, modo: "oferta", checks, idProduto: gv.ok ? { tipo: gv.tipo, valor: gv.valor } : null };
}
