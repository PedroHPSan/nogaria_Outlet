// Oferta pública para o grupo de WhatsApp (PURO): payload do link /p/<slug>, metadados
// do preview (og:*) e mensagem de interesse. Sem rede; testável em Node.
import { precoVenda } from "./export.js";
import { CATALOGO_ESTADO_BADGE, fraseCondicao } from "./catalogoCore.js";

export const MAX_ITENS_OFERTA = 12;
export const LIMITE_TITULO_OG = 70;
export const LIMITE_DESC_OG = 160;

const brl = (v) => `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: Number.isInteger(Number(v)) ? 0 : 2, maximumFractionDigits: 2 })}`;
const cortar = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`; };
const num = (v) => { const n = Number(v); return n > 0 ? String(Math.round(n * 10) / 10).replace(".", ",") : null; };

export function medidasTexto(it) {
  const m = [it?.comprimento_cm, it?.largura_cm, it?.altura_cm].map(num);
  return m.every(Boolean) ? `${m.join(" x ")} cm (C x L x A)` : "";
}

// Título do preview: "Produto — R$ 1.299". Sem preço, só o nome.
export function tituloOg(it, { mostrarPreco = true } = {}) {
  const p = precoVenda(it);
  const nome = it?.produto || it?.sku || "Produto";
  if (!mostrarPreco || !p) return cortar(nome, LIMITE_TITULO_OG);
  const sufixo = ` — ${brl(p)}`;
  return `${cortar(nome, LIMITE_TITULO_OG - sufixo.length)}${sufixo}`;
}

// Descrição do preview (≤ 160): condição · marca · medidas · cor.
export function descricaoOg(it) {
  const partes = [fraseCondicao(it), it?.marca, medidasTexto(it), it?.cor].map((s) => String(s || "").trim()).filter(Boolean);
  const base = partes.length ? partes.join(" · ") : "Produto com preço de outlet.";
  return cortar(`${base}. Toque e chame no WhatsApp.`, LIMITE_DESC_OG);
}

// Item do payload: só o que a página pública precisa (sem custo/margem).
export function itemOferta(it, foto = null, { mostrarPreco = true } = {}) {
  const badge = CATALOGO_ESTADO_BADGE[(it.estado || "").trim()] || null;
  return {
    sku: it.sku,
    produto: it.produto || it.sku,
    marca: it.marca || "",
    cor: it.cor || "",
    medidas: medidasTexto(it),
    condicao: fraseCondicao(it),
    badge: badge ? { txt: badge.txt, cls: badge.cls } : null,
    preco: mostrarPreco ? (precoVenda(it) ?? null) : null,
    foto,
  };
}

// itens: linhas de `itens`; fotos: { [sku]: url assinada }; og: { imagem } (URL pública do preview).
export function montarPayloadOferta(itens, { titulo, contato = null, mostrarPreco = true, fotos = {}, og = {} } = {}) {
  const lista = (itens || []).slice(0, MAX_ITENS_OFERTA);
  if (!lista.length) throw new Error("Selecione ao menos 1 item.");
  const unico = lista.length === 1;
  const wa = String(contato?.whatsapp || "").replace(/\D/g, "");
  const precos = lista.map((i) => precoVenda(i)).filter((p) => p > 0);
  const tituloOferta = cortar(titulo || (unico ? lista[0].produto : "Ofertas Nogária Outlet"), LIMITE_TITULO_OG);
  return {
    versao: 3,
    tipo: unico ? "produto" : "oferta",
    titulo: tituloOferta,
    mostrarPreco,
    totalItens: lista.length,
    contato: wa.length >= 12
      ? { nome: String(contato?.nome || "").slice(0, 60), whatsapp: wa, label: String(contato?.label || "").slice(0, 30) }
      : null,
    og: {
      titulo: unico ? tituloOg(lista[0], { mostrarPreco }) : tituloOferta,
      descricao: unico
        ? descricaoOg(lista[0])
        : cortar(`${lista.length} peças em oferta${mostrarPreco && precos.length ? ` a partir de ${brl(Math.min(...precos))}` : ""}. Toque para ver e chamar no WhatsApp.`, LIMITE_DESC_OG),
      imagem: og.imagem || null,
    },
    itens: lista.map((i) => itemOferta(i, fotos[i.sku] || null, { mostrarPreco })),
  };
}

// Mensagem que o cliente envia à Bárbara ao tocar em "Quero este".
export function linkInteresseOferta(item, numero, url) {
  const p = item.preco > 0 ? ` — ${brl(item.preco)}` : "";
  const texto = `Olá! Tenho interesse em ${item.produto} (${item.sku})${p}.${url ? ` ${url}` : ""}`;
  return `https://wa.me/${String(numero || "").replace(/\D/g, "")}?text=${encodeURIComponent(texto)}`;
}

// Mensagem curta para colar no grupo junto do link (um produto por mensagem).
export function textoGrupo(payload, url) {
  const it = payload.itens[0];
  const p = payload.itens.length === 1 && it.preco > 0 ? ` — *${brl(it.preco)}*` : "";
  return `*${payload.titulo}*${payload.itens.length === 1 ? p : ""}\n${url}`;
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escaparHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

// HTML mínimo servido SÓ aos robôs de preview (WhatsApp etc.) em /p/<slug> e /c/<slug>;
// o vercel.json separa por user-agent, então pessoas continuam recebendo a SPA.
export function montarHtmlOg({ titulo, descricao, imagem, url }) {
  const t = escaparHtml(titulo || "Nogária Outlet");
  const d = escaparHtml(descricao || "Ofertas da Nogária Outlet.");
  const tags = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Nogária Outlet">`,
    `<meta property="og:title" content="${t}">`,
    `<meta property="og:description" content="${d}">`,
    url ? `<meta property="og:url" content="${escaparHtml(url)}">` : "",
    imagem ? `<meta property="og:image" content="${escaparHtml(imagem)}">` : "",
    imagem ? `<meta property="og:image:width" content="800"><meta property="og:image:height" content="800">` : "",
    `<meta name="twitter:card" content="summary">`,
  ].filter(Boolean).join("\n");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${t}</title>
<meta name="description" content="${d}">
${tags}
</head><body><h1>${t}</h1><p>${d}</p></body></html>`;
}
