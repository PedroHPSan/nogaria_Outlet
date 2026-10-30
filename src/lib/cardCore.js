// Layout PURO dos cards de divulgação (px): Feed 4:5, Story 9:16 e Status. Devolve
// listas de operações de desenho (mesmo modelo do PDF) para o renderizador de canvas.
import { precoVenda } from "./export.js";
import { tamanhoExibicao } from "./tamanhos.js";
import { precoMisto, fmtEUR, fmtDataCotacao } from "./precoEuro.js";
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

// ── Preview de oferta (og:image) ──────────────────────────────────────────────
// Quadrado 800×800: o WhatsApp exibe como miniatura quadrada ao lado do título, então o
// selo de preço fica DENTRO da imagem (nada é cortado). Foto em data URI (sem taint).
export const OG_LADO = 800;

// Modo euro (ctx.euro = { taxa, em }): o preço vira o € do momento da publicação (R$ +20% ÷ cotação).
// fmtPreco → texto de uma linha; fmtDupla → { eur, brl } para mostrar os dois valores.
const fmtDupla = (p, euro) => { const m = euro ? precoMisto(p, euro.taxa) : null; return m?.eur ? { eur: fmtEUR(m.eur), brl: brl(p) } : null; };
const fmtPreco = (p, euro) => { const d = fmtDupla(p, euro); return d ? `${d.eur} · ${d.brl}` : brl(p); };

function faixaPreco(ops, preco, rotulo, euro) {
  const y = OG_LADO - 170;
  ops.push({ k: "rect", x: 0, y, w: OG_LADO, h: 170, fill: "#0b162d" });
  ops.push({ k: "rect", x: 0, y, w: OG_LADO, h: 8, fill: "#52ff7f" });
  const dupla = preco > 0 ? fmtDupla(preco, euro) : null;
  if (dupla) {
    ops.push({ k: "text", x: 40, y: y + 82, s: dupla.eur, size: 76, bold: true, color: "#ffffff", maxW: OG_LADO - 80 });
    ops.push({ k: "text", x: 40, y: y + 130, s: dupla.brl, size: 44, bold: true, color: "#52ff7f", maxW: OG_LADO - 80 });
  } else if (preco > 0) ops.push({ k: "text", x: 40, y: y + 112, s: brl(preco), size: 92, bold: true, color: "#ffffff", maxW: OG_LADO - 80 });
  if (preco <= 0) ops.push({ k: "text", x: 40, y: y + 104, s: rotulo || "Consulte", size: 64, bold: true, color: "#ffffff", maxW: OG_LADO - 80 });
  ops.push({ k: "text", x: 40, y: y + 158, s: euro && preco > 0 ? `NOGÁRIA OUTLET · cotação ${fmtDataCotacao(euro.em)}` : "NOGÁRIA OUTLET", size: 22, bold: true, color: "#52ff7f" });
}

export function cardOgProduto(it, ctx = {}) {
  const ops = [{ k: "rect", x: 0, y: 0, w: OG_LADO, h: OG_LADO, fill: "#f6f9fb" }];
  if (ctx.foto) ops.push({ k: "img", x: 30, y: 30, w: OG_LADO - 60, h: OG_LADO - 170 - 60, src: ctx.foto, fit: "contain" });
  else ops.push({ k: "text", x: 40, y: 330, s: it.produto || it.sku, size: 56, bold: true, color: "#0b162d", maxW: OG_LADO - 80, maxLines: 4, lineH: 68 });
  const badge = CATALOGO_ESTADO_BADGE[(it.estado || "").trim()];
  if (badge) {
    const [bg, fg] = COR_BADGE[badge.cls];
    ops.push({ k: "rect", x: 30, y: 30, w: badge.txt.length * 15 + 40, h: 44, fill: bg, r: 22 });
    ops.push({ k: "text", x: 50, y: 61, s: badge.txt.toUpperCase(), size: 22, bold: true, color: fg });
  }
  if (it.sku) {
    const w = it.sku.length * 17 + 40;
    ops.push({ k: "rect", x: OG_LADO - 30 - w, y: 30, w, h: 44, fill: "#0b162d", r: 22 });
    ops.push({ k: "text", x: OG_LADO - 30 - w + 20, y: 61, s: it.sku, size: 26, bold: true, color: "#52ff7f" });
  }
  if (tamanhoExibicao(it)) {
    const s = `TAM ${tamanhoExibicao(it)}`;
    const w = s.length * 22 + 44;
    ops.push({ k: "rect", x: OG_LADO - 30 - w, y: 86, w, h: 60, fill: "#52ff7f", r: 30 });
    ops.push({ k: "text", x: OG_LADO - 30 - w + 22, y: 130, s, size: 36, bold: true, color: "#0b162d" });
  }
  faixaPreco(ops, ctx.mostrarPreco === false ? 0 : precoVenda(it), null, ctx.euro);
  return { formato: "og", w: OG_LADO, h: OG_LADO, ops };
}

