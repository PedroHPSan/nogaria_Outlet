// Testes das funções PURAS de caixas (caixasFormat.js). Rode: npm run test:caixas
import assert from "node:assert/strict";
import { formatDataBR, chegadaDetalhe } from "../src/lib/caixasFormat.js";

let passou = 0;
const eq = (a, b, msg) => { assert.equal(a, b, msg); passou++; console.log(`  ok  ${msg}`); };

console.log("formatDataBR");
eq(formatDataBR("2026-07-08"), "08/07/2026", "converte YYYY-MM-DD sem escorregar de fuso");
eq(formatDataBR("2026-07-08T12:00:00Z"), "08/07/2026", "aceita ISO com hora");
eq(formatDataBR(""), "", "vazio → string vazia");
eq(formatDataBR(null), "", "null → string vazia");

console.log("chegadaDetalhe");
eq(chegadaDetalhe("2026-07-08", "Galpão A"), "Belém · 08/07/2026 · Galpão A", "monta detalhe completo");
eq(chegadaDetalhe("2026-07-08", ""), "Belém · 08/07/2026", "sem local, omite o local");
eq(chegadaDetalhe("2026-07-08", null), "Belém · 08/07/2026", "local null é omitido");
eq(chegadaDetalhe("", "Galpão A"), "Belém · Galpão A", "sem data, omite a data");

console.log(`\n${passou} asserções OK`);
