// Layout PURO dos cards de divulgação (px): Feed 4:5, Story 9:16 e Status. Devolve
// listas de operações de desenho (mesmo modelo do PDF) para o renderizador de canvas.
import { precoVenda } from "./export.js";
import { CATALOGO_ESTADO_BADGE, fraseCondicao } from "./catalogoCore.js";
import { TEMAS } from "./catalogoSpec.js";

export const FORMATOS = {
  feed: { nome: "Instagram Feed 4:5", w: 1080, h: 1350, seguro: { topo: 60, base: 60 } },
  story: { nome: "Instagram Story 9:16", w: 1080, h: 1920, seguro: { topo: 250, base: 250 } }, // zonas cobertas pela interface
  status: { nome: "WhatsApp Status 9:16", w: 1080, h: 1920, seguro: { topo: 200, base: 220 } },
  quadrado: { nome: "Quadrado 1:1", w: 1080, h: 1080, seguro: { topo: 60, base: 60 } },
};

const MARGEM = 72;
const COR_BADGE = { novo: ["#e7f6ec", "#256c37"], aberta: ["#fdf3e6", "#8f5a12"], semi: ["#eaf4fb", "#1a5f94"], asis: ["#f1f3f5", "#4f5a64"] };
const brl = (v) => `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: Number.isInteger(Number(v)) ? 0 : 2, maximumFractionDigits: 2 })}`;

function base(fmt, tema) {
  return [{ k: "rect", x: 0, y: 0, w: fmt.w, h: fmt.h, fill: tema.capa === "#ffffff" ? "#ffffff" : tema.capa }];
}

function rodapeContato(ops, fmt, tema, ctx) {
  const y = fmt.h - fmt.seguro.base - 150;
  const c = ctx.contato || {};
  ops.push({ k: "rect", x: MARGEM, y, w: fmt.w - 2 * MARGEM, h: 150, fill: "#ffffff", r: 24 });
  if (ctx.qrContato) ops.push({ k: "img", x: MARGEM + 20, y: y + 20, w: 110, h: 110, src: ctx.qrContato });
  const x = MARGEM + (ctx.qrContato ? 150 : 28);
  ops.push({ k: "text", x, y: y + 52, s: "FALE COM A NOGÁRIA", size: 22, bold: true, color: "#5f6b76" });
  ops.push({ k: "text", x, y: y + 92, s: c.nome || "Atendimento Nogária", size: 36, bold: true, color: tema.forte, maxW: fmt.w - x - MARGEM - 20 });
  ops.push({ k: "text", x, y: y + 128, s: `WhatsApp ${c.whatsappLabel || ""}`.trim(), size: 30, bold: true, color: "#0b162d" });
}

