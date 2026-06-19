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
