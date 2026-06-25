// Teste das funções puras do catálogo (catalogo.js). Rode: npm run test:catalogo
// Garante que o catálogo usa o PREÇO DE VENDA REAL (preco_ideal), nunca o legado
// preco_sugerido, e que as condições reais têm selo.
import assert from "node:assert/strict";
import {
  dedupCatalogo, agruparCatalogo, CATALOGO_ESTADO_BADGE, CATALOGO_STATUS_EXCLUIR,
} from "../src/lib/catalogoCore.js";

let passou = 0;
const eq = (a, b, msg) => { assert.equal(a, b, msg); passou++; console.log(`  ok  ${msg}`); };
const ok = (c, msg) => { assert.ok(c, msg); passou++; console.log(`  ok  ${msg}`); };

const item = (o) => ({ produto: "Furadeira", marca: "Bosch", modelo: "GSB", cor: "Azul", tamanho: null, estado: "Novo", grupo: "Ferramentas", ...o });

console.log("dedup usa preco_ideal (não preco_sugerido)");
// Dois itens idênticos com o MESMO preco_ideal mas preco_sugerido DIFERENTE → 1 card qtd 2.
const cards1 = dedupCatalogo([
  item({ sku: "A1", preco_ideal: 100, preco_sugerido: 999 }),
  item({ sku: "A2", preco_ideal: 100, preco_sugerido: 111 }),
]);
eq(cards1.length, 1, "mesmo preco_ideal → 1 card (preco_sugerido ignorado na chave)");
eq(cards1[0].qtd, 2, "qtd = 2");
eq(cards1[0].skus.length, 2, "2 SKUs no card");

// preco_ideal diferente → cards diferentes, ordenados desc por preco_ideal.
const cards2 = dedupCatalogo([
  item({ sku: "B1", preco_ideal: 50 }),
  item({ sku: "B2", preco_ideal: 200, cor: "Preto" }),
]);
eq(cards2.length, 2, "preco_ideal diferente → 2 cards");
eq(cards2[0].rep.sku, "B2", "ordena por preco_ideal desc (200 antes de 50)");

console.log("\nagrupamento ordena seções por Σ preco_ideal×qtd");
const secoes = agruparCatalogo(
  dedupCatalogo([
    item({ sku: "C1", grupo: "Áudio", preco_ideal: 500 }),
    item({ sku: "C2", grupo: "Ferramentas", preco_ideal: 30 }),
  ]),
  "categoria"
);
eq(secoes[0].chave, "Áudio", "categoria de maior valor vem primeiro");
eq(secoes[0].valorTotal, 500, "valorTotal usa preco_ideal");

console.log("\nselos de condição cobrem as condições reais");
["Novo", "Embalagem aberta/avariada", "Usado", "Usado funcionando", "Usado sem teste", "Avariado"]
  .forEach((e) => ok(CATALOGO_ESTADO_BADGE[e], `condição "${e}" tem selo`));
eq(CATALOGO_ESTADO_BADGE["Avariado"].cls, "asis", 'Avariado → "Como está"');

console.log("\nstatus terminais excluídos do catálogo");
["VENDIDO", "DESCARTE", "ENTREGUE"].forEach((s) => ok(CATALOGO_STATUS_EXCLUIR.includes(s), `${s} excluído`));

console.log(`\n${passou} asserções OK`);
