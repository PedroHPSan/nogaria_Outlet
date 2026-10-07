// Copia para public/bg-model apenas o modelo (isnet_quint8 = "small") e os .wasm do
// onnxruntime usados pelo editor de foto, para o app servir tudo do próprio domínio
// (sem CDN externa em runtime). Roda em predev/prebuild; public/bg-model é ignorado pelo git.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";

const origem = "node_modules/@imgly/background-removal-data/dist";
const destino = "public/bg-model";
// [chave no pacote -data, chave pedida pela lib]. "small" = isnet_quint8 (mapeamento da lib).
const manter = [
  ["/models/small", "/models/isnet_quint8"],
];
// Runtime do onnxruntime: vem do onnxruntime-web instalado (mesma versão que a lib usa),
// pois o pacote -data 1.4.x é mais antigo e não traz os loaders .mjs.
const ort = "node_modules/onnxruntime-web/dist";
const ortArquivos = [
  ["ort-wasm-simd-threaded.mjs", "text/javascript"],
  ["ort-wasm-simd-threaded.wasm", "application/wasm"],
];

if (!existsSync(`${origem}/resources.json`)) {
  console.error("Falta @imgly/background-removal-data (npm i -D @imgly/background-removal-data).");
  process.exit(1);
}
const todos = JSON.parse(readFileSync(`${origem}/resources.json`, "utf8"));
const recorte = {};
rmSync(destino, { recursive: true, force: true });
mkdirSync(destino, { recursive: true });
for (const [chave, alvo] of manter) {
  if (!todos[chave]) { console.error(`Recurso ausente: ${chave}`); process.exit(1); }
  // a lib 1.7 lê chunk.name; o pacote -data 1.4.x só traz hash (que é o nome do arquivo)
  recorte[alvo] = { ...todos[chave], chunks: todos[chave].chunks.map((c) => ({ ...c, name: c.hash })) };
  for (const c of todos[chave].chunks) cpSync(`${origem}/${c.hash}`, `${destino}/${c.hash}`);
}
for (const [arq, mime] of ortArquivos) {
  const tam = statSync(`${ort}/${arq}`).size;
  cpSync(`${ort}/${arq}`, `${destino}/${arq}`);
  recorte[`/onnxruntime-web/${arq}`] = { chunks: [{ hash: arq, name: arq, offsets: [0, tam] }], size: tam, mime };
}
writeFileSync(`${destino}/resources.json`, JSON.stringify(recorte));
console.log(`bg-model: ${Object.keys(recorte).length} recursos copiados`);
