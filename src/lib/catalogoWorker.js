// Web Worker: baixa cada foto, redimensiona (OffscreenCanvas) e re-encoda em JPEG
// comprimido → dataURI base64. Emite progresso a cada foto. Best-effort: foto que
// falhar é omitida. Roda fora da thread principal (não trava a UI).
import { dimensionarAlvo, MAX_LADO, JPEG_QUALITY } from "./catalogoImagensCore.js";

async function blobParaDataURI(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return `data:image/jpeg;base64,${btoa(bin)}`;
}

async function comprimir(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("fetch falhou");
  const bmp = await createImageBitmap(await resp.blob());
  const { w, h } = dimensionarAlvo(bmp.width, bmp.height, MAX_LADO);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const out = await canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
  return blobParaDataURI(out);
}

self.onmessage = async (e) => {
  const { entradas } = e.data; // [{ sku, url }]
  const total = entradas.length;
  const fotos = {};
  let feitas = 0;
  for (const { sku, url } of entradas) {
    try {
      fotos[sku] = await comprimir(url);
    } catch {
      /* omite esta foto */
    }
    feitas++;
    self.postMessage({ tipo: "progresso", feitas, total });
  }
  self.postMessage({ tipo: "fim", fotos });
};
