// Layout PURO do catálogo em PDF (A4, mm): recebe seções + spec e devolve páginas
// como listas de operações de desenho. Quem desenha (jsPDF) está em catalogoPdf.js;
// aqui só há geometria e paginação, testáveis em Node sem jsPDF nem rede.
import { precoVenda } from "./export.js";
import { CATALOGO_ESTADO_BADGE, fraseCondicao } from "./catalogoCore.js";
import { TEMAS } from "./catalogoSpec.js";

export const A4 = { w: 210, h: 297 };
const M = 12;               // margem lateral
const TOPO = 30;            // início do conteúdo (após cabeçalho)
const RODAPE_Y = 287;       // linha do rodapé
const FIM = RODAPE_Y - 4;   // limite inferior do conteúdo
const SEC_H = 10;           // cabeçalho de seção
const GAP = 4;

const COR_BADGE = {
  novo: ["#e7f6ec", "#256c37"], aberta: ["#fdf3e6", "#8f5a12"],
  semi: ["#eaf4fb", "#1a5f94"], asis: ["#f1f3f5", "#4f5a64"],
};

export function formatarPreco(v) {
  const n = Number(v);
  if (!n || Number.isNaN(n)) return "R$ —";
  const inteiro = Number.isInteger(n);
  return `R$ ${n.toLocaleString("pt-BR", inteiro
    ? { maximumFractionDigits: 0 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// "de" só aparece quando há referência rastreável MAIOR que o preço de venda.
export function precoDe(it, spec) {
  if (!spec.campos.de) return null;
  const ref = Number(it.preco_ref_novo);
  return ref > (precoVenda(it) || 0) ? ref : null;
}

const ordenar = (cards, ordem) => {
  const p = (c) => precoVenda(c.rep) || 0;
  const nome = (c) => String(c.rep.produto || c.rep.sku);
  const f = {
    preco_desc: (a, b) => p(b) - p(a),
    preco_asc: (a, b) => p(a) - p(b),
    sku: (a, b) => String(a.rep.sku).localeCompare(String(b.rep.sku), "pt-BR"),
    nome: (a, b) => nome(a).localeCompare(nome(b), "pt-BR"),
  }[ordem];
  return f ? [...cards].sort(f) : cards;
};

const novaPagina = () => ({ ops: [] });

// ───────────── cabeçalho / rodapé de páginas internas ─────────────
function chrome(pg, n, ctx, tema) {
  if (ctx.logos?.horizontal) pg.ops.push({ k: "img", x: M, y: 11, w: 34, h: 34 * (ctx.logos.horizontalRatio || 0.156), src: ctx.logos.horizontal });
  pg.ops.push({ k: "line", x1: M, y1: 22, x2: A4.w - M, y2: 22, color: "#e6ebf0", lw: 0.4 });
  pg.ops.push({ k: "line", x1: M, y1: RODAPE_Y, x2: A4.w - M, y2: RODAPE_Y, color: "#e6ebf0", lw: 0.3 });
  const c = ctx.contato || {};
  const rodape = [c.nome, c.whatsappLabel && `WhatsApp ${c.whatsappLabel}`].filter(Boolean).join(" · ");
  pg.ops.push({ k: "text", x: M, y: RODAPE_Y + 5, s: rodape || "Nogária Outlet", size: 8, color: "#5f6b76" });
  pg.ops.push({ k: "text", x: A4.w - M, y: RODAPE_Y + 5, s: String(n).padStart(2, "0"), size: 9, bold: true, color: tema.forte, align: "right" });
}

function secaoHead(pg, y, titulo, cont, tema) {
  pg.ops.push({ k: "text", x: M, y: y + 6.5, s: `${String(titulo).toUpperCase()}${cont ? " (CONT.)" : ""}`, size: 11, bold: true, color: tema.forte });
  pg.ops.push({ k: "rect", x: M, y: y + 8.2, w: A4.w - 2 * M, h: 0.8, fill: tema.acento });
}

// ───────────── card (grade) ─────────────
function cardOps(c, x, y, w, h, spec, ctx, tema) {
  const it = c.rep;
  const ops = [{ k: "rect", x, y, w, h, fill: "#ffffff", stroke: "#e6ebf0", lw: 0.3, r: 1.5 }];
  const badge = CATALOGO_ESTADO_BADGE[(it.estado || "").trim()];
  let cy = y;
  if (spec.campos.foto) {
    const fh = Math.round(h * 0.45);
    ops.push({ k: "rect", x: x + 0.3, y: y + 0.3, w: w - 0.6, h: fh, fill: "#f6f9fb" });
    const src = ctx.fotos?.[it.sku];
    if (src) ops.push({ k: "img", x: x + 1, y: y + 1, w: w - 2, h: fh - 1.4, src, fit: "contain" });
    cy = y + fh;
  }
  const pad = 2.6;
  if (badge && spec.campos.condicao) {
    const [bg, fg] = COR_BADGE[badge.cls];
    const bw = Math.max(16, badge.txt.length * 1.9 + 4);
    ops.push({ k: "rect", x: x + pad, y: spec.campos.foto ? y + 2 : cy + pad, w: bw, h: 4.6, fill: bg, r: 2.3 });
    ops.push({ k: "text", x: x + pad + bw / 2, y: (spec.campos.foto ? y + 2 : cy + pad) + 3.3, s: badge.txt.toUpperCase(), size: 6.5, bold: true, color: fg, align: "center" });
    if (!spec.campos.foto) cy += 7;
  }
  let ty = cy + 4.8;
  ops.push({ k: "text", x: x + pad, y: ty, s: it.produto || it.sku, size: 9, bold: true, color: tema.tinta, maxW: w - 2 * pad, maxLines: 2, lineH: 4 });
  ty += 8.2;
  if (spec.campos.marcaModelo) {
    const mm = [it.marca, it.modelo].filter(Boolean).join(" · ");
    if (mm) ops.push({ k: "text", x: x + pad, y: ty, s: mm.toUpperCase(), size: 6.8, color: "#6b7a87", maxW: w - 2 * pad, maxLines: 1 });
    ty += 3.8;
  }
  const frase = spec.campos.condicao ? fraseCondicao(it) : "";
  if (frase) ops.push({ k: "text", x: x + pad, y: ty, s: frase, size: 6.8, bold: true, color: "#2f6f94", maxW: w - 2 * pad, maxLines: 2, lineH: 3 });

  // rodapé do card: preço (+ "de"), qtd/SKU e QR
  const qr = spec.campos.qr && ctx.qrs?.[it.sku];
  const qrS = w < 70 ? 11 : 13;
  const textoW = w - 2 * pad - (qr ? qrS + 1 : 0);
  const preco = precoVenda(it);
  if (spec.campos.preco) {
    const de = precoDe(it, spec);
    if (de) ops.push({ k: "text", x: x + pad, y: y + h - 13.2, s: `de ${formatarPreco(de)}`, size: 7, color: "#6b7a87", strike: true });
    ops.push({ k: "text", x: x + pad, y: y + h - 7.4, s: formatarPreco(preco), size: w < 70 ? 13 : 15, bold: true, color: tema.forte, maxW: textoW });
  }
  const meta = [c.qtd > 1 && spec.campos.qtd ? `${c.qtd} disponíveis` : null, spec.campos.sku ? it.sku : null].filter(Boolean).join(" · ");
  if (meta) ops.push({ k: "text", x: x + pad, y: y + h - 2.8, s: meta, size: 6.8, bold: true, color: "#4f5a64", maxW: textoW });
  if (qr) ops.push({ k: "img", x: x + w - pad - qrS, y: y + h - pad - qrS, w: qrS, h: qrS, src: qr });
  return ops;
}

// ───────────── modelo "catálogo" (grade) ─────────────
function paginarGrade(secoes, spec, ctx, tema, inicio) {
  const cols = spec.colunas;
  const w = (A4.w - 2 * M - GAP * (cols - 1)) / cols;
  const h = spec.campos.foto ? 76 : 50;
  const paginas = [];
  let pg = novaPagina(); let y = TOPO; let usada = false;
  const nova = () => { paginas.push(pg); pg = novaPagina(); y = TOPO; usada = false; };

  for (const sec of secoes) {
    let cont = false;
    if (usada && y + SEC_H + h > FIM) nova();
    secaoHead(pg, y, sec.titulo, cont, tema); y += SEC_H; usada = true;
    const cards = ordenar(sec.cards, spec.ordem);
    for (let i = 0; i < cards.length; i += cols) {
      if (y + h > FIM) {
        nova(); cont = true;
        secaoHead(pg, y, sec.titulo, cont, tema); y += SEC_H; usada = true;
      }
      cards.slice(i, i + cols).forEach((c, j) => pg.ops.push(...cardOps(c, M + j * (w + GAP), y, w, h, spec, ctx, tema)));
      y += h + GAP;
    }
  }
  if (usada) paginas.push(pg);
  return paginas.map((p, i) => { chrome(p, inicio + i, ctx, tema); return p; });
}

// ───────────── modelo "lista" (tabela compacta) ─────────────
function paginarLista(secoes, spec, ctx, tema, inicio) {
  const ROW = spec.campos.foto ? 15 : 9;
  const L = A4.w - 2 * M;
  const paginas = [];
  let pg = novaPagina(); let y = TOPO; let usada = false;
  const nova = () => { paginas.push(pg); pg = novaPagina(); y = TOPO; usada = false; };
  const cabTabela = () => {
    pg.ops.push({ k: "rect", x: M, y, w: L, h: 7, fill: tema.forte });
    const t = (x, s, al) => pg.ops.push({ k: "text", x, y: y + 4.8, s, size: 7.5, bold: true, color: "#ffffff", align: al });
    t(M + 2, "PRODUTO"); t(M + L * 0.60, "CONDIÇÃO"); t(M + L - 22, "QTD", "right"); t(M + L - 2, "PREÇO", "right");
    y += 7;
  };

  for (const sec of secoes) {
    let cont = false;
    if (usada && y + SEC_H + 7 + ROW > FIM) nova();
    secaoHead(pg, y, sec.titulo, cont, tema); y += SEC_H; usada = true;
    cabTabela();
    const cards = ordenar(sec.cards, spec.ordem);
    cards.forEach((c, i) => {
      if (y + ROW > FIM) {
        nova(); cont = true;
        secaoHead(pg, y, sec.titulo, cont, tema); y += SEC_H; usada = true;
        cabTabela();
      }
      const it = c.rep;
      if (i % 2 === 1) pg.ops.push({ k: "rect", x: M, y, w: L, h: ROW, fill: "#f6f9fb" });
      let tx = M + 2;
      if (spec.campos.foto) {
        const src = ctx.fotos?.[it.sku];
        if (src) pg.ops.push({ k: "img", x: M + 1.5, y: y + 1.5, w: ROW - 3, h: ROW - 3, src, fit: "contain" });
        tx = M + ROW + 1;
      }
      const nomeW = L * 0.60 - (tx - M) - 3;
      pg.ops.push({ k: "text", x: tx, y: y + (ROW > 10 ? 5.6 : 4), s: it.produto || it.sku, size: 8.5, bold: true, color: tema.tinta, maxW: nomeW, maxLines: 1 });
      const sub = [spec.campos.sku && it.sku, spec.campos.marcaModelo && [it.marca, it.modelo].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
      if (sub && ROW > 10) pg.ops.push({ k: "text", x: tx, y: y + 10.2, s: sub, size: 6.8, color: "#6b7a87", maxW: nomeW, maxLines: 1 });
      const badge = CATALOGO_ESTADO_BADGE[(it.estado || "").trim()];
      if (badge && spec.campos.condicao) pg.ops.push({ k: "text", x: M + L * 0.60, y: y + (ROW > 10 ? 7.2 : 5.2), s: badge.txt, size: 7.5, bold: true, color: COR_BADGE[badge.cls][1] });
      if (spec.campos.qtd) pg.ops.push({ k: "text", x: M + L - 22, y: y + (ROW > 10 ? 7.2 : 5.2), s: String(c.qtd), size: 8, color: tema.tinta, align: "right" });
      if (spec.campos.preco) pg.ops.push({ k: "text", x: M + L - 2, y: y + (ROW > 10 ? 7.4 : 5.4), s: formatarPreco(precoVenda(it)), size: 9.5, bold: true, color: tema.forte, align: "right" });
      pg.ops.push({ k: "line", x1: M, y1: y + ROW, x2: M + L, y2: y + ROW, color: "#e6ebf0", lw: 0.2 });
      y += ROW;
    });
    y += 5;
  }
  if (usada) paginas.push(pg);
  return paginas.map((p, i) => { chrome(p, inicio + i, ctx, tema); return p; });
}

// ───────────── capa e fechamento ─────────────
function capa(spec, ctx, tema, nProdutos) {
  const pg = novaPagina();
  const escura = tema.capa !== "#ffffff";
  const tx = escura ? "#ffffff" : tema.forte;
  pg.ops.push({ k: "rect", x: 0, y: 0, w: A4.w, h: A4.h, fill: tema.capa });
  if (ctx.logos?.branco && escura) pg.ops.push({ k: "img", x: M + 4, y: 26, w: 52, h: 52 * (ctx.logos.brancoRatio || 0.51), src: ctx.logos.branco });
  else if (ctx.logos?.horizontal) pg.ops.push({ k: "img", x: M + 4, y: 28, w: 56, h: 56 * (ctx.logos.horizontalRatio || 0.156), src: ctx.logos.horizontal });
  if (spec.edicao) {
    pg.ops.push({ k: "rect", x: M + 4, y: 92, w: Math.max(40, spec.edicao.length * 2.6 + 12), h: 8, fill: tema.acento, r: 1 });
    pg.ops.push({ k: "text", x: M + 8, y: 97.5, s: `EDIÇÃO ${spec.edicao}`.toUpperCase(), size: 8.5, bold: true, color: tema.sobAcento });
  }
  pg.ops.push({ k: "text", x: M + 4, y: 120, s: spec.titulo, size: 34, bold: true, color: tx, maxW: A4.w - 2 * M - 8, maxLines: 3, lineH: 14 });
  if (spec.subtitulo) pg.ops.push({ k: "text", x: M + 4, y: 158, s: spec.subtitulo, size: 12, color: tx, maxW: A4.w - 2 * M - 8, maxLines: 2, lineH: 6 });
  if (spec.mensagem) pg.ops.push({ k: "text", x: M + 4, y: 176, s: spec.mensagem, size: 11, color: tx, maxW: 140, maxLines: 4, lineH: 5.6 });
  const stats = [`${nProdutos} produtos`, spec.validade && `preços válidos até ${spec.validade}`].filter(Boolean).join(" · ");
  pg.ops.push({ k: "line", x1: M + 4, y1: 205, x2: A4.w - M - 4, y2: 205, color: escura ? "#ffffff" : tema.forte, lw: 0.5 });
  pg.ops.push({ k: "text", x: M + 4, y: 214, s: stats, size: 11, bold: true, color: tx });
  contatoCartao(pg, 232, ctx, tema, spec);
  return pg;
}

function contatoCartao(pg, y, ctx, tema, spec) {
  const c = ctx.contato || {};
  pg.ops.push({ k: "rect", x: M, y, w: A4.w - 2 * M, h: 40, fill: "#ffffff", stroke: "#e6ebf0", lw: 0.3, r: 2 });
  if (ctx.qrs?.__contato) pg.ops.push({ k: "img", x: M + 5, y: y + 5, w: 30, h: 30, src: ctx.qrs.__contato });
  else pg.ops.push({ k: "rect", x: M + 5, y: y + 5, w: 30, h: 30, stroke: "#8a98a5", lw: 0.3 });
  const x = M + 41;
  pg.ops.push({ k: "text", x, y: y + 9, s: "FALE COM A NOGÁRIA", size: 7.5, bold: true, color: "#5f6b76" });
  pg.ops.push({ k: "text", x, y: y + 18, s: c.nome || "Atendimento Nogária", size: 15, bold: true, color: tema.forte, maxW: A4.w - 2 * M - 48, maxLines: 1 });
  pg.ops.push({ k: "text", x, y: y + 26, s: `WhatsApp ${c.whatsappLabel || ""}`.trim(), size: 11, bold: true, color: "#0b162d" });
  const extras = (c.extras || []).map((e) => `${e.rotulo}: ${e.valor}`).join("   ·   ");
  if (extras) pg.ops.push({ k: "text", x, y: y + 33, s: extras, size: 8, color: "#4f5a64", maxW: A4.w - 2 * M - 48, maxLines: 2, lineH: 3.6 });
  void spec;
}

function fechamento(spec, ctx, tema, n) {
  const pg = novaPagina();
  pg.ops.push({ k: "text", x: M, y: 44, s: "COMO COMPRAR", size: 9, bold: true, color: "#5f6b76" });
  pg.ops.push({ k: "text", x: M, y: 58, s: "Escolheu? Em três passos o produto é seu.", size: 20, bold: true, color: tema.forte, maxW: A4.w - 2 * M, maxLines: 2, lineH: 9 });
  const passos = [
    ["1", "Escolha", "Anote o código (NOG…) ou aponte a câmera para o QR do item."],
    ["2", "Reserve", "Chame no WhatsApp e combine a reserva do item."],
    ["3", "Retire ou receba", "Combine pagamento e entrega. Você confere o produto na hora."],
  ];
  const w = (A4.w - 2 * M - 12) / 3;
  passos.forEach(([num, t, d], i) => {
    const x = M + i * (w + 6);
    pg.ops.push({ k: "rect", x, y: 80, w, h: 1.2, fill: tema.forte });
    pg.ops.push({ k: "text", x, y: 94, s: num, size: 22, bold: true, color: tema.forte });
    pg.ops.push({ k: "text", x, y: 103, s: t, size: 10.5, bold: true, color: tema.tinta });
    pg.ops.push({ k: "text", x, y: 109, s: d, size: 8.5, color: "#3f4b57", maxW: w, maxLines: 4, lineH: 4 });
  });
  pg.ops.push({ k: "text", x: M, y: 140, s: "CONDIÇÕES DOS PRODUTOS", size: 9, bold: true, color: "#5f6b76" });
  const conds = [
    ["novo", "Novo", "Produto novo, sem uso."],
    ["aberta", "Caixa aberta", "Embalagem aberta ou avariada."],
    ["semi", "Seminovo", "Usado, em funcionamento."],
    ["asis", "Como está", "Vendido no estado em que se encontra."],
  ];
  const cw = (A4.w - 2 * M - 6) / 2;
  conds.forEach(([cls, nome, desc], i) => {
    const x = M + (i % 2) * (cw + 6); const y = 146 + Math.floor(i / 2) * 17;
    const [bg, fg] = COR_BADGE[cls];
    pg.ops.push({ k: "rect", x, y, w: cw, h: 14, stroke: "#e6ebf0", lw: 0.3 });
    pg.ops.push({ k: "rect", x: x + 3, y: y + 4, w: 24, h: 5.4, fill: bg, r: 2.7 });
    pg.ops.push({ k: "text", x: x + 15, y: y + 7.9, s: nome.toUpperCase(), size: 6.5, bold: true, color: fg, align: "center" });
    pg.ops.push({ k: "text", x: x + 30, y: y + 6, s: desc, size: 8.5, color: "#3f4b57", maxW: cw - 33, maxLines: 2, lineH: 3.8 });
  });
  if (spec.validade) pg.ops.push({ k: "text", x: M, y: 190, s: `Preços válidos até ${spec.validade}.`, size: 9, bold: true, color: tema.tinta });
  contatoCartao(pg, 232, ctx, tema, spec);
  chrome(pg, n, ctx, tema);
  return pg;
}

// ───────────── API ─────────────
// secoes: saída de agruparCatalogo. ctx: { fotos, qrs, logos, contato }.
export function montarCatalogoPdf(secoes, specNorm, ctx = {}) {
  const spec = specNorm;
  const tema = TEMAS[spec.tema] || TEMAS.noite;
  const nProdutos = secoes.reduce((s, sec) => s + sec.cards.length, 0);
  const paginas = [];
  if (spec.capa) paginas.push(capa(spec, ctx, tema, nProdutos));
  const inicio = paginas.length + 1;
  const miolo = spec.modelo === "lista" ? paginarLista(secoes, spec, ctx, tema, inicio) : paginarGrade(secoes, spec, ctx, tema, inicio);
  paginas.push(...miolo);
  if (spec.fechamento) paginas.push(fechamento(spec, ctx, tema, paginas.length + 1));
  return { paginas, resumo: { paginas: paginas.length, produtos: nProdutos } };
}
