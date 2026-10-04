// Teste dos textos de divulgação e do layout dos cards. Rode: npm run test:divulgacao
import assert from "node:assert/strict";
import { neutralizarFormula, hashtagDe, hashtagsPara, textoWhatsApp, textoInstagram, csvCatalogo, legendaCard, LIMITE_LEGENDA_IG, LIMITE_HASHTAGS_IG } from "../src/lib/divulgacao.js";
import { FORMATOS, cardProduto, montarCarrossel } from "../src/lib/cardCore.js";

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; console.log(`  ok  ${m}`); };
const ok = (c, m) => { assert.ok(c, m); n++; console.log(`  ok  ${m}`); };
const it = (i, o = {}) => ({ sku: `NOG${i}`, produto: `Produto ${i}`, estado: "Novo", grupo: "Sala de estar", preco_ideal: 100 * i, marca: "M", modelo: "X", ...o });

console.log("hashtags");
eq(hashtagDe("Sala de estar"), "#salaDeEstar", "camelCase sem espaços");
eq(hashtagDe("Calçados & Acessórios"), "#calcadosAcessorios", "sem acento nem símbolo");
eq(hashtagDe("   "), "", "vazio → vazio");
const tags = hashtagsPara(Array.from({ length: 80 }, (_, i) => `Grupo ${i}`), { max: 99 });
ok(tags.length <= LIMITE_HASHTAGS_IG, "nunca passa de 30 hashtags");
ok(hashtagsPara(["Sala"]).includes("#nogaria") && hashtagsPara(["Sala"]).includes("#sala"), "base + grupo");

console.log("WhatsApp");
const itens = Array.from({ length: 40 }, (_, i) => it(i + 1));
const w = textoWhatsApp(itens, { titulo: "Ofertas", link: "https://x/c/abc", validade: "15/10", contato: "+55 91 98392-9085" });
ok(w.includes("*Ofertas*") && w.includes("https://x/c/abc") && w.includes("15/10") && w.includes("98392-9085"), "título, link, validade e contato");
eq((w.match(/^•/gm) || []).length, 30, "máx. 30 itens");
ok(w.includes("+ 10 item(ns)"), "informa o excedente");
ok(!textoWhatsApp([it(1)], { mostrarPreco: false }).includes("R$"), "sem preço quando oculto");
ok(textoWhatsApp([it(1, { preco_ideal: null })]).includes("sob consulta"), "sem preço → sob consulta");

console.log("Instagram");
const ig = textoInstagram(itens, { titulo: "Lançamento", contato: "+55 91 98392-9085", destaques: 3 });
ok(ig.length <= LIMITE_LEGENDA_IG, "legenda ≤ 2.200");
ok((ig.match(/#\w+/g) || []).length <= LIMITE_HASHTAGS_IG, "hashtags ≤ 30");
ok(ig.includes("…e mais 37 peças!"), "resto resumido");
ok(!ig.includes("*"), "sem markdown de WhatsApp no Instagram");
const longo = textoInstagram(Array.from({ length: 5 }, (_, i) => it(i, { produto: "x".repeat(900) })), { destaques: 5 });
ok(longo.length <= LIMITE_LEGENDA_IG, "legenda enorme é truncada em 2.200");
ok(longo.includes("#nogaria"), "hashtags preservadas ao truncar");

console.log("CSV e legenda");
const csv = csvCatalogo([it(1, { produto: 'Mesa "A", grande' })], { linkDe: (x) => `https://x/${x.sku}` });
ok(csv.startsWith("\uFEFFnome,preco,descricao,codigo,link"), "BOM + cabeçalho");
ok(csv.includes('"Mesa ""A"", grande"'), "aspas escapadas");
ok(csv.includes("100.00") && csv.includes("https://x/NOG1"), "preço e link");
ok(legendaCard(it(1)).includes("NOG1"), "legenda do card cita SKU");
eq(neutralizarFormula("=HYPERLINK(\"http://x\")"), "'=HYPERLINK(\"http://x\")", "= vira texto");
eq(neutralizarFormula("+55 91"), "'+55 91", "+ vira texto");
eq(neutralizarFormula("@cmd"), "'@cmd", "@ vira texto");
eq(neutralizarFormula("Mesa"), "Mesa", "texto normal intacto");
const evil = csvCatalogo([it(1, { produto: "=1+1", marca: "-cmd" })]);
ok(evil.includes("'=1+1") && !/(^|,)=1\+1/m.test(evil), "nome malicioso neutralizado no CSV");
ok(csvCatalogo([it(1)]).includes(",100.00,"), "preço numérico não recebe apóstrofo");

console.log("cards");
const c = cardProduto(it(2), "story", { contato: { nome: "Ana", whatsappLabel: "+55 91" } });
eq([c.w, c.h], [1080, 1920], "story 1080×1920");
const fmt = FORMATOS.story;
const ys = c.ops.filter((o) => o.k === "text").map((o) => o.y);
ok(ys.every((y) => y >= fmt.seguro.topo && y <= fmt.h - fmt.seguro.base + 5), "textos dentro da zona segura do story");
ok(c.ops.some((o) => o.k === "text" && o.s === "R$ 200"), "preço no card");
ok(!cardProduto(it(2), "feed", { mostrarPreco: false }).ops.some((o) => o.k === "text" && /^R\$/.test(o.s)), "sem preço quando oculto");
const car = montarCarrossel(Array.from({ length: 20 }, (_, i) => it(i + 1)), "Sala", "feed");
eq(car.length, 10, "carrossel: capa + 8 + chamada = 10 (limite do Instagram)");
eq(montarCarrossel([it(1)], "T", "feed").length, 3, "1 item → capa + 1 + chamada");
console.log(`\n${n} asserções OK`);
