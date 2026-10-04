// Textos de divulgação (PURO): WhatsApp, legenda de Instagram, hashtags e CSV
// para catálogo do WhatsApp Business. Sem rede; testável em Node.
import { precoVenda } from "./export.js";
import { fraseCondicao } from "./catalogoCore.js";

export const LIMITE_LEGENDA_IG = 2200;
export const LIMITE_HASHTAGS_IG = 30;
export const MAX_ITENS_WHATSAPP = 30; // espelha a "mensagem com vários produtos" do WhatsApp

const brl = (v) => `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: Number.isInteger(Number(v)) ? 0 : 2, maximumFractionDigits: 2 })}`;
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const preco = (it) => precoVenda(it);

// "Sala de estar" → "#salaDeEstar" (camelCase, sem acento, só letras/dígitos).
export function hashtagDe(texto) {
  const partes = semAcento(texto).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!partes.length) return "";
  return `#${partes.map((p, i) => (i ? p[0].toUpperCase() + p.slice(1) : p)).join("")}`;
}

const BASE = ["#nogaria", "#outlet", "#belem", "#moveis", "#decoracao", "#ofertas"];
export function hashtagsPara(grupos = [], { max = 12 } = {}) {
  const dinamicas = [...new Set(grupos.map(hashtagDe).filter(Boolean))];
  return [...new Set([...BASE, ...dinamicas])].slice(0, Math.min(max, LIMITE_HASHTAGS_IG));
}

const linhaItem = (it, { comPreco = true } = {}) => {
  const p = preco(it);
  return `• ${it.produto || it.sku}${comPreco ? ` — ${p != null && p > 0 ? `*${brl(p)}*` : "sob consulta"}` : ""}`;
};

// Mensagem de WhatsApp com os destaques (até `max`), link e contato.
export function textoWhatsApp(itens, { titulo = "Catálogo Nogária Outlet", link, validade, contato, max = MAX_ITENS_WHATSAPP, mostrarPreco = true, mensagem } = {}) {
  const lista = (itens || []).slice(0, max);
  const resto = (itens || []).length - lista.length;
  return [
    `*${titulo}*`,
    mensagem || null,
    "",
    ...lista.map((it) => linhaItem(it, { comPreco: mostrarPreco })),
    resto > 0 ? `+ ${resto} item(ns) no catálogo` : null,
    "",
    validade ? `Preços válidos até ${validade}` : null,
    link ? `Veja tudo: ${link}` : null,
    contato ? `Atendimento: ${contato}` : null,
  ].filter((l) => l !== null && l !== undefined).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Legenda de Instagram ≤ 2.200 caracteres: gancho, destaques, chamada e hashtags.
export function textoInstagram(itens, { titulo = "Novidades no outlet", validade, contato, grupos = [], destaques = 5, mostrarPreco = true } = {}) {
  const lista = (itens || []).slice(0, destaques);
  const tags = hashtagsPara(grupos.length ? grupos : [...new Set((itens || []).map((i) => i.grupo).filter(Boolean))]).join(" ");
  const corpo = [
    `${titulo} 🛋️`,
    "",
    ...lista.map((it) => linhaItem(it, { comPreco: mostrarPreco }).replace(/\*/g, "")),
    (itens || []).length > lista.length ? `…e mais ${(itens || []).length - lista.length} peças!` : null,
    "",
    "Produtos com condição descrita e preço de outlet.",
    validade ? `Preços válidos até ${validade}.` : null,
    contato ? `Chame no WhatsApp: ${contato}` : "Chame no WhatsApp (link na bio).",
  ].filter((l) => l !== null).join("\n");
  let legenda = `${corpo}\n\n${tags}`;
  if (legenda.length > LIMITE_LEGENDA_IG) {
    const sobra = LIMITE_LEGENDA_IG - tags.length - 4;
    legenda = `${corpo.slice(0, Math.max(0, sobra))}…\n\n${tags}`;
  }
  return legenda;
}

export const legendaCard = (it) => `${it.produto || it.sku}${preco(it) > 0 ? ` por ${brl(preco(it))}` : ""} · ${fraseCondicao(it) || "consulte a condição"} · ${it.sku}`;

// Células de TEXTO que começam com = + - @ (ou tab/CR) viram fórmula no Excel/Sheets
// (injeção de fórmula via nome de produto): prefixa apóstrofo para tratá-las como texto.
export const neutralizarFormula = (v) => (/^[=+\-@\t\r]/.test(String(v ?? "")) ? `'${v}` : String(v ?? ""));
const csvCel = (v, { texto = true } = {}) => {
  const s = texto ? neutralizarFormula(v) : String(v ?? "");
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// CSV (UTF-8 com BOM) para importar no catálogo do WhatsApp Business / marketplaces.
export function csvCatalogo(itens, { linkDe } = {}) {
  const cab = ["nome", "preco", "descricao", "codigo", "link"];
  const linhas = (itens || []).map((it) => [
    it.produto || it.sku,
    preco(it) > 0 ? Number(preco(it)).toFixed(2) : "",
    [fraseCondicao(it), [it.marca, it.modelo].filter(Boolean).join(" ")].filter(Boolean).join(" · "),
    it.sku,
    linkDe ? linkDe(it) : "",
  ]);
  // coluna 1 (preço) é numérica gerada por nós: não passa pela neutralização de texto.
  return `\uFEFF${[cab, ...linhas].map((l) => l.map((c, i) => csvCel(c, { texto: i !== 1 })).join(",")).join("\r\n")}\r\n`;
}
