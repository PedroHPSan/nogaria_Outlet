// Orquestra a geração do anúncio/orçamento de um item: busca TODAS as fotos do SKU,
// gera o QR do link de WhatsApp e monta o HTML A4 (anuncioTemplate). A impressão reusa
// o iframe isolado do portfólio (imprimirPortfolio → diálogo "Salvar como PDF").
import { supabase } from "./supabase.js";
import { fotosComoDataURI, imprimirPortfolio } from "./portfolio.js";
import { genQrDataUrl } from "./labels.js";
import { EMPRESA, waLink } from "./empresa.js";
import { gerarAnuncioHTML, mensagemWhatsApp } from "./anuncioTemplate.js";

const BUCKET = "fotos-produtos";

// Todas as fotos do SKU (ordenadas por `ordem`) já como dataURI. A 1ª é a principal.
// Retorna { principal, galeria: [] } — best-effort (foto que falhar é omitida).
export async function fotosDoItem(sku) {
  if (!sku) return { principal: null, galeria: [] };
  const { data, error } = await supabase
    .from("fotos").select("storage_path, ordem").eq("sku", sku).order("ordem");
  if (error || !data?.length) return { principal: null, galeria: [] };

  const paths = data.map((f) => f.storage_path);
  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
  // Chaves sintéticas f0..fN preservam a ORDEM ao converter para dataURI.
  const urls = {};
  (signed || []).forEach((s, i) => { if (s?.signedUrl) urls[`f${i}`] = s.signedUrl; });
  const dataUris = await fotosComoDataURI(urls);
  const ordenadas = paths.map((_, i) => dataUris[`f${i}`]).filter(Boolean);
  return { principal: ordenadas[0] || null, galeria: ordenadas.slice(1) };
}

// Monta o anúncio completo (NÃO imprime). Retorna { html, mensagem, link }.
export async function montarAnuncio(item, empresa = EMPRESA) {
  const mensagem = mensagemWhatsApp(item, empresa);
  const link = waLink(mensagem);
  const [fotos, qrDataUrl] = await Promise.all([
    fotosDoItem(item.sku),
    genQrDataUrl(link),
  ]);
  const html = gerarAnuncioHTML(item, { fotos, qrDataUrl, empresa });
  return { html, mensagem, link };
}

// Impressão (iframe isolado → diálogo do navegador com "Salvar como PDF").
export const imprimirAnuncio = imprimirPortfolio;
