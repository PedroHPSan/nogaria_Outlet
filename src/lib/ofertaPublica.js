// Oferta pública (link /p/<slug> com preview no WhatsApp): publica o snapshot, gera a
// imagem de preview (foto + preço) e a envia ao bucket público `og-previews`.
// A lógica pura está em ofertaCore.js / cardCore.js.
import { supabase } from "./supabase.js";
import { gerarSlug, fotosAssinadas } from "./catalogoPublico.js";
import { montarPayloadOferta, textoGrupo, MAX_ITENS_OFERTA } from "./ofertaCore.js";
import { cotacaoEuro } from "./cotacao.js";
import { textoGrupoEuro } from "./precoEuro.js";
import { carregarContato } from "./empresaConfig.js";
import { indisponivelParaVenda, motivoIndisponivel } from "./model.js";

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

// Trava contra revenda: relê do banco status e reserva (a tela pode estar desatualizada) e separa
// o que ainda pode ser oferecido. Vendido/entregue/descarte e separado em sacola não entram.
export async function separarDisponiveis(itens) {
  const skus = (itens || []).map((i) => i.sku);
  if (!skus.length) return { disponiveis: [], bloqueados: [] };
  const { data, error } = await supabase.from("itens").select("sku, status, reservado_ate, reservado_por_orc").in("sku", skus);
  if (error) throw error;
  const atual = new Map((data || []).map((r) => [r.sku, r]));
  const disponiveis = [], bloqueados = [];
  for (const it of itens) {
    const a = atual.get(it.sku);
    if (!a) bloqueados.push({ sku: it.sku, motivo: "não encontrado" });
    else if (indisponivelParaVenda(a)) bloqueados.push({ sku: it.sku, motivo: motivoIndisponivel(a) });
    else disponiveis.push(it);
  }
  return { disponiveis, bloqueados };
}

export const textoBloqueados = (bloqueados) =>
  bloqueados.map((b) => `${b.sku} (${b.motivo})`).join(", ");

// itens: linhas de `itens` (1 → /p de produto; 2..12 → oferta com grade).
// Itens vendidos ou separados em sacola são retirados; se não sobrar nenhum, recusa.
// Retorna { url, slug, payload, expira_em, semImagem, bloqueados }.
export async function publicarOferta(itens, { titulo, contato, mostrarPreco = true, euro = false } = {}) {
  const { disponiveis, bloqueados } = await separarDisponiveis((itens || []).slice(0, MAX_ITENS_OFERTA));
  const lista = disponiveis;
  if (!lista.length) {
    if (bloqueados.length) throw new Error(`Não é possível gerar link: já vendido ou separado — ${textoBloqueados(bloqueados)}.`);
    throw new Error("Selecione ao menos 1 item.");
  }
  const slug = gerarSlug();
  // euro: true → busca a cotação agora; ela vai estampada no preview (a página busca outra a cada visita).
  const cotacao = euro && mostrarPreco ? await cotacaoEuro().catch(() => null) : null; // sem cotação: o link sai só em reais

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
  if (cotacao) payload.cotacao = { taxa: cotacao.taxa, em: cotacao.em }; // auditoria do preview
  const { data: sess } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("catalogos_publicos")
    .insert({ slug, titulo: payload.titulo, edicao: "", payload, criado_por: sess?.user?.id })
    .select("slug, expira_em")
    .single();
  if (error) throw error;
  return { url: `${window.location.origin}/p/${data.slug}`, slug: data.slug, payload, expira_em: data.expira_em, semImagem: !imagem, cotacao, semCotacao: euro && mostrarPreco && !cotacao, bloqueados };
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
// euro (padrão): um link para os dois públicos — cartão com € e R$, página com seletor BR/EU.
export async function gerarLinkGrupo(item, { euro = true } = {}) {
  const c = await carregarContato();
  const r = await publicarOferta([item], { contato: { whatsapp: c.whatsapp, label: c.whatsappLabel }, euro });
  const texto = r.cotacao ? textoGrupoEuro(r.payload, r.url, r.cotacao) : textoGrupo(r.payload, r.url);
  let copiado = true;
  try { await navigator.clipboard.writeText(texto); } catch { copiado = false; }
  return { texto, url: r.url, semImagem: r.semImagem, semCotacao: r.semCotacao, copiado };
}
