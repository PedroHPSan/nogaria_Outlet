// Catálogo público (link compartilhável, snapshot de 30 dias). As funções puras
// (montarPayload, slugDeBytes) são testáveis em Node; publicar/buscar tocam o
// supabase. O payload é AUTOCONTIDO: a página pública renderiza só a partir dele,
// sem consultar `itens` nem o storage (anônimo lê um único registro).
import { supabase } from "./supabase.js";
import { precoVenda } from "./export.js";
import { CATALOGO_ESTADO_BADGE } from "./catalogoCore.js";

const VALIDADE_SEG = 30 * 24 * 60 * 60; // 30 dias (para as signed URLs das fotos)

// Monta o snapshot renderizável a partir das seções (agruparCatalogo), das opções
// e do mapa { [sku]: url } de fotos representativas. Puro.
export function montarPayload(secoes, opcoes = {}, fotosUrl = {}) {
  const { titulo = "Catálogo de Produtos", edicao = "", subtitulo = "", mostrarPreco = true } = opcoes;
  let totalItens = 0;
  const secoesOut = (secoes || []).map((sec) => ({
    titulo: sec.titulo,
    cards: (sec.cards || []).map((c) => {
      totalItens += c.qtd || 1;
      const badge = CATALOGO_ESTADO_BADGE[(c.rep.estado || "").trim()] || null;
      return {
        produto: c.rep.produto || c.rep.sku,
        marca: c.rep.marca || "",
        cor: c.rep.cor || "",
        badge: badge ? { txt: badge.txt, cls: badge.cls } : null,
        preco: mostrarPreco ? (precoVenda(c.rep) ?? null) : null,
        qtd: c.qtd || 1,
        foto: fotosUrl[c.rep.sku] || null,
      };
    }),
  }));
  return { versao: 1, titulo, edicao, subtitulo, mostrarPreco, totalItens, secoes: secoesOut };
}

// Converte bytes em um slug url-safe (base36). Puro.
export function slugDeBytes(bytes) {
  let s = "";
  for (const b of bytes) s += (b % 36).toString(36);
  return s;
}

// Gera um slug aleatório (browser: crypto). ~12 chars.
export function gerarSlug() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return slugDeBytes(bytes);
}

// Gera signed URLs de longa validade (30d) das fotos representativas. Retorna
// { [sku]: url }. Best-effort: foto que falhar fica de fora (card sem foto).
async function fotosAssinadas(cards) {
  const skus = cards.map((c) => c.rep.sku);
  if (!skus.length) return {};
  // 1ª foto (menor ordem) de cada SKU.
  const { data } = await supabase.from("fotos").select("sku, storage_path, ordem").in("sku", skus).order("ordem");
  const primeiraPorSku = new Map();
  for (const f of data || []) if (!primeiraPorSku.has(f.sku)) primeiraPorSku.set(f.sku, f.storage_path);
  const paths = [...primeiraPorSku.values()];
  if (!paths.length) return {};
  const { data: signed } = await supabase.storage.from("fotos-produtos").createSignedUrls(paths, VALIDADE_SEG);
  const urlByPath = {};
  for (const s of signed || []) if (s?.signedUrl) urlByPath[s.path] = s.signedUrl;
  const out = {};
  for (const [sku, path] of primeiraPorSku) if (urlByPath[path]) out[sku] = urlByPath[path];
  return out;
}

// Publica o catálogo e retorna { url, expira_em }. `secoes` = saída de agruparCatalogo.
export async function publicarCatalogo(secoes, opcoes = {}) {
  const cards = (secoes || []).flatMap((s) => s.cards || []);
  const fotosUrl = opcoes.comFoto === false ? {} : await fotosAssinadas(cards);
  const payload = montarPayload(secoes, opcoes, fotosUrl);
  const { data: sess } = await supabase.auth.getUser();
  const slug = gerarSlug();
  const { data, error } = await supabase
    .from("catalogos_publicos")
    .insert({ slug, titulo: payload.titulo, edicao: payload.edicao, payload, criado_por: sess?.user?.id })
    .select("slug, expira_em")
    .single();
  if (error) throw error;
  return { url: `${window.location.origin}/c/${data.slug}`, expira_em: data.expira_em };
}

// Busca um catálogo público pelo slug. Retorna { titulo, edicao, payload, expira_em }
// ou null (expirado/inexistente — o RLS já filtra os expirados).
export async function buscarCatalogoPublico(slug) {
  const { data, error } = await supabase
    .from("catalogos_publicos")
    .select("titulo, edicao, payload, expira_em")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}
