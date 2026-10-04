// Desenha em jsPDF as páginas calculadas por catalogoPdfCore (vetorial, A4 em mm).
// Texto em Helvetica (WinAnsi cobre acentos do pt-BR); fotos/QR entram como imagem.
import { jsPDF } from "jspdf";
import { montarCatalogoPdf, A4 } from "./catalogoPdfCore.js";

const ptMm = (pt) => (pt * 25.4) / 72;

function rgb(hex) {
  const h = String(hex || "#000000").replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function linhas(doc, s, maxW, maxLines) {
  const todas = maxW ? doc.splitTextToSize(String(s ?? ""), maxW) : [String(s ?? "")];
  if (!maxLines || todas.length <= maxLines) return todas;
  const cortadas = todas.slice(0, maxLines);
  let ult = cortadas[maxLines - 1];
  while (ult.length > 1 && doc.getTextWidth(`${ult}…`) > maxW) ult = ult.slice(0, -1);
  cortadas[maxLines - 1] = `${ult.trimEnd()}…`;
  return cortadas;
}

function desenhar(doc, op) {
  if (op.k === "rect") {
    const estilo = op.fill && op.stroke ? "FD" : op.fill ? "F" : op.stroke ? "S" : "";
    if (op.fill) doc.setFillColor(...rgb(op.fill));
    if (op.stroke) { doc.setDrawColor(...rgb(op.stroke)); doc.setLineWidth(op.lw || 0.3); }
    if (!estilo) return;
    if (op.r) doc.roundedRect(op.x, op.y, op.w, op.h, op.r, op.r, estilo);
    else doc.rect(op.x, op.y, op.w, op.h, estilo);
  } else if (op.k === "line") {
    doc.setDrawColor(...rgb(op.color)); doc.setLineWidth(op.lw || 0.3);
    doc.line(op.x1, op.y1, op.x2, op.y2);
  } else if (op.k === "text") {
    doc.setFont("helvetica", op.bold ? "bold" : "normal");
    doc.setFontSize(op.size || 10);
    doc.setTextColor(...rgb(op.color));
    const ls = linhas(doc, op.s, op.maxW, op.maxLines);
    const lh = op.lineH || ptMm(op.size || 10) * 1.2;
    ls.forEach((ln, i) => {
      const y = op.y + i * lh;
      doc.text(ln, op.x, y, { align: op.align || "left" });
      if (op.strike) {
        const w = doc.getTextWidth(ln);
        const x0 = op.align === "right" ? op.x - w : op.align === "center" ? op.x - w / 2 : op.x;
        doc.setDrawColor(...rgb(op.color)); doc.setLineWidth(0.25);
        doc.line(x0, y - ptMm(op.size || 10) * 0.3, x0 + w, y - ptMm(op.size || 10) * 0.3);
      }
    });
  } else if (op.k === "img") {
    try {
      let { x, y, w, h } = op;
      if (op.fit === "contain") {
        const p = doc.getImageProperties(op.src);
        const r = Math.min(w / p.width, h / p.height);
        const nw = p.width * r; const nh = p.height * r;
        x += (w - nw) / 2; y += (h - nh) / 2; w = nw; h = nh;
      }
      doc.addImage(op.src, x, y, w, h, undefined, "FAST");
    } catch {
      /* imagem inválida: o card segue sem ela */
    }
  }
}

// secoes: agruparCatalogo(...); spec: normalizarSpec(...); ctx: { fotos, qrs, logos, contato }.
export function gerarCatalogoPdf(secoes, spec, ctx = {}) {
  const { paginas, resumo } = montarCatalogoPdf(secoes, spec, ctx);
  const doc = new jsPDF({ unit: "mm", format: [A4.w, A4.h], compress: true });
  paginas.forEach((pg, i) => {
    if (i > 0) doc.addPage([A4.w, A4.h]);
    pg.ops.forEach((op) => desenhar(doc, op));
  });
  doc.setProperties({ title: spec.titulo, author: "Nogária Outlet" });
  return { blob: doc.output("blob"), resumo };
}
