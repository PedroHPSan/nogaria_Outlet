// Teste do pre-flight gate (preflight.js é JS puro). Rode: npm run test:preflight
import assert from "node:assert/strict";
import { gtinValido, bandaPreco, precoPublicavel, preflightAmazon } from "../src/lib/marketplace/preflight.js";
import { montarPayloadAmazon, condicaoAmazonListings } from "../src/lib/marketplace/amazonPayload.js";

let passou = 0;
const eq = (a, b, msg) => { assert.equal(a, b, msg); passou++; console.log(`  ok  ${msg}`); };

console.log("gtinValido");
eq(gtinValido("7891234567895").tipo, "EAN", "13 dígitos → EAN");
eq(gtinValido("012345678905").tipo, "UPC", "12 dígitos → UPC");
eq(gtinValido("17891234567892").tipo, "GTIN", "14 dígitos → GTIN");
eq(gtinValido("B07XJ8C8F5").tipo, "ASIN", "10 alfanum c/ letra → ASIN");
eq(gtinValido("1234567890").ok, false, "10 dígitos (sem letra) não é ASIN → inválido");
eq(gtinValido("123").ok, false, "curto → inválido");
eq(gtinValido(null).ok, false, "null → inválido");

console.log("\nbandaPreco");
eq(bandaPreco({ preco_ideal: 100, preco_ref_novo: 100 }).ok, true, "1× → dentro da banda");
eq(bandaPreco({ preco_ideal: 1000, preco_ref_novo: 100 }).ok, false, "10× → fora da banda (bloqueia)");
eq(bandaPreco({ preco_ideal: 20, preco_ref_novo: 100 }).ok, false, "0,2× → fora da banda (bloqueia)");
eq(bandaPreco({ preco_ideal: 100 }).ok, true, "sem referência → não bloqueia");
eq(bandaPreco({ preco_ideal: 100, preco_ref_novo: 250 }).ok, true, "0,4× → no limite inferior, ok");

console.log("\nprecoPublicavel");
eq(precoPublicavel({ preco_ideal: 50 }), true, "preco_ideal 50 → publicável");
eq(precoPublicavel({ preco_ideal: 0 }), false, "preco_ideal 0 → não");
eq(precoPublicavel({ preco_sugerido: 99 }), false, "só preco_sugerido → NÃO publicável (campo quebrado)");
eq(precoPublicavel({}), false, "sem preço → não");

console.log("\npreflightAmazon");
const bom = { preco_ideal: 120, preco_ref_novo: 150, gtin: "7891234567895", foto_feita: true, marca: "Mondial", estado: "Novo", quantidade: 1 };
eq(preflightAmazon(bom).ok, true, "item bom (preço+banda+gtin) → publica");
eq(preflightAmazon(bom).idProduto.tipo, "EAN", "idProduto = EAN do gtin");
eq(preflightAmazon({ ...bom, preco_ideal: null }).ok, false, "sem preco_ideal → bloqueia");
eq(preflightAmazon({ ...bom, gtin: "xx" }).ok, false, "gtin inválido → bloqueia");
eq(preflightAmazon({ ...bom, preco_ideal: 1500 }).ok, false, "10× a ref → banda bloqueia");
const semFoto = preflightAmazon({ ...bom, foto_feita: false });
eq(semFoto.ok, true, "sem foto → NÃO bloqueia (só aviso)");
eq(semFoto.checks.find((c) => c.id === "foto").ok, false, "check de foto marca aviso");

console.log("\nmontarPayloadAmazon (modo oferta)");
const pf = preflightAmazon(bom);
const pay = montarPayloadAmazon(bom, pf.idProduto);
eq(pay.requirements, "LISTING_OFFER_ONLY", "requirements = LISTING_OFFER_ONLY");
eq(pay.attributes.purchasable_offer[0].our_price[0].schedule[0].value_with_tax, 120, "preço do payload = preco_ideal (120), nunca fallback");
eq(pay.attributes.purchasable_offer[0].currency, "BRL", "moeda BRL");
eq(pay.attributes.fulfillment_availability[0].fulfillment_channel_code, "DEFAULT", "fulfillment DEFAULT (merchant)");
eq(pay.attributes.externally_assigned_product_identifier[0].type, "ean", "EAN vira externally_assigned (type ean)");
eq(pay.attributes.condition_type[0].value, "new_new", "estado Novo → condition new_new");
// ASIN usa merchant_suggested_asin
const payAsin = montarPayloadAmazon(bom, { tipo: "ASIN", valor: "B07XJ8C8F5" });
eq(payAsin.attributes.merchant_suggested_asin[0].value, "B07XJ8C8F5", "ASIN → merchant_suggested_asin");
eq(condicaoAmazonListings("Novo", "LEVE"), "used_like_new", "Novo + caixa avariada → used_like_new");
eq(condicaoAmazonListings("Usado"), "used_good", "Usado → used_good");

console.log(`\n${passou} asserções OK`);
