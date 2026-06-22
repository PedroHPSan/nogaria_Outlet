// Template do catálogo de marca da Nogária → HTML A4 multipágina (impressão/PDF).
// Os tokens de cor, o CSS canônico e a estrutura seguem a spec /gerar-catalogo
// (seções 7–9): capa, páginas com cards por categoria, selos de condição,
// rodapé numerado e bloco de fechamento parcial. Renderiza offline (só
// Arial/Helvetica + logos base64), impresso pelo iframe de portfolio.js.
import { escapeHtml } from "./portfolio";
import { CATALOGO_ESTADO_BADGE } from "./catalogo";
import { LOGO_VERTICAL, LOGO_HORIZONTAL, LOGO_BRANCO } from "./catalogoLogos";

// ───────────────────────── helpers ─────────────────────────

const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// grupo → ícone da seção (SVG inline, viewBox 0 0 24 24). Paths da spec 5.2.
const SVG_ICONS = {
  ferramentas: '<path d="M14 2l-3 3 2 2-4 4-2-2-3 3 6 6 3-3-2-2 4-4 2 2 3-3-6-6z"/>',
  audio: '<path d="M3 13a9 9 0 0118 0M6.5 13a5.5 5.5 0 0111 0M10 13a2 2 0 014 0"/><circle cx="12" cy="13" r="1.4"/>',
  beleza: '<circle cx="6" cy="7" r="2.4"/><circle cx="6" cy="17" r="2.4"/><path d="M8 8.5L20 16M8 15.5L20 8"/>',
  moda: '<path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 016 0v2"/>',
  box: '<path d="M4 7h16v13H4z"/><path d="M4 7l3-3h10l3 3"/>',
};

function iconeDoGrupo(grupo) {
  const g = semAcento(grupo);
  if (/ferrament/.test(g)) return SVG_ICONS.ferramentas;
  if (/(audio|rede|telecom|eletron|fone)/.test(g)) return SVG_ICONS.audio;
  if (/(beleza|cuidado|cosmetic|perfum)/.test(g)) return SVG_ICONS.beleza;
  if (/(calcado|vestuario|organiz|acessor)/.test(g)) return SVG_ICONS.moda;
  return SVG_ICONS.box;
}

