// Teste da oferta pública (preview WhatsApp). Rode: npm run test:oferta
import assert from "node:assert/strict";
import { tituloOg, descricaoOg, medidasTexto, montarPayloadOferta, linkInteresseOferta, textoGrupo, escaparHtml, montarHtmlOg, injetarOg, tagsOg, MAX_ITENS_OFERTA } from "../src/lib/ofertaCore.js";
import { cardOgProduto, cardOgOferta, OG_LADO } from "../src/lib/cardCore.js";

const ok = (c, m) => { assert.ok(c, m); console.log(`  ok  ${m}`); };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); console.log(`  ok  ${m}`); };
const it = (i, o = {}) => ({ sku: `NOG${i}`, produto: `Produto ${i}`, estado: "Novo", marca: "Marca", cor: "Preto", preco_ideal: 1299, custo_proporcional: 500, comprimento_cm: 60, largura_cm: 40, altura_cm: 30, ...o });

console.log("preview");
eq(tituloOg(it(1)), "Produto 1 — R$ 1.299", "título com preço");
ok(tituloOg(it(1, { produto: "x".repeat(200) })).length <= 70, "título ≤ 70");
ok(tituloOg(it(1, { produto: "x".repeat(200) })).endsWith("R$ 1.299"), "preço nunca é cortado");
eq(tituloOg(it(1), { mostrarPreco: false }), "Produto 1", "sem preço");
eq(tituloOg(it(1, { preco_ideal: null })), "Produto 1", "item sem preço → só nome");
eq(medidasTexto(it(1)), "60 x 40 x 30 cm (C x L x A)", "medidas");
eq(medidasTexto(it(1, { altura_cm: null })), "", "medida incompleta omitida");
ok(descricaoOg(it(1, { marca: "y".repeat(400) })).length <= 160, "descrição ≤ 160");
ok(descricaoOg(it(1)).includes("Marca"), "descrição traz a marca");

console.log("payload");
const c = { nome: "Bárbara", whatsapp: "+55 (91) 98392-9085", label: "+55 91 98392-9085" };
const p1 = montarPayloadOferta([it(1)], { contato: c, fotos: { NOG1: "https://x/f.jpg" }, og: { imagem: "https://x/og.jpg" } });
eq([p1.versao, p1.tipo, p1.totalItens], [3, "produto", 1], "produto único");
eq(p1.contato.whatsapp, "5591983929085", "whatsapp só dígitos");
eq(p1.og.imagem, "https://x/og.jpg", "imagem do preview");
ok(!JSON.stringify(p1).includes("custo") && !JSON.stringify(p1).includes("500"), "payload sem custo/margem");
const p2 = montarPayloadOferta(Array.from({ length: 20 }, (_, i) => it(i + 1, { preco_ideal: 100 + i })));
eq([p2.tipo, p2.itens.length], ["oferta", MAX_ITENS_OFERTA], "oferta limitada a 12");
ok(p2.og.descricao.includes("R$ 100"), "oferta: a partir do menor preço");
eq(p2.contato, null, "sem contato válido → null (página usa o da empresa)");
assert.throws(() => montarPayloadOferta([]), /ao menos 1/); ok(true, "lista vazia rejeitada");
eq(montarPayloadOferta([it(1)], { mostrarPreco: false }).itens[0].preco, null, "mostrarPreco=false remove o preço");

console.log("mensagens");
const li = linkInteresseOferta(p1.itens[0], "5591983929085", "https://app/p/abc");
ok(li.startsWith("https://wa.me/5591983929085?text="), "wa.me com o número");
ok(decodeURIComponent(li).includes("NOG1") && decodeURIComponent(li).includes("R$ 1.299") && decodeURIComponent(li).includes("https://app/p/abc"), "texto com SKU, preço e link");
eq(textoGrupo(p1, "https://app/p/abc"), "*Produto 1* — *R$ 1.299*\nhttps://app/p/abc", "mensagem do grupo (produto)");

console.log("HTML og");
eq(escaparHtml(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;", "escape de HTML");
const h = montarHtmlOg({ titulo: 'A "B" <script>', descricao: "d", imagem: "https://x/og.jpg", url: "https://app/p/abc" });
ok(h.includes('og:title" content="A &quot;B&quot; &lt;script&gt;"') && !h.includes("<script>"), "título escapado (sem injeção)");
ok(h.includes('og:image" content="https://x/og.jpg"') && h.includes('og:url'), "og:image e og:url");
ok(!montarHtmlOg({ titulo: "t" }).includes("og:image"), "sem imagem → sem og:image");

console.log("injeção no index.html");
const idx = '<!doctype html><html><head><meta charset="utf-8"><title>NOGÁRIA OUTLET</title><meta name="description" content="velho"></head><body><div id="root"></div></body></html>';
const inj = injetarOg(idx, { titulo: "Poltrona — R$ 650", descricao: "d", imagem: "https://x/og.jpg", url: "https://app/p/abc" });
ok(inj.includes('<div id="root"></div>') && inj.includes('<meta charset="utf-8">'), "mantém a SPA intacta");
ok((inj.match(/<title>/g) || []).length === 1 && inj.includes("<title>Poltrona — R$ 650</title>"), "troca o <title>");
ok(!inj.includes("velho") && inj.includes('og:image" content="https://x/og.jpg"'), "troca a description e injeta og:image");
ok(inj.indexOf("og:title") < inj.indexOf("</head>"), "tags dentro do <head>");
ok(tagsOg({ titulo: "t", imagem: "https://x/i.jpg" }).includes("og:image:secure_url"), "og:image:secure_url");
ok(injetarOg("<div></div>", { titulo: "t" }).startsWith("<title>t</title>"), "sem </head> → prefixa");

console.log("cards og");
const cp = cardOgProduto(it(1), { foto: "data:image/jpeg;base64,AA" });
eq([cp.w, cp.h], [OG_LADO, OG_LADO], "quadrado 800");
ok(cp.ops.some((o) => o.k === "text" && o.s === "R$ 1.299"), "preço estampado na imagem");
ok(!cardOgProduto(it(1), { mostrarPreco: false }).ops.some((o) => o.s === "R$ 1.299"), "sem preço na imagem quando oculto");
const co = cardOgOferta([it(1), it(2, { preco_ideal: 90 })], { fotos: {} });
ok(co.ops.some((o) => o.s === "R$ 90") && co.ops.some((o) => /a partir de/.test(o.s || "")), "grade com preços e 'a partir de'");
console.log("\nOK");
