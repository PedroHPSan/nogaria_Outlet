// Orquestra a geração do orçamento (1..10 itens): busca TODAS as fotos de cada
// SKU, gera o QR do WhatsApp de cada produto e monta o HTML A4 — uma página por
// item. A impressão reusa o iframe isolado do portfólio (imprimirPortfolio → diálogo "Salvar como PDF").
import { supabase } from "./supabase.js";
import { fotosComoDataURI, imprimirPortfolio } from "./portfolio.js";
import { genQrDataUrl } from "./labels.js";
import { EMPRESA, waLink } from "./empresa.js";
import {
  gerarOrcamentoHTML, mensagemOrcamento, mensagemWhatsApp, totaisOrcamento,
} from "./anuncioTemplate.js";

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

// Teto de produtos por orçamento: acima disso a geração fica lenta (uma foto
// em dataURI por item) e o PDF pesa demais no celular.
export const LIMITE_ORCAMENTO = 10;

// Monta o orçamento de 1..LIMITE_ORCAMENTO itens (NÃO imprime). Cada página
// leva o QR do seu próprio produto; o `link` devolvido é o do orçamento todo.
// onProgress(feitas, total) roda a cada item concluído.
export async function montarOrcamento(itens, { empresa = EMPRESA, onProgress } = {}) {
  const lista = itens || [];
  if (!lista.length) throw new Error("Selecione ao menos um produto.");
  if (lista.length > LIMITE_ORCAMENTO) {
    throw new Error(`Máximo de ${LIMITE_ORCAMENTO} produtos por orçamento.`);
  }

  let feitas = 0;
  const partes = await Promise.all(
    lista.map(async (it) => {
      const [fotos, qrDataUrl] = await Promise.all([
        fotosDoItem(it.sku),
        genQrDataUrl(waLink(mensagemWhatsApp(it))),
      ]);
      feitas += 1;
      onProgress?.(feitas, lista.length);
      return [it.sku, { fotos, qrDataUrl }];
    })
  );

  const porSku = Object.fromEntries(partes);
  const mensagem = mensagemOrcamento(lista);
  const { total, semPreco, semFoto } = totaisOrcamento(lista);
  return {
    html: gerarOrcamentoHTML(lista, { porSku, empresa }),
    mensagem,
    link: waLink(mensagem),
    total,
    semPreco,
    semFoto,
  };
}

// Compat: orçamento de um item só.
export const montarAnuncio = (item, empresa = EMPRESA) => montarOrcamento([item], { empresa });

// Impressão (iframe isolado → diálogo do navegador com "Salvar como PDF").
export const imprimirAnuncio = imprimirPortfolio;