// "R$&nbsp;1.299" (sem centavos se inteiro; pt-BR). NÃO passar por escapeHtml.
function precoCatalogo(v) {
  const n = Number(v);
  if (!n || isNaN(n)) return "R$&nbsp;—";
  const inteiro = Number.isInteger(n);
  const num = n.toLocaleString("pt-BR", inteiro
    ? { maximumFractionDigits: 0 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `R$&nbsp;${num}`;
}

const badgeDoEstado = (estado) => CATALOGO_ESTADO_BADGE[(estado || "").trim()] || null;

// "MARCA · MODELO · COR" em CAPS, omitindo partes nulas.
function modeloLinha(it) {
  let s = [it.marca, it.modelo].filter(Boolean).join(" · ");
  if (it.cor) s = s ? `${s} · ${it.cor}` : it.cor;
  return s.toUpperCase();
}

// 1 linha curta de specs (≤90 chars): voltagem + numeração quando houver.
function specCurta(it) {
  const partes = [];
  if (it.voltagem && it.voltagem !== "N/A") partes.push(it.voltagem);
  if (it.tamanho) partes.push(`Tam. ${it.tamanho}`);
  let s = partes.join(" · ");
  if (s.length > 90) s = s.slice(0, 89) + "…";
  return s;
}

// ───────────────────────── paginação (estimativa em mm) ─────────────────────────
// Distribui as seções em páginas A4 explícitas para ter chrome (cabeçalho/rodapé)
// e numeração por página — auto-flow do CSS não garante isso de forma confiável.
function paginar(secoes, { comFoto, parcial }) {
  const USABLE = 250;            // altura útil após padding + phead + pfoot-bar
  const SECHEAD = 14;            // cabeçalho de seção
  const ROW = comFoto ? 96 : 58; // linha de 2 cards (+ gap)
  const CLOSING = 62;            // bloco de fechamento

  const paginas = [];
  let pagina = { segs: [], closing: false };
  let y = 0;
  const novaPagina = () => { paginas.push(pagina); pagina = { segs: [], closing: false }; y = 0; };

  for (const sec of secoes) {
    // header + 1ª linha precisam caber; senão começa nova página.
    if (y > 0 && y + SECHEAD + ROW > USABLE) novaPagina();
    let seg = { sec, cont: false, cards: [] };
    pagina.segs.push(seg);
    y += SECHEAD;
    for (let i = 0; i < sec.cards.length; i += 2) {
      if (y + ROW > USABLE) {
        novaPagina();
        seg = { sec, cont: true, cards: [] }; // repete header com "(cont.)"
        pagina.segs.push(seg);
        y += SECHEAD;
      }
      seg.cards.push(...sec.cards.slice(i, i + 2));
      y += ROW;
    }
  }

  if (parcial) {
    if (y > 0 && y + CLOSING > USABLE) novaPagina();
    pagina.closing = true;
    y += CLOSING;
  }
  if (pagina.segs.length || pagina.closing) paginas.push(pagina);
  return paginas;
}

// ───────────────────────── renderers ─────────────────────────

function renderCover({ titulo, subtitulo, edicao, parcial, tagline }) {
  return `<div class="sheet cover">
    <div class="cov-grad"></div>
    <div class="cov-center">
      <img class="cov-logo" src="${LOGO_VERTICAL}" alt="Nogária">
      <div class="cov-title">${escapeHtml(titulo)}</div>
      <div class="cov-rule"></div>
      ${subtitulo ? `<div class="cov-sub">${escapeHtml(subtitulo)}</div>` : ""}
      ${parcial ? `<div class="cov-pill">CATÁLOGO PARCIAL · ${escapeHtml(edicao)}</div>` : ""}
    </div>
    <div class="cov-bottom">
      <span>LOGÍSTICA REVERSA &amp; OUTLET</span>
      <span>${escapeHtml(tagline)}</span>
    </div>
  </div>`;
}

function renderHead(parcial) {
  const meta = parcial ? "Catálogo de Produtos · Edição Parcial" : "Catálogo de Produtos";
  return `<div class="phead"><img class="ph-logo" src="${LOGO_HORIZONTAL}" alt="Nogária"><div class="ph-meta">${meta}</div></div>`;
}

function renderFootBar(pageNum, parcial) {
  const meio = parcial ? "Catálogo parcial — novos produtos em breve" : "";
  return `<div class="pfoot-bar"><span>Nogária · Logística Reversa &amp; Outlet</span><span>${meio}</span><span>${String(pageNum).padStart(2, "0")}</span></div>`;
}

function renderSectionHead(sec, cont) {
  return `<div class="sechead"><svg class="secicon" viewBox="0 0 24 24">${iconeDoGrupo(sec.grupoRaw || sec.titulo)}</svg><h2>${escapeHtml(String(sec.titulo).toUpperCase())}${cont ? " (CONT.)" : ""}</h2></div>`;
}

function renderCard(card, { comFoto, mostrarPreco, fotos }) {
  const it = card.rep;
  const badge = badgeDoEstado(it.estado);
  const pmodel = modeloLinha(it);
  const spec = specCurta(it);
  const foto = comFoto ? fotos?.[it.sku] : null;
  return `<div class="card${comFoto ? " foto" : ""}">
    <div class="stripe"></div>
    <div class="cbody">
      ${foto ? `<img class="photo" src="${escapeHtml(foto)}" alt="">` : ""}
      ${badge ? `<span class="badge ${badge.cls}">${escapeHtml(badge.txt)}</span>` : ""}
      <div class="pname">${escapeHtml(it.produto || it.sku)}</div>
      ${pmodel ? `<div class="pmodel">${escapeHtml(pmodel)}</div>` : ""}
      <div class="pspec">${escapeHtml(spec)}</div>
      <div class="pfoot">
        <span class="price">${mostrarPreco ? precoCatalogo(it.preco_sugerido) : ""}</span>
        ${card.qtd > 1 ? `<span class="qty">${card.qtd} disponíveis</span>` : ""}
      </div>
    </div>
  </div>`;
}

function renderClosing() {
  return `<div class="closing">
    <img class="cl-logo" src="${LOGO_BRANCO}" alt="Nogária">
    <div>
      <div class="cl-title">Este é um catálogo parcial.</div>
      <div class="cl-sub">Estamos catalogando todo o nosso estoque e atualizaremos esta seleção com muitos novos produtos em breve. Consulte-nos para disponibilidade, condição detalhada e condições de atacado.</div>
    </div>
  </div>`;
}

// CSS canônico da spec (seção 7), com pequenos acréscimos de clamp p/ proteger
// a estimativa de altura da paginação. Fontes só Arial/Helvetica (render offline).
const CSS = `
@page { size: A4; margin: 0; }
* { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
html,body { margin:0; padding:0; font-family:Arial,"Helvetica Neue",Helvetica,sans-serif; color:#1f2d3a; }
:root{ --navy:#004078; --cyan:#2BB5E8; --green:#5CB85C; --ink:#22303c; --line:#e6ebf0; }
.sheet{ width:210mm; min-height:297mm; padding:16mm 15mm 14mm; position:relative; page-break-after:always; overflow:hidden; }
.sheet:last-child{ page-break-after:auto; }
.cover{ padding:0; display:flex; flex-direction:column; }
.cov-grad{ position:absolute; inset:0 0 auto 0; height:14mm; background:linear-gradient(90deg,var(--cyan),var(--green)); }
.cov-center{ flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:0 20mm; }
.cov-logo{ width:88mm; height:auto; margin-bottom:14mm; }
.cov-title{ font-size:32pt; font-weight:800; color:var(--navy); letter-spacing:.5px; }
.cov-rule{ width:46mm; height:4px; border-radius:3px; margin:9mm 0 7mm; background:linear-gradient(90deg,var(--cyan),var(--green)); }
.cov-sub{ font-size:12.5pt; color:#5b6b78; letter-spacing:2.5px; text-transform:uppercase; }
.cov-pill{ margin-top:16mm; display:inline-block; padding:7px 20px; border:1.5px solid var(--cyan); border-radius:40px; color:var(--navy); font-size:9.5pt; font-weight:700; letter-spacing:2px; }
.cov-bottom{ height:24mm; background:var(--navy); color:#dceaf4; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; }
.cov-bottom span:first-child{ font-size:11pt; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:#fff; }
.cov-bottom span:last-child{ font-size:8.6pt; color:#9fc2db; }
.phead{ display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid var(--line); padding-bottom:7px; margin-bottom:9mm; }
.ph-logo{ height:8.5mm; } .ph-meta{ font-size:8.4pt; color:#8a98a5; letter-spacing:1.4px; text-transform:uppercase; }
.pfoot-bar{ position:absolute; left:15mm; right:15mm; bottom:9mm; display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--line); padding-top:6px; font-size:7.6pt; color:#9aa7b2; }
.pfoot-bar span:last-child{ font-weight:700; color:var(--navy); }
.section{ margin-bottom:8mm; }
.sechead{ display:flex; align-items:center; gap:9px; margin-bottom:5mm; }
.secicon{ width:7mm; height:7mm; fill:none; stroke:var(--navy); stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
.sechead h2{ margin:0; font-size:12.5pt; font-weight:800; color:var(--navy); letter-spacing:1.5px; }
.sechead:after{ content:""; flex:1; height:3px; border-radius:3px; background:linear-gradient(90deg,var(--cyan),var(--green)); opacity:.85; }
.grid{ display:grid; grid-template-columns:1fr 1fr; gap:5mm; margin-bottom:5mm; }
.card{ display:flex; background:#fff; border:1px solid var(--line); border-radius:9px; overflow:hidden; box-shadow:0 1px 3px rgba(0,64,120,.05); page-break-inside:avoid; }
.stripe{ width:5px; flex:none; background:linear-gradient(180deg,var(--cyan),var(--green)); }
.cbody{ position:relative; padding:9px 11px 10px; flex:1; min-width:0; }
.badge{ position:absolute; top:9px; right:10px; font-size:6.4pt; font-weight:800; letter-spacing:.6px; text-transform:uppercase; white-space:nowrap; padding:3px 7px; border-radius:20px; }
.badge.novo{ background:#e7f6ec; color:#2f8b46; } .badge.semi{ background:#eaf4fb; color:#1f6fa8; } .badge.aberta{ background:#fdf3e6; color:#bd7a1e; }
.pname{ font-size:10.3pt; font-weight:800; color:var(--ink); line-height:1.2; padding-right:82px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.pmodel{ font-size:7.7pt; color:#8693a0; letter-spacing:.4px; text-transform:uppercase; margin:3px 0 6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pspec{ font-size:8.2pt; color:#5f6e7a; line-height:1.35; min-height:21px; }
.pfoot{ display:flex; align-items:baseline; justify-content:space-between; margin-top:8px; padding-top:7px; border-top:1px dashed var(--line); }
.price{ font-size:15pt; font-weight:800; color:var(--navy); } .qty{ font-size:7.4pt; color:#8a98a5; font-weight:700; }
.card.foto .cbody{ padding-top:0; } .card.foto .photo{ width:100%; height:34mm; object-fit:contain; background:#f6f9fb; border-bottom:1px solid var(--line); margin:0 -11px 8px; width:calc(100% + 22px); }
.card.foto .pname{ padding-right:0; }
.closing{ margin-top:9mm; border-radius:12px; padding:9mm 10mm; display:flex; align-items:center; gap:9mm; background:linear-gradient(120deg,#00355f,#004078 55%,#0a5a86); }
.cl-logo{ width:34mm; flex:none; } .cl-title{ color:#fff; font-size:14pt; font-weight:800; margin-bottom:4px; } .cl-sub{ color:#bcd6e8; font-size:9pt; line-height:1.5; }
`;

// Monta o HTML completo do catálogo.
// opts: { titulo, subtitulo, edicao, parcial, comFoto, mostrarPreco, fotos, tagline }
export function gerarCatalogoHTML(secoes, opts = {}) {
  const {
    titulo = "Catálogo de Produtos",
    subtitulo = "",
    edicao = "",
    parcial = true,
    comFoto = false,
    mostrarPreco = true,
    fotos = {},
    tagline = "Produtos selecionados · atacado e varejo",
  } = opts;

  const paginas = paginar(secoes, { comFoto, parcial });

  const conteudo = paginas
    .map((pagina, i) => {
      const corpo = pagina.segs
        .map(
          (seg) =>
            renderSectionHead(seg.sec, seg.cont) +
            `<div class="grid">${seg.cards.map((c) => renderCard(c, { comFoto, mostrarPreco, fotos })).join("")}</div>`
        )
        .join("");
      return `<div class="sheet">${renderHead(parcial)}${corpo}${pagina.closing ? renderClosing() : ""}${renderFootBar(i + 2, parcial)}</div>`;
    })
    .join("");

  return (
    `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">` +
    `<title>${escapeHtml(titulo)} — NOGÁRIA OUTLET</title><style>${CSS}</style></head>` +
    `<body>${renderCover({ titulo, subtitulo, edicao, parcial, tagline })}${conteudo}</body></html>`
  );
}
