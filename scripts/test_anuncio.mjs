// Testes das funções PURAS do anúncio (anuncioTemplate.js). Rode: npm run test:anuncio
import assert from "node:assert/strict";
import {
  gerarAnuncioHTML, mensagemWhatsApp, nomeAnuncio,
  linhaOrcamento, mensagemOrcamento, totaisOrcamento,
} from "../src/lib/anuncioTemplate.js";
import { fmtBRL } from "../src/lib/model.js";

let passou = 0;
const ok = (c, msg) => { assert.ok(c, msg); passou++; console.log(`  ok  ${msg}`); };
const eq = (a, b, msg) => { assert.equal(a, b, msg); passou++; console.log(`  ok  ${msg}`); };

const base = {
  sku: "NOG-001-002", produto: "Furadeira", marca: "Bosch", modelo: "GSB 13 RE",
  cor: "Azul", estado: "Novo", preco_ideal: 289, voltagem: "220V",
};

console.log("nomeAnuncio prefere titulo_anuncio");
eq(nomeAnuncio({ produto: "Furadeira", titulo_anuncio: "Furadeira de Impacto 750W" }), "Furadeira de Impacto 750W", "usa titulo_anuncio");
eq(nomeAnuncio({ produto: "Furadeira" }), "Furadeira", "cai no produto");

console.log("gerarAnuncioHTML com preço");
const html = gerarAnuncioHTML(base, {});
ok(html.includes("Furadeira"), "inclui o nome");
ok(html.includes("R$"), "inclui preço formatado");
ok(html.includes("NOG-001-002"), "inclui SKU");
ok(html.includes("PREÇO À VISTA"), "mostra a faixa de preço à vista");

console.log("sem preço → sob consulta");
const semPreco = gerarAnuncioHTML({ ...base, preco_ideal: null }, {});
ok(!semPreco.includes("PREÇO À VISTA"), "esconde faixa de preço à vista");
ok(semPreco.includes("Sob consulta"), "mostra 'Sob consulta'");

console.log("escapa HTML de texto do usuário");
const xss = gerarAnuncioHTML({ ...base, produto: "<script>x</script>", titulo_anuncio: null }, {});
ok(!xss.includes("<script>x"), "escapa < do produto");

console.log("linhaOrcamento");
eq(linhaOrcamento(base), `Furadeira — ${fmtBRL(289)}`, "linha = nome + valor");
eq(
  linhaOrcamento({ ...base, preco_ideal: null }),
  "Furadeira — sob consulta",
  "sem preço vira 'sob consulta'"
);
eq(
  linhaOrcamento({ ...base, titulo_anuncio: "Furadeira de Impacto 750W" }),
  `Furadeira de Impacto 750W — ${fmtBRL(289)}`,
  "usa titulo_anuncio quando existe"
);

console.log("mensagemWhatsApp é só a linha");
const msg = mensagemWhatsApp(base);
eq(msg, linhaOrcamento(base), "mensagem única = linha do item");
eq(msg.split("\n").length, 1, "exatamente uma linha");
ok(!/Ol[áa]/i.test(msg), "sem saudação");
ok(!msg.includes("Cód"), "sem linha de código");
ok(!/dispon[íi]vel/i.test(msg), "sem pergunta final");
ok(!msg.includes("Nogária"), "sem nome da empresa");

console.log("mensagemOrcamento");
const tres = [
  { ...base, sku: "A", produto: "Furadeira", preco_ideal: 289 },
  { ...base, sku: "B", produto: "Parafusadeira", preco_ideal: 150 },
  { ...base, sku: "C", produto: "Serra", preco_ideal: 61 },
];
const msgTres = mensagemOrcamento(tres);
const linhasTres = msgTres.split("\n").filter((l) => l.trim() !== "");
eq(linhasTres.length, 4, "3 linhas de produto + 1 de total");
ok(linhasTres[0].startsWith("Furadeira — "), "1ª linha é o 1º produto");
eq(linhasTres[3], `Total: ${fmtBRL(500)}`, "total soma os três");

eq(mensagemOrcamento([base]), linhaOrcamento(base), "um item só: sem linha de total");

const comSemPreco = mensagemOrcamento([tres[0], { ...tres[1], preco_ideal: null }]);
ok(comSemPreco.includes("Parafusadeira — sob consulta"), "linha sob consulta");
ok(
  comSemPreco.includes(`Total: ${fmtBRL(289)} (+ itens sob consulta)`),
  "total ignora sem preço e sinaliza"
);

eq(
  mensagemOrcamento([{ ...tres[0], preco_ideal: null }, { ...tres[1], preco_ideal: null }]),
  "Furadeira — sob consulta\nParafusadeira — sob consulta",
  "nenhum item com preço: sem linha de total"
);

console.log("totaisOrcamento");
const tot = totaisOrcamento([
  { sku: "A", preco_ideal: 100, foto_feita: true },
  { sku: "B", preco_ideal: null, foto_feita: true },
  { sku: "C", preco_ideal: 50, foto_feita: false },
]);
eq(tot.total, 150, "soma só quem tem preço");
eq(tot.semPreco.join(","), "B", "lista SKUs sem preço");
eq(tot.semFoto.join(","), "C", "lista SKUs sem foto");

console.log(`\n${passou} asserções OK`);
