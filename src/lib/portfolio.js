// Portfólio de calçados para apresentar a clientes.
// Filtra os itens do grupo "Calçados", agrupa por tamanho (numeração) e monta
// uma galeria visual (com foto + preço opcional) que pode ser impressa ou salva
// como PDF pelo próprio diálogo do navegador (mesma técnica de iframe isolado
// das etiquetas — sem o CSS do app, layout próprio em A4).
import { supabase } from "./supabase.js";
import { precoVenda } from "./export.js";
import { fmtBRL } from "./model.js";
import { tamanhoLabel, ordenarTamanhos } from "./tamanhos.js";

// Reexporta os helpers de tamanho (agora em tamanhos.js) para manter a API antiga.
export { tamanhoLabel, ordenarTamanhos } from "./tamanhos.js";

// Categoria canônica de calçados (definida no motor de precificação / categorizar).
export const GRUPO_CALCADOS = "Calçados";

// Status que NÃO entram num portfólio de estoque disponível.
const STATUS_FORA = ["VENDIDO", "ENTREGUE", "DESCARTE"];

// Busca todos os calçados disponíveis (PostgREST corta em 1.000 linhas).
export async function listarCalcados({ incluirIndisponiveis = false } = {}) {
  const PAGE = 1000;
  let data = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from("itens").select("*").eq("grupo", GRUPO_CALCADOS);
    if (!incluirIndisponiveis) q = q.not("status", "in", `(${STATUS_FORA.join(",")})`);
    const { data: chunk, error } = await q.order("tamanho").order("sku").range(from, from + PAGE - 1);
    if (error || !chunk) break;
    data = data.concat(chunk);
    if (chunk.length < PAGE) break;
  }
  return data;
}

// Lista ordenada de tamanhos distintos presentes nos itens.
export function tamanhosDisponiveis(itens) {
  return ordenarTamanhos([...new Set((itens || []).map((it) => tamanhoLabel(it.tamanho)))]);
}

