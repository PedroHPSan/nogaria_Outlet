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
const perigoso = injetarOg(idx, { titulo: "Cadeira $& $' $$ $1 $`", descricao: "US$$ 5 $&" });
ok((perigoso.match(/<\/head>/g) || []).length === 1, "título com $& / $' não reinsere </head>");
ok(perigoso.includes("Cadeira $&amp; $&#39; $$ $1 $`") && perigoso.includes("US$$ 5 $&amp;"), "$ literais preservados no título e na descrição");
ok(injetarOg("<div></div>", { titulo: "t" }).startsWith("<title>t</title>"), "sem </head> → prefixa");

console.log("cards og");
const cp = cardOgProduto(it(1), { foto: "data:image/jpeg;base64,AA" });
eq([cp.w, cp.h], [OG_LADO, OG_LADO], "quadrado 800");
ok(cp.ops.some((o) => o.k === "text" && o.s === "R$ 1.299"), "preço estampado na imagem");
ok(!cardOgProduto(it(1), { mostrarPreco: false }).ops.some((o) => o.s === "R$ 1.299"), "sem preço na imagem quando oculto");
const co = cardOgOferta([it(1), it(2, { preco_ideal: 90 })], { fotos: {} });
ok(co.ops.some((o) => o.s === "R$ 90") && co.ops.some((o) => /a partir de/.test(o.s || "")), "grade com preços e 'a partir de'");
console.log("\nOK");

console.log("preço em euros");
const { precoMisto, brlComAcrescimo, textoGrupoEuro, textoCotacao, fmtEUR } = await import("../src/lib/precoEuro.js");
eq(brlComAcrescimo(1000), 1200, "+20% sobre o valor em reais");
eq(precoMisto(1000, 6), { brl: 1200, eur: 200 }, "euro = reais +20% ÷ cotação");
eq(precoMisto(1000, null), { brl: 1200, eur: null }, "sem cotação → só reais");
eq(precoMisto(0, 6), null, "sem preço → null");
const pe = montarPayloadOferta([it(1)], { euro: { taxa: 6, em: Date.UTC(2026, 9, 30, 17, 5) }, og: { imagem: "x" } });
ok(pe.euro === true && pe.itens[0].preco === 1299, "payload euro guarda o R$ base");
eq(pe.og.titulo, "Produto 1 — € 259,80 · R$ 1.558,80", "título do preview com € e R$ (sem mencionar +20%)");
ok(pe.og.descricao.includes("Price updates on click") && pe.og.descricao.length <= 160, "descrição do preview avisa em 3 idiomas");
const imgE = JSON.stringify(cardOgProduto(it(1), { euro: { taxa: 6, em: 0 } }));
ok(imgE.includes("€ 259,80") && imgE.includes("R$ 1.558,80"), "imagem do preview com os dois valores");
eq(montarPayloadOferta([it(1)], { euro: { taxa: 6, em: 0 }, mostrarPreco: false }).euro, false, "sem preço → sem euro");
const cot = { taxa: 6, em: Date.UTC(2026, 9, 30, 17, 5) };
eq(textoCotacao(cot), "Cotação: 1 € = R$ 6,00 (30/10/2026 14:05)", "cotação com data no fuso de Brasília");
const tg = textoGrupoEuro(pe, "https://app/p/abc", cot);
ok(tg.includes("€ 259,80* · R$ 1.558,80") && !tg.includes("20%") && tg.includes("🇬🇧") && tg.includes("🇪🇸") && tg.includes("🇧🇷") && tg.includes(fmtEUR(259.8)) && tg.includes("é atualizado com a cotação do momento"), "mensagem do grupo com R$, €, cotação e aviso");
const { mensagemInteresseEuro, idiomaDoNavegador } = await import("../src/lib/precoEuro.js");
ok(mensagemInteresseEuro(pe.itens[0], cot, "u", "es").startsWith("¡Hola! Me interesa") && mensagemInteresseEuro(pe.itens[0], cot, "u", "en").includes("€ 259,80 · R$ 1.558,80"), "mensagem do pedido recalculada, em es/en");
eq([idiomaDoNavegador("es-AR"), idiomaDoNavegador("en-GB"), idiomaDoNavegador("de-DE")], ["es", "en", "pt"], "idioma pelo navegador (padrão pt)");