// Oferta com vários itens: grade 2×2 com a foto e o preço de cada um + faixa "a partir de".
export function cardOgOferta(itens, ctx = {}) {
  const lista = (itens || []).slice(0, 4);
  const ops = [{ k: "rect", x: 0, y: 0, w: OG_LADO, h: OG_LADO, fill: "#f6f9fb" }];
  const topo = OG_LADO - 170;
  const cel = (OG_LADO - 3 * 14) / 2;
  const altura = (topo - 3 * 14) / 2;
  lista.forEach((it, i) => {
    const x = 14 + (i % 2) * (cel + 14);
    const y = 14 + Math.floor(i / 2) * (altura + 14);
    ops.push({ k: "rect", x, y, w: cel, h: altura, fill: "#ffffff", r: 16 });
    const foto = ctx.fotos?.[it.sku];
    if (foto) ops.push({ k: "img", x: x + 8, y: y + 8, w: cel - 16, h: altura - 16, src: foto, fit: "contain" });
    if (it.sku) {
      ops.push({ k: "rect", x: x + 10, y: y + 10, w: it.sku.length * 12 + 24, h: 34, fill: "#0b162d", r: 17 });
      ops.push({ k: "text", x: x + 22, y: y + 34, s: it.sku, size: 20, bold: true, color: "#52ff7f" });
    }
    if (tamanhoExibicao(it)) {
      const s = `TAM ${tamanhoExibicao(it)}`;
      ops.push({ k: "rect", x: x + 10, y: y + 52, w: s.length * 15 + 28, h: 38, fill: "#52ff7f", r: 19 });
      ops.push({ k: "text", x: x + 24, y: y + 79, s, size: 24, bold: true, color: "#0b162d" });
    }
    const p = ctx.mostrarPreco === false ? null : precoVenda(it);
    if (p > 0) {
      ops.push({ k: "rect", x: x + 10, y: y + altura - 62, w: Math.min(cel - 20, fmtPreco(p, ctx.euro).length * (ctx.euro ? 16 : 24) + 30), h: 50, fill: "#0b162d", r: 25 });
      ops.push({ k: "text", x: x + 26, y: y + altura - 26, s: fmtPreco(p, ctx.euro), size: ctx.euro ? 22 : 32, bold: true, color: "#52ff7f" });
    }
  });
  const precos = (itens || []).map((i) => precoVenda(i)).filter((p) => p > 0);
  const minimo = ctx.mostrarPreco === false || !precos.length ? 0 : Math.min(...precos);
  const y = OG_LADO - 170;
  ops.push({ k: "rect", x: 0, y, w: OG_LADO, h: 170, fill: "#0b162d" });
  ops.push({ k: "rect", x: 0, y, w: OG_LADO, h: 8, fill: "#52ff7f" });
  ops.push({ k: "text", x: 40, y: y + 70, s: `${(itens || []).length} OFERTAS${minimo ? " · a partir de" : ""}`, size: 34, bold: true, color: "#52ff7f" });
  ops.push({ k: "text", x: 40, y: y + 140, s: minimo ? fmtPreco(minimo, ctx.euro) : "NOGÁRIA OUTLET", size: ctx.euro && minimo ? 52 : 76, bold: true, color: "#ffffff", maxW: OG_LADO - 80 });
  return { formato: "og", w: OG_LADO, h: OG_LADO, ops };
}
