// Monta o HTML do catálogo a partir de uma lista de itens já filtrada (seleção ou
// sala). Mesmo pipeline da aba Catálogo: dedup → seções → fotos comprimidas → HTML.
import { dedupCatalogo, agruparCatalogo, linkInteresseItem } from "./catalogoCore.js";
import { gerarCatalogoHTML } from "./catalogoTemplate";
import { prepararFotos } from "./catalogoImagens";
import { primeirasFotos } from "./fotos";
import { normalizarSpec } from "./catalogoSpec.js";
import { LOGO_HORIZONTAL, LOGO_BRANCO } from "./catalogoLogos";

// opts: { titulo, edicao, agrupar, comFoto, mostrarPreco, comQr, signal, onProgress }
export async function gerarCatalogoDeItens(itens, opts = {}) {
  const {
    titulo = "Catálogo de Produtos", edicao = "", agrupar = "categoria",
    comFoto = true, mostrarPreco = true, comQr = true, signal, onProgress,
  } = opts;

  const cards = dedupCatalogo(itens);
  const secoes = agruparCatalogo(cards, agrupar);
  const cats = [...new Set(itens.map((i) => (i.grupo || "").trim()).filter(Boolean))];

  let fotos = {};
  if (comFoto) {
    const urls = await primeirasFotos(cards.map((c) => c.rep.sku));
    const entradas = cards.map((c) => ({ sku: c.rep.sku, url: urls[c.rep.sku] })).filter((e) => e.url);
    if (entradas.length) fotos = await prepararFotos(entradas, { signal, onProgress });
  }

  let qrs = null;
  if (comQr) {
    const { genQrDataUrl } = await import("./labels.js"); // qrcode só carrega quando usado
    qrs = {};
    await Promise.all(cards.map(async (c) => { qrs[c.rep.sku] = await genQrDataUrl(linkInteresseItem(c.rep)); }));
  }

  return gerarCatalogoHTML(secoes, {
    titulo: titulo.trim() || "Catálogo de Produtos",
    subtitulo: cats.join(" · "),
    edicao, parcial: false, comFoto, mostrarPreco, fotos, qrs,
  });
}

// Catálogo em PDF ARQUIVO (jsPDF) a partir de uma spec. Retorna { blob, resumo, spec }.
// A spec é normalizada aqui: valores inválidos voltam ao padrão.
export async function gerarCatalogoPdfDeItens(itens, specEntrada = {}, { signal, onProgress } = {}) {
  const spec = normalizarSpec(specEntrada);
  const cards = dedupCatalogo(itens);
  const secoes = agruparCatalogo(cards, spec.agrupar);

  let fotos = {};
  if (spec.campos.foto) {
    const urls = await primeirasFotos(cards.map((c) => c.rep.sku));
    const entradas = cards.map((c) => ({ sku: c.rep.sku, url: urls[c.rep.sku] })).filter((e) => e.url);
    if (entradas.length) fotos = await prepararFotos(entradas, { signal, onProgress });
  }

  const { genQrDataUrl } = await import("./labels.js");
  const numero = spec.contato.whatsapp;
  const qrs = {};
  if (spec.campos.qr) {
    await Promise.all(cards.map(async (c) => { qrs[c.rep.sku] = await genQrDataUrl(linkInteresseItem(c.rep, numero)); }));
  }
  qrs.__contato = await genQrDataUrl(`https://wa.me/${numero}?text=${encodeURIComponent("Olá! Vi o catálogo da Nogária Outlet e quero atendimento.")}`);

  const { gerarCatalogoPdf } = await import("./catalogoPdf.js"); // jspdf só carrega ao gerar
  const ctx = {
    fotos, qrs, contato: spec.contato,
    logos: { horizontal: LOGO_HORIZONTAL, horizontalRatio: 140 / 900, branco: LOGO_BRANCO, brancoRatio: 265 / 520 },
  };
  const { blob, resumo } = gerarCatalogoPdf(secoes, spec, ctx);
  return { blob, resumo, spec };
}
