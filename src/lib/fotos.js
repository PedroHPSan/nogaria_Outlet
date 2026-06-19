// Miniaturas de itens: resolve a 1ª foto (menor ordem) de cada SKU em uma URL
// assinada do bucket fotos-produtos. Usado nas listas (Itens, Conferência) para
// facilitar a identificação visual do produto.
import { supabase } from "./supabase";

const BUCKET = "fotos-produtos";

// Retorna { [sku]: signedUrl } só para os SKUs que têm foto. Trabalha em lotes
// para não estourar o tamanho da query/assinatura quando há muitos itens.
export async function primeirasFotos(skus) {
  const lista = [...new Set((skus || []).filter(Boolean))];
  if (!lista.length) return {};

  const out = {};
  const CHUNK = 200;
  for (let i = 0; i < lista.length; i += CHUNK) {
    const grupo = lista.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("fotos")
      .select("sku, storage_path, ordem")
      .in("sku", grupo)
      .order("ordem");
    if (error || !data?.length) continue;

    // data vem ordenado por ordem; a 1ª ocorrência de cada SKU é a de menor ordem.
    const primeiraPorSku = new Map();
    for (const f of data) if (!primeiraPorSku.has(f.sku)) primeiraPorSku.set(f.sku, f.storage_path);

    const paths = [...primeiraPorSku.values()];
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
    const urlByPath = {};
    for (const s of signed || []) if (s?.signedUrl) urlByPath[s.path] = s.signedUrl;

    for (const [sku, path] of primeiraPorSku) if (urlByPath[path]) out[sku] = urlByPath[path];
  }
  return out;
}

// Envia uma foto de um item para o storage e registra em `fotos`. Retorna a linha
// criada já com `url` assinada. Sufixo aleatório evita colisão em envios rápidos.
export async function enviarFoto(sku, file, ordem = 0) {
  const ext = (file.name?.split(".").pop() || "jpg").toLowerCase();
  const path = `${sku}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw error;
  const { data: nova } = await supabase.from("fotos").insert({ sku, storage_path: path, ordem }).select().single();
  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  return { ...nova, url: signed?.signedUrl };
}

// Marca o item como fotografado (foto_feita = true) sem mexer no status.
export async function marcarFotoFeita(sku) {
  await supabase.from("itens").update({ foto_feita: true }).eq("sku", sku);
}
