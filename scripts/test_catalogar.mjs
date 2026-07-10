// Testes das funções PURAS de catalogação (catalogarStats.js). Rode: npm run test:catalogar
import assert from "node:assert/strict";
import { tallyPorLote } from "../src/lib/catalogarStats.js";

let passou = 0;
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); passou++; console.log(`  ok  ${msg}`); };

console.log("agrupa por lote e conta (count desc)");
eq(
  tallyPorLote([{ lote: 10 }, { lote: 10 }, { lote: 12 }]),
  [{ lote: 10, count: 2 }, { lote: 12, count: 1 }],
  "agrupa e ordena por count desc"
);

console.log("empate de count → lote asc");
eq(
  tallyPorLote([{ lote: 12 }, { lote: 5 }]),
  [{ lote: 5, count: 1 }, { lote: 12, count: 1 }],
  "empate ordena por lote asc"
);

console.log("lote nulo vira bucket 'sem lote'");
eq(
  tallyPorLote([{ lote: null }, { lote: null }, { lote: 7 }]),
  [{ lote: null, count: 2 }, { lote: 7, count: 1 }],
  "null agrupa junto e segue a ordenação por count"
);

console.log("empate com null → null por último");
eq(
  tallyPorLote([{ lote: null }, { lote: 3 }]),
  [{ lote: 3, count: 1 }, { lote: null, count: 1 }],
  "no empate, o bucket sem lote fica por último"
);

console.log(`\n${passou} asserções OK`);
