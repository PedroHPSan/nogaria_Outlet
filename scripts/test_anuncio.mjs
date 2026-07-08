// Testes das funções PURAS do anúncio (anuncioTemplate.js). Rode: npm run test:anuncio
import assert from "node:assert/strict";
import { gerarAnuncioHTML, mensagemWhatsApp, nomeAnuncio } from "../src/lib/anuncioTemplate.js";

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

console.log("mensagemWhatsApp");
const msg = mensagemWhatsApp(base);
ok(msg.includes("Furadeira"), "mensagem tem o nome");
ok(msg.includes("R$"), "mensagem tem preço");

console.log(`\n${passou} asserções OK`);
