// Geração do catálogo a partir de uma lista de itens já filtrada (seleção, sala ou aba
// Catálogo): PDF em arquivo (jsPDF) e cards de divulgação em PNG.
import { dedupCatalogo, agruparCatalogo, linkInteresseItem } from "./catalogoCore.js";
import { prepararFotos } from "./catalogoImagens";
import { primeirasFotos } from "./fotos";
import { normalizarSpec } from "./catalogoSpec.js";
import { LOGO_HORIZONTAL, LOGO_BRANCO } from "./catalogoLogos";

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

// Cards de divulgação (PNG) para Instagram/WhatsApp: carrossel (capa + produtos + chamada)
// ou um card único. Retorna [{ nome, blob }]. Fotos só dos itens que entram nos slides.
export async function gerarCardsDivulgacao(itens, { formato = "feed", titulo = "Catálogo Nogária Outlet", tema = "noite", contato = {}, mostrarPreco = true } = {}, { signal, onProgress } = {}) {
  const [{ montarCarrossel }, { renderizarCard }, { genQrDataUrl }] = await Promise.all([
    import("./cardCore.js"), import("./cardImagem.js"), import("./labels.js"),
  ]);
  const escolhidos = itens.slice(0, 8);
  const urls = await primeirasFotos(escolhidos.map((i) => i.sku));
  const entradas = escolhidos.map((i) => ({ sku: i.sku, url: urls[i.sku] })).filter((e) => e.url);
  const fotos = entradas.length ? await prepararFotos(entradas, { signal, onProgress }) : {};
  const numero = contato.whatsapp || "";
  const qrContato = numero ? await genQrDataUrl(`https://wa.me/${numero}?text=${encodeURIComponent("Olá! Vi o anúncio da Nogária Outlet e quero atendimento.")}`) : null;
  const ctxPorSku = Object.fromEntries(escolhidos.map((i) => [i.sku, { foto: fotos[i.sku] }]));
  const slides = montarCarrossel(itens, titulo, formato, ctxPorSku, { tema, contato, mostrarPreco, qrContato, logoBranco: LOGO_BRANCO, logoRatio: 265 / 520 });
  const saida = [];
  for (let i = 0; i < slides.length; i++) {
    saida.push({ nome: `${formato}-${String(i + 1).padStart(2, "0")}.png`, blob: await renderizarCard(slides[i]) });
  }
  return saida;
}
