// Monta o HTML do catálogo a partir de uma lista de itens já filtrada (seleção ou
// sala). Mesmo pipeline da aba Catálogo: dedup → seções → fotos comprimidas → HTML.
import { dedupCatalogo, agruparCatalogo, linkInteresseItem } from "./catalogoCore.js";
import { gerarCatalogoHTML } from "./catalogoTemplate";
import { prepararFotos } from "./catalogoImagens";
import { primeirasFotos } from "./fotos";

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
