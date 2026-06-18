// Teste do motor de precificação (pricing.js é JS puro, sem dependências).
// Rode: node scripts/test_pricing.mjs   (ou: npm run test:pricing)
import assert from "node:assert/strict";
import { precificar } from "../src/lib/pricing.js";

let passou = 0;
const eq = (a, b, msg) => { assert.equal(a, b, msg); passou++; console.log(`  ok  ${msg}`); };
const near = (a, b, tol, msg) => { assert.ok(Math.abs(a - b) <= tol, `${msg} (got ${a}, esperado ~${b})`); passou++; console.log(`  ok  ${msg}`); };

console.log("Cenário base: ferramenta refNovo=900, USADO_OK, risco BAIXO, custoItem=168.88");

// P_anúncio independe do canal: 900*0.60 (conv) *0.92 (cond) *0.95 (risco) = 471.96
const local = precificar({
  condicaoCod: "USADO_OK", canalCod: "LOCAL", riscoNivel: "BAIXO",
  destino: "Venda local SP", pesoKg: 0, refNovo: 900, custoItem: 168.88,
});
near(local.pAnuncio, 471.96, 0.01, "LOCAL/SP: pAnuncio ≈ 471,96");
eq(local.viavel, true, "LOCAL/SP: viável = true");

// ML em Belém: take 14% + R$6,75, frete mín 15, margem Belém 50% -> piso alto, inviável
const mlBelem = precificar({
  condicaoCod: "USADO_OK", canalCod: "ML", riscoNivel: "BAIXO",
  destino: "Belém", pesoKg: 0, refNovo: 900, custoItem: 168.88,
});
near(mlBelem.pAnuncio, 471.96, 0.01, "ML/Belém: pAnuncio ≈ 471,96 (mesmo teto)");
eq(mlBelem.viavel, false, "ML/Belém: viável = false");

console.log(`\n${passou} asserções OK`);
