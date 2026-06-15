// Geração de PDF das etiquetas com jsPDF (texto vetorial em mm + QR como imagem).
// Reaproveita o objeto de etiqueta montado em labels.js (mesmo conteúdo do LabelCard).
import { jsPDF } from "jspdf";

const ptToMm = (pt) => (pt * 25.4) / 72;

function drawLabel(doc, label, preset) {
  const W = preset.width;
  const H = preset.height;
  const compact = preset.compact;
  const m = compact ? 1.6 : 2.4;
  let y = m;

  // Cabeçalho
  doc.setFont("helvetica", "bold");
  doc.setFontSize(compact ? 5.5 : 7);
  doc.text(doc.splitTextToSize(label.titulo, W - 2 * m), m, y + ptToMm(compact ? 5.5 : 7));
  y += ptToMm(compact ? 5.5 : 7) + 1;
  doc.setLineWidth(0.3);
  doc.line(m, y, W - m, y);
  y += 1.5;

  // QR no canto superior direito
  const qrSize = compact ? 16 : 19;
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

  // SKU em destaque
  doc.setFont("courier", "bold");
  doc.setFontSize(compact ? 11 : 13);
  doc.text(doc.splitTextToSize(label.sku, leftW), m, y + ptToMm(compact ? 11 : 13));
  y += ptToMm(compact ? 11 : 13) + 1;

  // Linha de identificação ao lado do QR
  doc.setFont("helvetica", "normal");
  doc.setFontSize(compact ? 6.5 : 7.5);
  const isBox = label.tipo === "CAIXA" || label.tipo === "MALA";
  const idLine = isBox
    ? `${label.tipo} · ${label.qtd} itens`
    : `Lote ${label.lote}${label.classe ? ` · Classe ${label.classe}` : ""}`;
  doc.text(doc.splitTextToSize(idLine, leftW), m, y + ptToMm(compact ? 6.5 : 7.5));

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

  if (!isBox) {
    // Faixa de estado
    doc.setFont("helvetica", "bold");
    doc.setFontSize(compact ? 6.5 : 8);
    doc.setLineWidth(0.4);
    const boxH = ptToMm(compact ? 6.5 : 8) + 1.6;
    doc.rect(m, y, W - 2 * m, boxH);
    doc.text(label.estadoTexto, W / 2, y + boxH / 2 + ptToMm(compact ? 6.5 : 8) / 2 - 0.3, {
      align: "center",
    });
    y += boxH + 1.2;

    line(label.produto, { size: compact ? 7.5 : 9, bold: true });
    line(`Caixa/Mala: ${label.caixa_num}  ·  Local: ${label.local_fisico}`);
    line(`Destino: ${label.destino}`, { bold: true });
    if (label.precoMin || label.precoIdeal)
      line(`Mín ${label.precoMin || "—"}  |  Ideal ${label.precoIdeal || "—"}`, {
        size: compact ? 7 : 9,
        bold: true,
      });
    if (label.aviso) line(label.aviso, { bold: true });
  } else {
    line(`Local: ${label.local_fisico}  ·  Destino: ${label.destino}`);
    line(`Valor estimado: ${label.valorEstimado}`, { bold: true });
    if (label.lotes?.length) line(`Lotes: ${label.lotes.join(", ")}`);
    line("Conteúdo (SKUs):", { bold: true });
    line(label.skus.join(", "), { size: compact ? 6 : 7 });
  }

  // Checkboxes (produto/quarentena) — perto do rodapé
  if (!isBox) {
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
