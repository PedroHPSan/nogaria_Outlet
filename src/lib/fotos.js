// Miniaturas de itens: resolve a 1ª foto (menor ordem) de cada SKU em uma URL
// assinada do bucket fotos-produtos. Usado nas listas (Itens, Conferência) para
// facilitar a identificação visual do produto.
import { supabase } from "./supabase";
import { novaOrdemPrincipal } from "./model";

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

// Define a foto principal (capa) do item: dá a ela a menor `ordem` do SKU, então
// ela passa a ser a 1ª em todos os consumidores. Não reordena as demais.
export async function definirFotoPrincipal(sku, fotoId) {
  const { data: fotos } = await supabase.from("fotos").select("ordem").eq("sku", sku);
  const ordem = novaOrdemPrincipal(fotos || []);
  const { error } = await supabase.from("fotos").update({ ordem }).eq("id", fotoId);
  if (error) throw error;
}

// Marca o item como fotografado (foto_feita = true) sem mexer no status.
export async function marcarFotoFeita(sku) {
  await supabase.from("itens").update({ foto_feita: true }).eq("sku", sku);
}

// Replica as fotos de um item para outro (usado ao desmembrar em várias unidades).
// Faz CÓPIA FÍSICA no storage — cada unidade fica com seus próprios arquivos sob o
// próprio SKU, pois apagar a foto de uma (apagarFoto) remove o objeto do storage e
// não pode afetar as irmãs. Best-effort por foto: um erro não aborta as demais.
// Marca foto_feita=true no destino se copiou ao menos uma. Retorna a quantidade.
export async function copiarFotos(skuOrigem, skuDestino) {
  if (!skuOrigem || !skuDestino || skuOrigem === skuDestino) return 0;
  const { data: origem, error } = await supabase
    .from("fotos").select("storage_path, ordem").eq("sku", skuOrigem).order("ordem");
  if (error || !origem?.length) return 0;

  let n = 0;
  for (const f of origem) {
    const ext = (f.storage_path.split(".").pop() || "jpg").toLowerCase();
    const novoPath = `${skuDestino}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const { error: ce } = await supabase.storage.from(BUCKET).copy(f.storage_path, novoPath);
    if (ce) continue; // best-effort: pula esta foto
    const { error: ie } = await supabase.from("fotos").insert({ sku: skuDestino, storage_path: novoPath, ordem: f.ordem });
    if (ie) { await supabase.storage.from(BUCKET).remove([novoPath]); continue; } // evita órfão
    n++;
  }
  if (n) await supabase.from("itens").update({ foto_feita: true }).eq("sku", skuDestino);
  return n;
}
