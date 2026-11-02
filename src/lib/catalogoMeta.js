// Catálogo Meta (WhatsApp/Instagram/Facebook) e página pública /i/<sku>: publicar/retirar um item e ler
// a página. O snapshot usa o mesmo formato da oferta /p (1 item); disponibilidade é calculada ao vivo no banco.
import { supabase } from "./supabase.js";
import { montarPayloadOferta } from "./ofertaCore.js";
import { carregarContato } from "./empresaConfig.js";
import { separarDisponiveis, textoBloqueados } from "./ofertaPublica.js";
import { primeirasFotos } from "./fotos.js";

const LADO_MAX = 1600;

// A Meta exige JPEG/PNG com URL estável: baixa a foto (URL assinada), reduz e converte para JPEG.
async function fotoParaJpeg(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("não consegui baixar a foto do item");
  const bmp = await createImageBitmap(await resp.blob());
  const k = Math.min(1, LADO_MAX / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * k); canvas.height = Math.round(bmp.height * k);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("falha ao gerar a imagem"))), "image/jpeg", 0.85));
}

// Publica (ou atualiza preço/foto) o item no catálogo. Recusa item vendido/separado ou sem foto/preço.
export async function publicarNoCatalogo(item) {
  const { disponiveis, bloqueados } = await separarDisponiveis([item]);
  if (!disponiveis.length) throw new Error(`Item indisponível: ${textoBloqueados(bloqueados)}.`);
  const fotos = await primeirasFotos([item.sku]);
  if (!fotos[item.sku]) throw new Error("O item precisa de ao menos 1 foto para entrar no catálogo.");
  const caminho = `${item.sku}.jpg`;
  const { error: eUp } = await supabase.storage.from("catalogo-meta").upload(caminho, await fotoParaJpeg(fotos[item.sku]), {
    contentType: "image/jpeg", upsert: true, cacheControl: "300",
  });
  if (eUp) throw eUp;
  // `?v=` força a Meta a rever a imagem quando a foto muda.
  const urlFoto = `${supabase.storage.from("catalogo-meta").getPublicUrl(caminho).data.publicUrl}?v=${Date.now()}`;
  const c = await carregarContato();
  const payload = montarPayloadOferta([item], {
    contato: { whatsapp: c.whatsapp, label: c.whatsappLabel }, mostrarPreco: true, euro: false, // catálogo Meta só em R$
    fotos: { [item.sku]: urlFoto }, og: { imagem: urlFoto },
  });
  if (!(payload.itens[0].preco > 0)) throw new Error("O item precisa de preço de venda para entrar no catálogo.");
  const { error } = await supabase.rpc("catalogo_meta_publicar", { p_sku: item.sku, p_payload: payload });
  if (error) throw error;
}

export async function retirarDoCatalogo(sku) {
  const { error } = await supabase.rpc("catalogo_meta_retirar", { p_sku: sku });
  if (error) throw error;
}

// Estado do item no catálogo (tela do operador): { estado, atualizado } ou null.
export async function estadoNoCatalogo(sku) {
  const { data } = await supabase.from("listing_state").select("estado, sync_em").eq("sku", sku).eq("canal", "whatsapp").maybeSingle();
  return data ? { estado: data.estado, atualizado: data.sync_em } : null;
}

// Página pública (anônimo): { payload, disponivel } ou null se o item não está publicado.
export async function buscarItemPublico(sku) {
  try {
    const { data, error } = await supabase.rpc("item_publico", { p_sku: sku });
    return error || !data ? null : data;
  } catch { return null; }
}