// Slide de produto: foto grande, selo, nome, preço e contato.
export function cardProduto(it, formato, ctx = {}) {
  const fmt = FORMATOS[formato] || FORMATOS.feed;
  const tema = TEMAS[ctx.tema] || TEMAS.noite;
  const ops = base(fmt, tema);
  const escuro = tema.capa !== "#ffffff";
  const tx = escuro ? "#ffffff" : tema.tinta;
  const topo = fmt.seguro.topo;
  const rodapeY = fmt.h - fmt.seguro.base - 150;
  if (ctx.logoBranco) ops.push({ k: "img", x: MARGEM, y: topo, w: 210, h: 210 * (ctx.logoRatio || 0.51), src: ctx.logoBranco });
  const fotoY = topo + 130;
  const fotoH = Math.max(300, rodapeY - fotoY - 360);
  ops.push({ k: "rect", x: MARGEM, y: fotoY, w: fmt.w - 2 * MARGEM, h: fotoH, fill: "#f6f9fb", r: 24 });
  if (ctx.foto) ops.push({ k: "img", x: MARGEM + 12, y: fotoY + 12, w: fmt.w - 2 * MARGEM - 24, h: fotoH - 24, src: ctx.foto, fit: "contain" });
  const badge = CATALOGO_ESTADO_BADGE[(it.estado || "").trim()];
  if (badge) {
    const [bg, fg] = COR_BADGE[badge.cls];
    ops.push({ k: "rect", x: MARGEM + 24, y: fotoY + 24, w: badge.txt.length * 17 + 44, h: 48, fill: bg, r: 24 });
    ops.push({ k: "text", x: MARGEM + 46, y: fotoY + 57, s: badge.txt.toUpperCase(), size: 24, bold: true, color: fg });
  }
  let y = fotoY + fotoH + 62;
  ops.push({ k: "text", x: MARGEM, y, s: it.produto || it.sku, size: 52, bold: true, color: tx, maxW: fmt.w - 2 * MARGEM, maxLines: 2, lineH: 60 });
  y += 130;
  const frase = fraseCondicao(it);
  if (frase) ops.push({ k: "text", x: MARGEM, y, s: frase, size: 28, color: escuro ? tema.acento : tema.forte, maxW: fmt.w - 2 * MARGEM, maxLines: 1 });
  const p = precoVenda(it);
  if (ctx.mostrarPreco !== false && p > 0) ops.push({ k: "text", x: MARGEM, y: y + 86, s: brl(p), size: 84, bold: true, color: tx });
  rodapeContato(ops, fmt, tema, ctx);
  return { formato, w: fmt.w, h: fmt.h, ops };
}

// Capa do carrossel (título + contagem) e slide final de chamada.
export function cardCapa(titulo, nItens, formato, ctx = {}) {
  const fmt = FORMATOS[formato] || FORMATOS.feed;
  const tema = TEMAS[ctx.tema] || TEMAS.noite;
  const ops = base(fmt, tema);
  const tx = tema.capa !== "#ffffff" ? "#ffffff" : tema.tinta;
  if (ctx.logoBranco) ops.push({ k: "img", x: MARGEM, y: fmt.seguro.topo, w: 280, h: 280 * (ctx.logoRatio || 0.51), src: ctx.logoBranco });
  ops.push({ k: "rect", x: MARGEM, y: fmt.h / 2 - 150, w: 160, h: 12, fill: tema.acento, r: 6 });
  ops.push({ k: "text", x: MARGEM, y: fmt.h / 2, s: titulo, size: 96, bold: true, color: tx, maxW: fmt.w - 2 * MARGEM, maxLines: 3, lineH: 108 });
  ops.push({ k: "text", x: MARGEM, y: fmt.h / 2 + 330, s: `${nItens} peças selecionadas · deslize →`, size: 38, color: tx });
  return { formato, w: fmt.w, h: fmt.h, ops };
}

export function cardChamada(formato, ctx = {}) {
  const fmt = FORMATOS[formato] || FORMATOS.feed;
  const tema = TEMAS[ctx.tema] || TEMAS.noite;
  const ops = base(fmt, tema);
  const tx = tema.capa !== "#ffffff" ? "#ffffff" : tema.tinta;
  ops.push({ k: "text", x: MARGEM, y: fmt.h / 2 - 120, s: "Gostou? Chame agora e reserve a sua peça.", size: 80, bold: true, color: tx, maxW: fmt.w - 2 * MARGEM, maxLines: 4, lineH: 92 });
  rodapeContato(ops, fmt, tema, ctx);
  return { formato, w: fmt.w, h: fmt.h, ops };
}

// Carrossel: capa + até `max` produtos + chamada (limite do Instagram: 10 slides).
export function montarCarrossel(itens, titulo, formato, ctxPorSku = {}, ctx = {}, max = 8) {
  const prods = (itens || []).slice(0, Math.min(max, 8));
  return [
    cardCapa(titulo, (itens || []).length, formato, ctx),
    ...prods.map((it) => cardProduto(it, formato, { ...ctx, ...(ctxPorSku[it.sku] || {}) })),
    cardChamada(formato, ctx),
  ];
}
