// Geração de PDF das etiquetas com jsPDF (texto vetorial em mm + QR como imagem).
// Reaproveita o objeto de etiqueta montado em labels.js (mesmo conteúdo do LabelCard).
import { jsPDF } from "jspdf";
import { LOGO_ICON, LOGO_ICON_RATIO } from "./logo";

const ptToMm = (pt) => (pt * 25.4) / 72;

function drawLabel(doc, label, preset) {
  const W = preset.width;
  const H = preset.height;
  const compact = preset.compact;
  // Etiqueta "alta" (DK-11202 62×100): QR/fontes maiores e campos extras.
  const tall = !compact && H >= 80;
  const isBox = label.tipo === "CAIXA" || label.tipo === "MALA";
  const isRoom = label.tipo === "SALA";
  const m = compact ? 1.6 : 2.4;
  // Margem superior maior no compacto: evita o cabeçalho ser cortado pela zona
  // morta de topo da impressora térmica (espelha o paddingTop do LabelCard).
  let y = compact ? m + 2 : m;

  // Cabeçalho: logo (silhueta) + título do tipo de etiqueta, centralizados na altura.
  const logoH = compact ? 4 : 5;
  const logoW = logoH * LOGO_ICON_RATIO;
  const gap = compact ? 1.2 : 1.6;
  try {
    doc.addImage(LOGO_ICON, "PNG", m, y, logoW, logoH);
  } catch {
    /* ignora logo inválida */
  }
  const hfpt = compact ? 5.5 : 7;
  const titX = m + logoW + gap;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(hfpt);
  const titLines = doc.splitTextToSize(label.titulo, W - titX - m);
  // alinha o texto ao centro da logo; se o título quebrar e ficar mais alto,
  // o cabeçalho cresce para o texto (evita colidir com a linha divisória).
  const titBlockH = titLines.length * ptToMm(hfpt) * 1.1;
  let titY = y + Math.max(0, (logoH - titBlockH) / 2) + ptToMm(hfpt);
  for (const ln of titLines) {
    doc.text(ln, titX, titY);
    titY += ptToMm(hfpt) * 1.1;
  }
  y += Math.max(logoH, titBlockH) + 1;
  doc.setLineWidth(0.3);
  doc.line(m, y, W - m, y);
  y += 1.5;

  // QR no canto superior direito (maior na etiqueta alta 62×100)
  const qrSize = compact ? 16 : (tall ? (isBox ? 28 : 26) : 19);
  const qrX = W - m - qrSize;
  const qrY = y;
  if (label.qrData) {
    try {
      doc.addImage(label.qrData, "PNG", qrX, qrY, qrSize, qrSize);
    } catch {
      /* ignora QR inválido */
    }
  }

  const leftW = qrX - m - 1.5; // largura útil ao lado do QR

  // SKU em destaque (fonte reduzida p/ não quebrar em duas linhas no compacto)
  const skuPt = compact ? 10 : (tall ? (isBox ? 15 : 12) : 11);
  doc.setFont("courier", "bold");
  doc.setFontSize(skuPt);
  doc.text(doc.splitTextToSize(label.sku, leftW), m, y + ptToMm(skuPt));
  y += ptToMm(skuPt) + 1;

  // Linha de identificação ao lado do QR
  const idPt = compact ? 6.5 : (tall ? 8.5 : 7.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(idPt);
  const idLine = isRoom
    ? (label.nome || "")
    : isBox
    ? `${label.tipo} · ${label.qtd} itens${label.pesoTxt ? ` · ${label.pesoTxt}` : ""}`
    : `Lote ${label.lote}${label.classe ? ` · Classe ${label.classe}` : ""}`;
  doc.text(doc.splitTextToSize(idLine, leftW), m, y + ptToMm(idPt));

  // Abaixo do QR começa o corpo em largura total
  y = Math.max(y, qrY + qrSize) + 1.5;

  const line = (text, { size = compact ? 6.5 : 8, bold = false } = {}) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, W - 2 * m);
    for (const ln of lines) {
      doc.text(ln, m, y + ptToMm(size));
      y += ptToMm(size) + 0.6;
    }
  };

  if (isRoom) {
    if (label.observacao) line(label.observacao);
    line("Escaneie o QR para ver o conteúdo da sala.", { bold: true });
  } else if (!isBox) {
    // Faixa de estado — só no layout completo (62 mm). No compacto é omitida.
    if (!compact) {
      const ePt = tall ? 9 : 8;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(ePt);
      doc.setLineWidth(0.4);
      const boxH = ptToMm(ePt) + 1.6;
      doc.rect(m, y, W - 2 * m, boxH);
      doc.text(label.estadoTexto, W / 2, y + boxH / 2 + ptToMm(ePt) / 2 - 0.3, {
        align: "center",
      });
      y += boxH + 1.2;
    }

    line(label.produto, { size: compact ? 7.5 : (tall ? 11 : 9), bold: true });
    if (tall && label.medidas) line(`Medidas: ${label.medidas}`, { bold: true });
    line(`Caixa/Mala: ${label.caixa_num}  ·  Sala: ${label.sala}`);
    line(`Destino: ${label.destino}`, { bold: true });
    if (label.aviso) line(label.aviso, { bold: true });
  } else {
    line(`Sala: ${label.sala}  ·  Destino: ${label.destino}`);
    if (!tall && label.lotes?.length) line(`Lotes: ${label.lotes.join(", ")}`);
    if (tall && label.classeResumo) line(`Classes: ${label.classeResumo}`, { bold: true });
    if (tall && label.loteResumo) line(`Por lote: ${label.loteResumo}`, { bold: true });
    line("Conteúdo (SKUs):", { bold: true });
    line(label.skus.join(", "), { size: compact ? 6 : 7 });
  }

  // Checkboxes (produto/quarentena) — perto do rodapé.
  // No layout compacto (29 mm) são omitidos: o ticket prioriza espaço/identificação.
  if (!isBox && !isRoom && !compact) {
    const cbY = Math.min(y + 0.5, H - m - 3);
    let cbX = m;
    const sq = 2.4;
    doc.setLineWidth(0.3);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(compact ? 6 : 7.5);
    for (const c of label.checkboxes) {
      doc.rect(cbX, cbY, sq, sq);
      doc.text(c, cbX + sq + 0.6, cbY + sq - 0.4);
      cbX += sq + 0.6 + doc.getTextWidth(c) + 2;
    }
  }
}

export function generateLabelsPdf(labels, preset, filename = "etiquetas-nogaria.pdf") {
  if (!labels?.length) return;
  const doc = new jsPDF({
    unit: "mm",
    format: [preset.width, preset.height],
    orientation: "portrait",
    compress: true,
  });
  labels.forEach((label, i) => {
    if (i > 0) doc.addPage([preset.width, preset.height], "portrait");
    drawLabel(doc, label, preset);
  });
  doc.save(filename);
}