// Lista ordenada de marcas distintas (ignora vazias).
export function marcasDisponiveis(itens) {
  const set = new Set((itens || []).map((it) => (it.marca || "").trim()).filter(Boolean));
  return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

// Agrupa itens por tamanho, na ordem natural. Retorna [{ tamanho, itens }].
export function agruparPorTamanho(itens) {
  const mapa = new Map();
  for (const it of itens || []) {
    const t = tamanhoLabel(it.tamanho);
    if (!mapa.has(t)) mapa.set(t, []);
    mapa.get(t).push(it);
  }
  return ordenarTamanhos([...mapa.keys()]).map((t) => ({ tamanho: t, itens: mapa.get(t) }));
}

// ───────────────────────── Impressão / PDF ─────────────────────────

export const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Monta o HTML do catálogo (documento A4 autônomo), agrupado por tamanho.
// `fotos` = { [sku]: url }. `mostrarPreco` controla a exibição de preços.
export function gerarPortfolioHTML(grupos, { mostrarPreco = true, fotos = {}, titulo = "Catálogo de Calçados" } = {}) {
  const dataTxt = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const totalItens = grupos.reduce((a, g) => a + g.itens.length, 0);

  const card = (it) => {
    const url = fotos[it.sku];
    const preco = precoVenda(it);
    const detalhes = [it.marca, it.cor, it.estado].filter(Boolean).map(escapeHtml).join(" · ");
    return `
      <div class="card">
        <div class="thumb">${url ? `<img src="${escapeHtml(url)}" alt="">` : `<span class="noimg">sem foto</span>`}</div>
        <div class="info">
          <p class="nome">${escapeHtml(it.produto || it.sku)}</p>
          ${detalhes ? `<p class="det">${detalhes}</p>` : ""}
          ${mostrarPreco && preco != null ? `<p class="preco">${escapeHtml(fmtBRL(preco))}</p>` : ""}
        </div>
      </div>`;
  };

  const secoes = grupos
    .map(
      (g) => `
      <section class="grupo">
        <h2>Nº ${escapeHtml(g.tamanho)} <span>(${g.itens.length} ${g.itens.length === 1 ? "par" : "pares"})</span></h2>
        <div class="grid">${g.itens.map(card).join("")}</div>
      </section>`
    )
    .join("");

  const css = `
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; background: #fff; color: #111827;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    @page { size: A4; margin: 12mm; }
    header { display: flex; align-items: baseline; justify-content: space-between;
      border-bottom: 3px solid #f97316; padding-bottom: 8px; margin-bottom: 16px; }
    header h1 { font-size: 20px; margin: 0; letter-spacing: -0.3px; }
    header h1 b { color: #f97316; }
    header .meta { font-size: 11px; color: #6b7280; text-align: right; }
    .grupo { margin-bottom: 18px; break-inside: avoid; }
    .grupo h2 { font-size: 14px; margin: 0 0 8px; padding: 4px 8px; background: #111827; color: #fff;
      border-radius: 6px; display: inline-block; }
    .grupo h2 span { font-weight: 400; color: #d1d5db; font-size: 12px; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .card { border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; break-inside: avoid; }
    .thumb { aspect-ratio: 1 / 1; background: #f3f4f6; display: flex; align-items: center; justify-content: center; }
    .thumb img { width: 100%; height: 100%; object-fit: cover; }
    .thumb .noimg { font-size: 10px; color: #9ca3af; }
    .info { padding: 6px 8px; }
    .nome { font-size: 11px; font-weight: 700; margin: 0; line-height: 1.25;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .det { font-size: 10px; color: #6b7280; margin: 2px 0 0; }
    .preco { font-size: 13px; font-weight: 800; color: #059669; margin: 4px 0 0; }
    footer { margin-top: 16px; padding-top: 8px; border-top: 1px solid #e5e7eb;
      font-size: 10px; color: #9ca3af; text-align: center; }
  `;

  return (
    `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">` +
    `<title>${escapeHtml(titulo)} — NOGÁRIA OUTLET</title><style>${css}</style></head>` +
    `<body>` +
    `<header><h1><b>NOGÁRIA</b> OUTLET — ${escapeHtml(titulo)}</h1>` +
    `<div class="meta">${escapeHtml(dataTxt)}<br>${totalItens} ${totalItens === 1 ? "item" : "itens"}</div></header>` +
    secoes +
    `<footer>NOGÁRIA OUTLET · catálogo gerado em ${escapeHtml(dataTxt)}</footer>` +
    `</body></html>`
  );
}

// Converte um mapa { sku: signedUrl } em { sku: dataURI base64 }. A impressão/PDF
// não renderiza imagens remotas de forma confiável (carregam tarde no diálogo),
// então embutimos o binário. Best-effort: foto que falhar é simplesmente omitida.
export async function fotosComoDataURI(urlPorSku) {
  const out = {};
  await Promise.all(
    Object.entries(urlPorSku || {}).map(async ([sku, url]) => {
      if (!url) return;
      try {
        const resp = await fetch(url);
        if (!resp.ok) return;
        const blob = await resp.blob();
        out[sku] = await new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.onerror = rej;
          fr.readAsDataURL(blob);
        });
      } catch {
        /* ignora esta foto */
      }
    })
  );
  return out;
}

function waitImage(img) {
  if (img.complete && img.naturalWidth > 0) return Promise.resolve();
  return new Promise((resolve) => {
    img.addEventListener("load", resolve, { once: true });
    img.addEventListener("error", resolve, { once: true });
  });
}

// Imprime o HTML do catálogo num iframe isolado (sem o CSS do app) e chama o
// diálogo de impressão do navegador — onde dá para "Salvar como PDF".
export function imprimirPortfolio(html) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0", visibility: "hidden",
  });
  document.body.appendChild(iframe);

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    setTimeout(() => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }, 500);
  };

  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  const imgs = Array.from(doc.images || []);
  Promise.all(imgs.map(waitImage)).then(() => {
    const win = iframe.contentWindow;
    requestAnimationFrame(() => {
      try {
        win.focus();
        win.onafterprint = cleanup;
        win.print();
      } catch {
        /* se o print falhar, ainda limpamos o iframe */
      }
      setTimeout(cleanup, 60000);
    });
  });
}
