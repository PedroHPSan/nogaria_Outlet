// Testes das funções PURAS do anúncio (anuncioTemplate.js). Rode: npm run test:anuncio
import assert from "node:assert/strict";
import {
  gerarAnuncioHTML, mensagemContato, nomeAnuncio,
  linhaOrcamento, mensagemOrcamento, totaisOrcamento,
  gerarOrcamentoHTML, sheetAnuncio, documentoAnuncio,
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

console.log("mensagemContato (QR da página do produto)");
eq(
  mensagemContato(base),
  `Furadeira — Cód: ${base.sku} — ${fmtBRL(289)}`,
  "com preço: nome + código + valor"
);
eq(
  mensagemContato({ ...base, preco_ideal: null }),
  `Furadeira — Cód: ${base.sku} — sob consulta`,
  "sem preço vira 'sob consulta'"
);
eq(
  mensagemContato({ ...base, sku: null }),
  `Furadeira — ${fmtBRL(289)}`,
  "sem SKU omite o trecho 'Cód: ...'"
);

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

console.log("sheetAnuncio / documentoAnuncio");
const folha = sheetAnuncio(base, {});
ok(folha.startsWith('<div class="sheet">'), "folha é só a div");
ok(!folha.includes("<!DOCTYPE"), "folha não traz o envelope");
ok(documentoAnuncio([folha], "T").includes("<!DOCTYPE html>"), "documento tem o envelope");
ok(documentoAnuncio([folha], "T").includes("<title>T</title>"), "documento usa o título");

console.log("gerarOrcamentoHTML");
const itensOrc = [
  { ...base, sku: "NOG-A", produto: "Furadeira" },
  { ...base, sku: "NOG-B", produto: "Parafusadeira" },
  { ...base, sku: "NOG-C", produto: "Serra" },
];
const orc = gerarOrcamentoHTML(itensOrc);
eq((orc.match(/<div class="sheet">/g) || []).length, 3, "uma folha por produto");
eq((orc.match(/<!DOCTYPE html>/g) || []).length, 1, "um único documento");
ok(orc.includes("page-break-after:always"), "CSS quebra página entre folhas");
ok(orc.includes(".sheet:last-child"), "última folha não força quebra");
ok(/\.sheet\{[^}]*height:297mm/.test(orc), "folha tem altura A4 fixa (não min-height)");
ok(/\.sheet\{[^}]*overflow:hidden/.test(orc), "folha corta o excedente (1 produto = 1 página)");

console.log("textos longos não empurram o conteúdo para fora da folha");
const longo = gerarAnuncioHTML({
  ...base,
  titulo_anuncio: "Furadeira de Impacto Profissional ".repeat(6),
  descricao_anuncio: "Descrição bem longa. ".repeat(60),
}, {});
ok(longo.includes('class="pname clamp"'), "nome usa clamp de linhas");
ok(longo.includes('class="pdesc clamp"'), "descrição usa clamp de linhas");
ok(/\.pdesc\{[^}]*-webkit-line-clamp/.test(longo), "CSS limita as linhas da descrição");
["NOG-A", "NOG-B", "NOG-C"].forEach((s) => ok(orc.includes(s), `inclui ${s}`));
ok(orc.includes("<title>Orçamento (3 itens)"), "título com a contagem (N itens)");

console.log("gerarOrcamentoHTML com 1 item: título é o do produto (sem 'Orçamento (1 itens)')");
const orcUm = gerarOrcamentoHTML([itensOrc[0]]);
ok(orcUm.includes(`<title>${nomeAnuncio(itensOrc[0])} — `), "título usa o nome do produto");
ok(!orcUm.includes("(1 itens)"), "não usa a contagem no singular");

console.log("gerarOrcamentoHTML usa as fotos/QR por SKU");
const orcFotos = gerarOrcamentoHTML(itensOrc.slice(0, 2), {
  porSku: {
    "NOG-A": { fotos: { principal: "data:image/png;base64,AAA", galeria: [] }, qrDataUrl: "data:image/png;base64,QQQ" },
  },
});
ok(orcFotos.includes("data:image/png;base64,AAA"), "foto do 1º item entra");
ok(orcFotos.includes("data:image/png;base64,QQQ"), "QR do 1º item entra");
ok(orcFotos.includes("SEM FOTO"), "2º item sem foto cai no placeholder");

console.log(`\n${passou} asserções OK`);
