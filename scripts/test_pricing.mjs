// Teste do motor de precificação (pricing.js é JS puro, sem dependências).
// Rode: node scripts/test_pricing.mjs   (ou: npm run test:pricing)
import assert from "node:assert/strict";
import { precificar, estadoToCondicao } from "../src/lib/pricing.js";
import { precoVenda } from "../src/lib/export.js";

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

console.log("\nPrecificação de 2 eixos: produto novo × condição da embalagem");

// NOG-100-009 Escova Hot Air 9em1: refNovo=150, NOVO_LACRADO, caixa LEVE, risco MEDIO.
// 150 × 0.85 (produto novo) × 0.97 (caixa leve) × 0.90 (risco) ≈ 111,38.
const styler = precificar({
  condicaoCod: "NOVO_LACRADO", embalagemCod: "LEVE", canalCod: "SHOPEE",
  riscoNivel: "MEDIO", destino: "Belém", pesoKg: 1, refNovo: 150, custoItem: 47.61,
});
near(styler.pAnuncio, 111.38, 0.5, "Styler novo + caixa leve ≈ 111 (não ~83 do modelo antigo)");

// A caixa é eixo PEQUENO: novo com caixa leve fica ~3% abaixo do novo perfeito,
// não na faixa de usado (o modelo antigo derrubava p/ ~0,55× via NOVO_CAIXA_AVARIADA).
const perfeita = precificar({
  condicaoCod: "NOVO_LACRADO", embalagemCod: "PERFEITA", canalCod: "SHOPEE",
  riscoNivel: "MEDIO", destino: "Belém", pesoKg: 1, refNovo: 150,
});
near(styler.pAnuncio / perfeita.pAnuncio, 0.97, 0.005, "Caixa leve corta ~3% (eixo pequeno)");

// "Embalagem aberta/avariada" deixou de virar condição de produto: usa NOVO_LACRADO.
eq(estadoToCondicao("Embalagem aberta/avariada"), "NOVO_LACRADO",
  "estado 'Embalagem aberta/avariada' → NOVO_LACRADO (eixo embalagem trata a caixa)");

// Sem embalagemCod (chamadas legadas / itens sem o eixo): fator = 1, não muda nada.
const semEmb = precificar({
  condicaoCod: "USADO_OK", canalCod: "LOCAL", riscoNivel: "BAIXO",
  destino: "Venda local SP", pesoKg: 0, refNovo: 900,
});
near(semEmb.pAnuncio, 471.96, 0.01, "Sem embalagemCod: fator embalagem neutro (=1)");

console.log("\nprecoVenda (export): só preco_ideal, sem fallback quebrado");
eq(precoVenda({ preco_ideal: 150 }), 150, "com preco_ideal → usa ele");
eq(precoVenda({ preco_sugerido: 99 }), null, "só preco_sugerido → null (não usa o campo quebrado)");
eq(precoVenda({ preco_min: 80, preco_novo_est: 200 }), null, "só preco_min/novo_est → null");
eq(precoVenda({ preco_ideal: 0 }), null, "preco_ideal 0 → null");

console.log(`\n${passou} asserções OK`);
