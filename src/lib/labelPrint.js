// Impressão de etiquetas térmicas (Brother QL-800) via IFRAME isolado.
//
// Por que iframe e não window.print()?
// O modal de etiquetas é position:fixed com overflow:auto. Imprimir o próprio
// documento dependia de esconder o app (visibility:hidden) e posicionar a área
// de impressão de forma absoluta. No macOS/Safari isso quebra: quebras de
// página são ignoradas dentro de elementos position:absolute (todas as
// etiquetas se sobrepõem / só a 1ª sai) e o overflow:auto corta o conteúdo na
// primeira página — resultando em erro no driver da QL-800.
//
// Renderizando as etiquetas em um documento próprio (iframe), com @page e
// page-break corretos e SEM o CSS do app, a impressão fica isolada e idêntica
// no Mac e no Windows. O LabelCard usa estilos inline em mm, então o layout é
// preservado sem precisar do Tailwind.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LabelCard from "../components/labels/LabelCard";

// Espera uma <img> (QR em data URL) terminar de carregar dentro do iframe.
function waitImage(img) {
  if (img.complete && img.naturalWidth > 0) return Promise.resolve();
  return new Promise((resolve) => {
    img.addEventListener("load", resolve, { once: true });
    img.addEventListener("error", resolve, { once: true });
  });
}

export function printLabels(labels, preset) {
  if (!labels?.length || !preset) return;

  const cards = labels
    .map((label) =>
      renderToStaticMarkup(React.createElement(LabelCard, { label, preset }))
    )
    .join("");

  const css = `
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; background: #fff; }
    /* Tamanho físico da mídia DK + sem margem: o driver da QL-800 corta entre páginas. */
    @page { size: ${preset.width}mm ${preset.height}mm; margin: 0; }
    /* Uma etiqueta por página. */
    .label-page {
      break-after: page;
      page-break-after: always;
      break-inside: avoid;
      page-break-inside: avoid;
      overflow: hidden;
    }
    .label-page:last-child { break-after: auto; page-break-after: auto; }
    img { image-rendering: pixelated; }
  `;

  const html =
    `<!DOCTYPE html><html><head><meta charset="utf-8">` +
    `<title>Etiquetas NOGÁRIA</title><style>${css}</style></head>` +
    `<body>${cards}</body></html>`;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "0",
    height: "0",
    border: "0",
    visibility: "hidden",
  });
  document.body.appendChild(iframe);

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    // Pequeno atraso para o Safari finalizar o diálogo antes de remover o nó.
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 500);
  };

  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  const imgs = Array.from(doc.images || []);
  Promise.all(imgs.map(waitImage)).then(() => {
    const win = iframe.contentWindow;
    // rAF garante que o layout (em mm) foi calculado antes de imprimir — Safari.
    requestAnimationFrame(() => {
      try {
        win.focus();
        win.onafterprint = cleanup;
        win.print();
      } catch {
        /* se o print falhar, ainda limpamos o iframe */
      }
      // Fallback: alguns navegadores (Safari antigo) não disparam onafterprint.
      setTimeout(cleanup, 60000);
    });
  });
}
