// Anúncio/orçamento de UM item → HTML A4 autônomo (layout "Conversão/Marketplace").
// PURO (sem rede): recebe as fotos já como dataURI e o QR já como dataURL — testável
// em Node. Reaproveita helpers de escape/preço/formatos e os selos de condição.
import { escapeHtml } from "./html.js";
import { precoVenda } from "./export.js";
import { fmtBRL, fmtKg, embalagemLabel } from "./model.js";
import { CATALOGO_ESTADO_BADGE } from "./catalogoCore.js";
import { LOGO_HORIZONTAL } from "./catalogoLogos.js";
import { EMPRESA } from "./empresa.js";

export const PAGAMENTO_PADRAO = "À vista no PIX ou combine o parcelamento no WhatsApp";
export const ENTREGA_PADRAO = "Retirada em Belém ou envio combinado (frete por conta do comprador)";

export const nomeAnuncio = (it) => (it?.titulo_anuncio || it?.produto || it?.sku || "").trim();

// "MARCA · MODELO · COR" em caps, omitindo partes vazias.
function modeloLinha(it) {
  let s = [it.marca, it.modelo].filter(Boolean).join(" · ");
  if (it.cor) s = s ? `${s} · ${it.cor}` : it.cor;
  return s.toUpperCase();
}

// Linhas da ficha técnica (rótulo→valor), já sem os campos vazios.
function specRows(it) {
  const peso = it.peso_real_kg ?? it.peso_kg;
  const temDims = [it.comprimento_cm, it.largura_cm, it.altura_cm].every((v) => v != null && v !== "");
  const dims = temDims ? `${it.comprimento_cm}×${it.largura_cm}×${it.altura_cm} cm` : null;
  const rows = [
    ["Marca", it.marca],
    ["Modelo", it.modelo],
    ["Cor", it.cor],
    ["Tamanho", it.tamanho],
    ["Voltagem", it.voltagem && it.voltagem !== "N/A" ? it.voltagem : null],
    ["Peso", peso != null && peso !== "" ? fmtKg(peso) : null],
    ["Dimensões", dims],
    ["Cód. de barras", it.gtin],
    ["SKU", it.sku],
  ];
  return rows.filter(([, v]) => v != null && String(v).trim() !== "");
}

const badgeEstado = (estado) => CATALOGO_ESTADO_BADGE[(estado || "").trim()] || null;

// Mensagem que o CLIENTE envia ao tocar no WhatsApp/QR (perspectiva do comprador).
export function mensagemWhatsApp(it, empresa = EMPRESA) {
  const nome = nomeAnuncio(it);
  const preco = precoVenda(it);
  return [
    `Olá! Tenho interesse neste produto do ${empresa.nome}:`,
    "",
    `*${nome}*`,
    it.sku ? `Cód: ${it.sku}` : null,
    preco != null ? `Valor: ${fmtBRL(preco)}` : "Valor: sob consulta",
    "",
    "Está disponível?",
  ].filter((l) => l != null).join("\n");
}

const CSS = `
@page { size:A4; margin:0; }
* { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
html,body { margin:0; padding:0; font-family:Arial,"Helvetica Neue",Helvetica,sans-serif; color:#22303c; }
:root{ --navy:#004078; --cyan:#2BB5E8; --green:#5CB85C; --ink:#22303c; --line:#e6ebf0; }
.sheet{ width:210mm; min-height:297mm; padding:14mm 15mm 0; position:relative; display:flex; flex-direction:column; }
.head{ display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid var(--line); padding-bottom:9px; }
.head img{ height:11mm; }
.badge{ font-size:8pt; font-weight:800; letter-spacing:.6px; text-transform:uppercase; padding:5px 12px; border-radius:20px; }
.badge.novo{ background:#e7f6ec; color:#2f8b46; } .badge.semi{ background:#eaf4fb; color:#1f6fa8; }
.badge.aberta{ background:#fdf3e6; color:#bd7a1e; } .badge.asis{ background:#f1f3f5; color:#5f6b76; }
.photo{ margin-top:9mm; height:92mm; background:#f6f9fb; border:1px solid var(--line); border-radius:12px; display:flex; align-items:center; justify-content:center; overflow:hidden; }
.photo img{ max-width:100%; max-height:100%; object-fit:contain; }
.photo .noimg{ color:#9db3c4; font-size:11pt; letter-spacing:1px; }
.thumbs{ display:flex; gap:6px; margin-top:6px; }
.thumbs .t{ width:28mm; height:22mm; background:#f6f9fb; border:1px solid var(--line); border-radius:7px; overflow:hidden; }
.thumbs img{ width:100%; height:100%; object-fit:cover; }
.pname{ font-size:19pt; font-weight:800; color:var(--ink); line-height:1.15; margin-top:7mm; }
.pmodel{ font-size:9pt; color:#8693a0; letter-spacing:.6px; text-transform:uppercase; margin-top:3px; }
.pdesc{ font-size:9.5pt; color:#5f6e7a; line-height:1.45; margin-top:6px; }
.priceband{ margin-top:6mm; border-radius:12px; background:linear-gradient(90deg,var(--cyan),var(--green)); color:#fff; padding:12px 18px; display:flex; align-items:center; justify-content:space-between; }
.priceband .lbl{ font-size:9pt; font-weight:700; letter-spacing:1px; opacity:.95; }
.priceband .val{ font-size:27pt; font-weight:800; line-height:1; }
.paycond{ font-size:8.5pt; color:#5f6e7a; margin-top:5px; }
.specs{ margin-top:6mm; display:grid; grid-template-columns:1fr 1fr; gap:0 22px; }
.specs .row{ display:flex; justify-content:space-between; border-bottom:1px dotted var(--line); padding:5px 0; font-size:9.5pt; }
.specs .k{ color:#8a98a5; } .specs .v{ color:var(--ink); font-weight:700; text-align:right; }
.estado{ margin-top:5mm; font-size:9pt; color:#5f6e7a; line-height:1.5; }
.estado b{ color:var(--navy); }
.foot{ margin-top:auto; }
.cta{ background:#0a2540; border-radius:14px; padding:6mm 7mm; display:flex; align-items:center; gap:7mm; color:#fff; }
.cta .wbtn{ flex:1; }
.cta .wbtn .b{ background:#25D366; color:#fff; font-size:13pt; font-weight:800; padding:11px 16px; border-radius:9px; display:inline-block; }
.cta .wbtn .n{ font-size:10pt; margin-top:7px; color:#cfe0ee; }
.cta .qr{ background:#fff; padding:6px; border-radius:9px; } .cta .qr img{ width:26mm; height:26mm; display:block; }
.bar{ height:7px; background:linear-gradient(90deg,var(--cyan),var(--green)); margin-top:6mm; }
`;

