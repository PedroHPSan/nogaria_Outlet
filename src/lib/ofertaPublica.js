// Oferta pública (link /p/<slug> com preview no WhatsApp): publica o snapshot, gera a
// imagem de preview (foto + preço) e a envia ao bucket público `og-previews`.
// A lógica pura está em ofertaCore.js / cardCore.js.
import { supabase } from "./supabase.js";
import { gerarSlug, fotosAssinadas } from "./catalogoPublico.js";
import { montarPayloadOferta, textoGrupo, MAX_ITENS_OFERTA } from "./ofertaCore.js";
import { cotacaoEuro } from "./cotacao.js";
import { carregarContato } from "./empresaConfig.js";

const LIMITE_OG = 300 * 1024; // acima disso o WhatsApp pode ignorar a imagem

async function gerarImagemPreview(itens, mostrarPreco, euro) {
  const [{ cardOgProduto, cardOgOferta }, { renderizarCard }, { prepararFotos }, { primeirasFotos }] = await Promise.all([
    import("./cardCore.js"), import("./cardImagem.js"), import("./catalogoImagens"), import("./fotos"),
  ]);
  const usados = itens.slice(0, 4);
  const urls = await primeirasFotos(usados.map((i) => i.sku));
  const entradas = usados.map((i) => ({ sku: i.sku, url: urls[i.sku] })).filter((e) => e.url);
  const fotos = entradas.length ? await prepararFotos(entradas).catch(() => ({})) : {};
  const card = itens.length === 1
    ? cardOgProduto(itens[0], { foto: fotos[itens[0].sku], mostrarPreco, euro })
    : cardOgOferta(usados, { fotos, mostrarPreco, euro });
  let blob = await renderizarCard(card, { tipo: "image/jpeg", qualidade: 0.82 });
  if (blob.size > LIMITE_OG) blob = await renderizarCard(card, { tipo: "image/jpeg", qualidade: 0.6 });
  return blob;
}

// itens: linhas de `itens` (1 → /p de produto; 2..12 → oferta com grade).
// Retorna { url, slug, payload, expira_em, semImagem }.
export async function publicarOferta(itens, { titulo, contato, mostrarPreco = true, euro = false } = {}) {
  const lista = (itens || []).slice(0, MAX_ITENS_OFERTA);
  if (!lista.length) throw new Error("Selecione ao menos 1 item.");
  const slug = gerarSlug();
  // euro: true → busca a cotação agora; ela vai estampada no preview (a página busca outra a cada visita).
  const cotacao = euro && mostrarPreco ? await cotacaoEuro() : null;

  let imagem = null;
  try {
    const blob = await gerarImagemPreview(lista, mostrarPreco, cotacao);
    const path = `${slug}.jpg`;
    const { error } = await supabase.storage.from("og-previews").upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (error) console.error("upload do preview falhou", error);
    else imagem =supabase.storage.from("og-previews").getPublicUrl(path).data.publicUrl;
  } catch (e) { console.error("preview da oferta falhou", e); /* sem preview: o link ainda funciona */ }

  const fotos = await fotosAssinadas(lista.map((i) => ({ rep: i })));
  const payload = montarPayloadOferta(lista, { titulo, contato, mostrarPreco, euro: cotacao, fotos, og: { imagem } });
  const { data: sess } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("catalogos_publicos")
    .insert({ slug, titulo: payload.titulo, edicao: "", payload, criado_por: sess?.user?.id })
    .select("slug, expira_em")
    .single();
  if (error) throw error;
  return { url: `${window.location.origin}/p/${data.slug}`, slug: data.slug, payload, expira_em: data.expira_em, semImagem: !imagem };
}

// SKUs desta oferta que já foram vendidos/entregues (RPC anônima por slug; falha → nenhum).
export async function skusIndisponiveis(slug) {
  try {
    const { data, error } = await supabase.rpc("oferta_indisponiveis", { p_slug: slug });
    return error ? [] : (data || []);
  } catch { return []; }
}

// Publica 1 produto com o contato da empresa e copia a mensagem pronta para o grupo.
// Retorna { texto, url, semImagem, copiado }. Sem clipboard, `copiado` é false (a tela mostra o texto).
export async function gerarLinkGrupo(item) {
  const c = await carregarContato();
  const r = await publicarOferta([item], { contato: { whatsapp: c.whatsapp, label: c.whatsappLabel } });
  const texto = textoGrupo(r.payload, r.url);
  let copiado = true;
  try { await navigator.clipboard.writeText(texto); } catch { copiado = false; }
  return { texto, url: r.url, semImagem: r.semImagem, copiado };
}
