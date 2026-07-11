// Teste das funções puras do catálogo público. Rode: npm run test:catalogopublico
import assert from "node:assert/strict";
import { montarPayload, slugDeBytes } from "../src/lib/catalogoPublico.js";

let passou = 0;
const eq = (a, b, msg) => { assert.equal(a, b, msg); passou++; console.log(`  ok  ${msg}`); };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); passou++; console.log(`  ok  ${msg}`); };
const ok = (c, msg) => { assert.ok(c, msg); passou++; console.log(`  ok  ${msg}`); };

// Uma seção como a que agruparCatalogo produz (card = { rep, qtd, skus }).
const secoes = [{
  titulo: "Ferramentas",
  cards: [
    { rep: { sku: "A1", produto: "Furadeira", marca: "Bosch", cor: "Azul", estado: "Novo", preco_ideal: 200 }, qtd: 2, skus: ["A1", "A2"] },
    { rep: { sku: "B1", produto: "Serra", marca: "Makita", cor: "", estado: "Usado", preco_ideal: 150 }, qtd: 1, skus: ["B1"] },
  ],
}];
const fotosUrl = { A1: "https://x/a1.jpg" }; // B1 sem foto

console.log("montarPayload — estrutura e preço visível");
const pv = montarPayload(secoes, { titulo: "Cat", edicao: "Jul/2026", subtitulo: "Ferramentas", mostrarPreco: true }, fotosUrl);
eq(pv.versao, 1, "versao = 1");
eq(pv.titulo, "Cat", "titulo preservado");
eq(pv.mostrarPreco, true, "mostrarPreco true");
eq(pv.totalItens, 3, "totalItens = Σ qtd (2 + 1)");
eq(pv.secoes[0].cards[0].preco, 200, "card com preço (mostrarPreco true)");
eq(pv.secoes[0].cards[0].foto, "https://x/a1.jpg", "foto do rep incluída");
eq(pv.secoes[0].cards[0].qtd, 2, "qtd preservada");
eq(pv.secoes[0].cards[0].badge.txt, "Novo", "selo de condição resolvido");
eq(pv.secoes[0].cards[1].foto, null, "card sem foto → null");

console.log("\nmontarPayload — preço oculto zera preços");
const po = montarPayload(secoes, { mostrarPreco: false }, fotosUrl);
eq(po.secoes[0].cards[0].preco, null, "preço null quando mostrarPreco false");

console.log("\nslugDeBytes — url-safe e determinístico");
const s = slugDeBytes(new Uint8Array([0, 1, 255, 16, 200, 7]));
ok(/^[0-9a-z]+$/.test(s), "slug só tem [0-9a-z]");
eq(s, slugDeBytes(new Uint8Array([0, 1, 255, 16, 200, 7])), "determinístico p/ mesmos bytes");

console.log(`\n${passou} asserções OK`);
