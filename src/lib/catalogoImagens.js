// Prepara as fotos do catálogo para embutir no PDF, fora da thread principal.
// Sobe um Web Worker que baixa/redimensiona/comprime cada foto e reporta progresso.
// Fallback (sem Worker/OffscreenCanvas): comprime no main-thread em canvas comum,
// cedendo o event loop entre fotos para não travar a UI.
import { dimensionarAlvo, MAX_LADO, JPEG_QUALITY } from "./catalogoImagensCore.js";

const temWorker = typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";

// entradas: [{ sku, url }]. opts: { onProgress?({feitas,total}), signal?: AbortSignal }.
// Retorna { [sku]: dataURI }. Se signal abortar, rejeita com Error("cancelado").
export function prepararFotos(entradas, { onProgress, signal } = {}) {
  const lista = (entradas || []).filter((e) => e && e.url);
  if (!lista.length) return Promise.resolve({});
  return temWorker ? viaWorker(lista, onProgress, signal) : viaFallback(lista, onProgress, signal);
}

function viaWorker(lista, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./catalogoWorker.js", import.meta.url), { type: "module" });
    const onAbort = () => { worker.terminate(); reject(new Error("cancelado")); };
    if (signal) {
      if (signal.aborted) { worker.terminate(); return reject(new Error("cancelado")); }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.tipo === "progresso") onProgress?.({ feitas: m.feitas, total: m.total });
      else if (m.tipo === "fim") {
        signal?.removeEventListener("abort", onAbort);
        worker.terminate();
        resolve(m.fotos);
      }
    };
    worker.onerror = () => { signal?.removeEventListener("abort", onAbort); worker.terminate(); reject(new Error("worker falhou")); };
    worker.postMessage({ entradas: lista });
  });
}

async function comprimirMain(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("fetch falhou");
  const bmp = await createImageBitmap(await resp.blob());
  const { w, h } = dimensionarAlvo(bmp.width, bmp.height, MAX_LADO);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

async function viaFallback(lista, onProgress, signal) {
  const fotos = {};
  let feitas = 0;
  for (const { sku, url } of lista) {
    if (signal?.aborted) throw new Error("cancelado");
    try { fotos[sku] = await comprimirMain(url); } catch { /* omite */ }
    feitas++;
    onProgress?.({ feitas, total: lista.length });
    await new Promise((r) => setTimeout(r, 0)); // cede o event loop
  }
  return fotos;
}
