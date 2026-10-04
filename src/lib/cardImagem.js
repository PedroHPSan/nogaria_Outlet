// Renderizador de canvas (browser) dos cards de divulgação: interpreta as ops de
// cardCore e devolve PNG. Fonte: Sora quando carregada na página; senão Arial.
const FONTE = '"Sora", Arial, Helvetica, sans-serif';

const carregar = (src) => new Promise((res, rej) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = () => rej(new Error("imagem inválida"));
  img.src = src;
});

function quebrar(ctx, s, maxW, maxLines) {
  if (!maxW) return [String(s ?? "")];
  const palavras = String(s ?? "").split(/\s+/);
  const linhas = [];
  let atual = "";
  for (const p of palavras) {
    const t = atual ? `${atual} ${p}` : p;
    if (ctx.measureText(t).width <= maxW || !atual) atual = t; else { linhas.push(atual); atual = p; }
  }
  if (atual) linhas.push(atual);
  if (!maxLines || linhas.length <= maxLines) return linhas;
  const cortadas = linhas.slice(0, maxLines);
  let ult = cortadas[maxLines - 1];
  while (ult.length > 1 && ctx.measureText(`${ult}…`).width > maxW) ult = ult.slice(0, -1);
  cortadas[maxLines - 1] = `${ult.trimEnd()}…`;
  return cortadas;
}

function caminho(ctx, x, y, w, h, r) {
  if (!r) { ctx.rect(x, y, w, h); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// card: { w, h, ops } de cardCore. Retorna Promise<Blob PNG>.
export async function renderizarCard(card) {
  const canvas = document.createElement("canvas");
  canvas.width = card.w; canvas.height = card.h;
  const ctx = canvas.getContext("2d");
  for (const op of card.ops) {
    if (op.k === "rect") {
      ctx.beginPath(); caminho(ctx, op.x, op.y, op.w, op.h, op.r);
      if (op.fill) { ctx.fillStyle = op.fill; ctx.fill(); }
      if (op.stroke) { ctx.strokeStyle = op.stroke; ctx.lineWidth = op.lw || 2; ctx.stroke(); }
    } else if (op.k === "text") {
      ctx.font = `${op.bold ? 700 : 400} ${op.size}px ${FONTE}`;
      ctx.fillStyle = op.color || "#000"; ctx.textAlign = op.align || "left"; ctx.textBaseline = "alphabetic";
      const lh = op.lineH || op.size * 1.2;
      quebrar(ctx, op.s, op.maxW, op.maxLines).forEach((ln, i) => ctx.fillText(ln, op.x, op.y + i * lh));
    } else if (op.k === "img") {
      try {
        const img = await carregar(op.src);
        let { x, y, w, h } = op;
        if (op.fit === "contain") {
          const r = Math.min(w / img.width, h / img.height);
          const nw = img.width * r; const nh = img.height * r;
          x += (w - nw) / 2; y += (h - nh) / 2; w = nw; h = nh;
        }
        ctx.drawImage(img, x, y, w, h);
      } catch { /* sem a imagem, o card segue */ }
    } else if (op.k === "line") {
      ctx.beginPath(); ctx.moveTo(op.x1, op.y1); ctx.lineTo(op.x2, op.y2);
      ctx.strokeStyle = op.color; ctx.lineWidth = op.lw || 2; ctx.stroke();
    }
  }
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("falha ao gerar PNG"))), "image/png"));
}