// Monta o HTML A4 completo. opts: { fotos:{principal,galeria[]}, qrDataUrl, empresa,
// pagamento, entrega }. Sem preço → "Sob consulta"; sem foto → placeholder.
export function gerarAnuncioHTML(it, opts = {}) {
  const {
    fotos = {}, qrDataUrl = null, empresa = EMPRESA,
    pagamento = PAGAMENTO_PADRAO, entrega = ENTREGA_PADRAO,
  } = opts;

  const preco = precoVenda(it);
  const badge = badgeEstado(it.estado);
  const nome = nomeAnuncio(it);
  const modelo = modeloLinha(it);
  const rows = specRows(it);
  const principal = fotos.principal;
  const galeria = (fotos.galeria || []).slice(0, 4);

  const specsHtml = rows
    .map(([k, v]) => `<div class="row"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(String(v))}</span></div>`)
    .join("");

  const thumbsHtml = galeria.length
    ? `<div class="thumbs">${galeria.map((u) => `<div class="t"><img src="${escapeHtml(u)}" alt=""></div>`).join("")}</div>`
    : "";

  const priceHtml = preco != null
    ? `<div class="priceband"><span class="lbl">PREÇO À VISTA</span><span class="val">${escapeHtml(fmtBRL(preco))}</span></div><div class="paycond">${escapeHtml(pagamento)}</div>`
    : `<div class="priceband"><span class="lbl">VALOR</span><span class="val">Sob consulta</span></div><div class="paycond">${escapeHtml(pagamento)}</div>`;

  const estadoPartes = [
    badge ? `<b>Condição:</b> ${escapeHtml(badge.txt)}` : null,
    it.cond_embalagem ? `<b>Embalagem:</b> ${escapeHtml(embalagemLabel(it.cond_embalagem))}` : null,
  ].filter(Boolean).join(" · ");
  const estadoHtml = `<div class="estado">${estadoPartes ? estadoPartes + "<br>" : ""}<b>Entrega:</b> ${escapeHtml(entrega)}</div>`;

  const qrHtml = qrDataUrl ? `<div class="qr"><img src="${escapeHtml(qrDataUrl)}" alt="QR WhatsApp"></div>` : "";

  return (
    `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">` +
    `<title>${escapeHtml(nome)} — ${escapeHtml(empresa.nome)}</title><style>${CSS}</style></head><body>` +
    `<div class="sheet">` +
      `<div class="head"><img src="${LOGO_HORIZONTAL}" alt="${escapeHtml(empresa.nome)}">` +
        (badge ? `<span class="badge ${badge.cls}">${escapeHtml(badge.txt)}</span>` : "") +
      `</div>` +
      `<div class="photo">${principal ? `<img src="${escapeHtml(principal)}" alt="">` : `<span class="noimg">SEM FOTO</span>`}</div>` +
      thumbsHtml +
      `<div class="pname">${escapeHtml(nome)}</div>` +
      (modelo ? `<div class="pmodel">${escapeHtml(modelo)}</div>` : "") +
      (it.descricao_anuncio ? `<div class="pdesc">${escapeHtml(it.descricao_anuncio)}</div>` : "") +
      priceHtml +
      (specsHtml ? `<div class="specs">${specsHtml}</div>` : "") +
      estadoHtml +
      `<div class="foot"><div class="cta">` +
        `<div class="wbtn"><span class="b">📱 Comprar no WhatsApp</span><div class="n">${escapeHtml(empresa.whatsappLabel)} · ${escapeHtml(empresa.nome)}</div></div>` +
        qrHtml +
      `</div><div class="bar"></div></div>` +
    `</div></body></html>`
  );
}
