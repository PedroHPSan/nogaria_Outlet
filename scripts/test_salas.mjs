// Testes das funções PURAS de salas (salasFormat.js). Rode: npm run test:salas
import assert from "node:assert/strict";
import { parseCodigoLido, salaLabelTexto } from "../src/lib/salasFormat.js";

let passou = 0;
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); passou++; console.log(`  ok  ${msg}`); };

console.log("parseCodigoLido");
eq(parseCodigoLido("SALA-001"), { tipo: "SALA", codigo: "SALA-001" }, "prefixo SALA → tipo SALA");
eq(parseCodigoLido("cx-012"), { tipo: "CAIXA", codigo: "CX-012" }, "CX → CAIXA, uppercase");
eq(parseCodigoLido("MALA-003"), { tipo: "CAIXA", codigo: "MALA-003" }, "MALA → CAIXA");
eq(parseCodigoLido("NOG-126-001"), { tipo: "ITEM", codigo: "NOG-126-001" }, "SKU → ITEM");
eq(parseCodigoLido("https://x/?item=NOG-9"), { tipo: "ITEM", codigo: "NOG-9" }, "deep-link ?item extrai SKU");
eq(parseCodigoLido("  sala-007?x=1 "), { tipo: "SALA", codigo: "SALA-007?X=1" }, "sem deep-link conhecido, normaliza cru");
eq(parseCodigoLido(""), { tipo: null, codigo: "" }, "vazio → tipo null");
eq(parseCodigoLido(null), { tipo: null, codigo: "" }, "null → tipo null");

console.log("salaLabelTexto");
eq(salaLabelTexto({ codigo: "SALA-001", nome: "Galpão A" }), "SALA-001 · Galpão A", "código + nome");
eq(salaLabelTexto({ codigo: "SALA-002", nome: "" }), "SALA-002", "sem nome → só código");
eq(salaLabelTexto(null), "—", "null → travessão");
eq(salaLabelTexto({ nome: "X" }), "—", "sem código → travessão");

console.log(`\n${passou} asserções OK`);
