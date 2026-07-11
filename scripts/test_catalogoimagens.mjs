// Teste do núcleo puro de imagens do catálogo. Rode: npm run test:catalogoimagens
import assert from "node:assert/strict";
import { dimensionarAlvo, MAX_LADO, JPEG_QUALITY } from "../src/lib/catalogoImagensCore.js";

let passou = 0;
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); passou++; console.log(`  ok  ${msg}`); };
const ok = (c, msg) => { assert.ok(c, msg); passou++; console.log(`  ok  ${msg}`); };

console.log("constantes de compressão");
ok(MAX_LADO === 1000, "MAX_LADO = 1000");
ok(JPEG_QUALITY > 0 && JPEG_QUALITY < 1, "JPEG_QUALITY entre 0 e 1");

console.log("\ndimensionarAlvo mantém proporção e limita o lado maior");
eq(dimensionarAlvo(2000, 1000, 1000), { w: 1000, h: 500 }, "paisagem 2000x1000 → 1000x500");
eq(dimensionarAlvo(1000, 2000, 1000), { w: 500, h: 1000 }, "retrato 1000x2000 → 500x1000");
eq(dimensionarAlvo(800, 600, 1000), { w: 800, h: 600 }, "menor que o alvo não amplia");
eq(dimensionarAlvo(3000, 3000, 1000), { w: 1000, h: 1000 }, "quadrado grande → 1000x1000");

console.log(`\n${passou} asserções OK`);
