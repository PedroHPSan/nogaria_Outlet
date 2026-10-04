// Teste do layout PURO do catálogo em PDF e da spec. Rode: npm run test:catalogopdf
import assert from "node:assert/strict";
import { normalizarSpec, specPadrao } from "../src/lib/catalogoSpec.js";
import { montarCatalogoPdf, formatarPreco, precoDe } from "../src/lib/catalogoPdfCore.js";
import { dedupCatalogo, agruparCatalogo } from "../src/lib/catalogoCore.js";
import { configParaContato, rotuloWhatsApp } from "../src/lib/empresaConfigCore.js";

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; console.log(`  ok  ${m}`); };
const ok = (c, m) => { assert.ok(c, m); n++; console.log(`  ok  ${m}`); };

const mk = (i, o = {}) => ({ sku: `NOG${String(i).padStart(4, "0")}`, produto: `Produto ${i}`, marca: "M", modelo: "X", estado: "Novo", grupo: "Sala", preco_ideal: 100 + i, ...o });
const secoesDe = (itens, ag = "categoria") => agruparCatalogo(dedupCatalogo(itens), ag);
const textos = (pg) => pg.ops.filter((o) => o.k === "text").map((o) => o.s);

console.log("spec");
eq(normalizarSpec({}).colunas, 2, "padrão 2 colunas");
eq(normalizarSpec({ colunas: 9, tema: "x", modelo: "y" }).tema, "noite", "tema inválido → padrão");
eq(normalizarSpec({ modelo: "lista" }).campos.foto, false, "lista nasce sem foto");
eq(normalizarSpec({ contato: { whatsapp: "123" } }).contato.whatsapp, specPadrao().contato.whatsapp, "WhatsApp curto → da empresa");
eq(normalizarSpec({ contato: { whatsapp: "(91) 98888-7777", extras: [{ rotulo: "IG", valor: "@nogaria" }, { rotulo: "", valor: "x" }] } }).contato.extras.length, 1, "extras vazios descartados");
eq(normalizarSpec({ contato: { whatsapp: "5591988887777" } }).contato.whatsapp, "5591988887777", "WhatsApp completo mantido");

console.log("grade: paginação");
const itens12 = Array.from({ length: 12 }, (_, i) => mk(i + 1, { produto: `Item distinto ${i + 1}` }));
const g = montarCatalogoPdf(secoesDe(itens12), normalizarSpec({}), {});
eq(g.resumo.produtos, 12, "12 produtos");
eq(g.resumo.paginas, 4, "capa + 2 páginas de grade (6/pág) + fechamento");
const g3 = montarCatalogoPdf(secoesDe(itens12), normalizarSpec({ colunas: 3, capa: false, fechamento: false }), {});
eq(g3.resumo.paginas, 2, "3 colunas sem capa/fechamento: 12 cards em 2 páginas (9+3)");
const gSem = montarCatalogoPdf(secoesDe(itens12), normalizarSpec({ capa: false, fechamento: false, campos: { foto: false } }), {});
ok(gSem.resumo.paginas < 3, "sem foto cabe em menos páginas");

console.log("lista: paginação");
const itens40 = Array.from({ length: 40 }, (_, i) => mk(i + 1, { produto: `Item distinto ${i + 1}` }));
const l = montarCatalogoPdf(secoesDe(itens40), normalizarSpec({ modelo: "lista", capa: false, fechamento: false }), {});
ok(l.resumo.paginas >= 2 && l.resumo.paginas <= 3, "40 linhas compactas em 2–3 páginas");

console.log("conteúdo");
const um = montarCatalogoPdf(secoesDe([mk(1, { cond_embalagem: "LEVE", estado: "Embalagem aberta/avariada" })]), normalizarSpec({ capa: false, fechamento: false }), {});
ok(textos(um.paginas[0]).includes("R$ 101"), "preço formatado");
ok(textos(um.paginas[0]).some((t) => t.includes("caixa levemente avariada")), "frase de condição");
ok(textos(um.paginas[0]).includes("NOG0001"), "SKU no card");
const semPreco = montarCatalogoPdf(secoesDe([mk(1)]), normalizarSpec({ capa: false, fechamento: false, campos: { preco: false } }), {});
ok(!textos(semPreco.paginas[0]).some((t) => t.startsWith("R$")), "preço oculto some");
eq(formatarPreco(1299.9), "R$ 1.299,90", "centavos pt-BR");
eq(formatarPreco(0), "R$ —", "preço zero → traço");

console.log("de/por só com referência");
const sd = normalizarSpec({ campos: { de: true } });
eq(precoDe(mk(1, { preco_ref_novo: 300 }), sd), 300, "de = referência maior");
eq(precoDe(mk(1, { preco_ref_novo: 50 }), sd), null, "referência menor → sem de");
eq(precoDe(mk(1), sd), null, "sem referência → sem de");
eq(precoDe(mk(1, { preco_ref_novo: 300 }), normalizarSpec({})), null, "campo desligado → sem de");

console.log("capa e contato");
const c = montarCatalogoPdf(secoesDe([mk(1)]), normalizarSpec({ validade: "15/10", contato: { nome: "Ana", extras: [{ rotulo: "Instagram", valor: "@nogaria" }] } }), { contato: normalizarSpec({ contato: { nome: "Ana", extras: [{ rotulo: "Instagram", valor: "@nogaria" }] } }).contato });
ok(textos(c.paginas[0]).some((t) => t.includes("preços válidos até 15/10")), "capa mostra validade");
ok(textos(c.paginas[0]).includes("Ana"), "capa mostra vendedor");
ok(textos(c.paginas[0]).some((t) => t.includes("Instagram: @nogaria")), "capa mostra contato extra");
ok(textos(c.paginas.at(-1)).includes("Ana"), "fechamento mostra vendedor");

console.log("contato configurável");
eq(rotuloWhatsApp("5591983929085"), "+55 91 98392-9085", "rótulo BR");
eq(configParaContato({}).whatsapp, specPadrao().contato.whatsapp, "sem config → EMPRESA");
const cc = configParaContato({ whatsapp: "(91) 98888-7777", instagram: "@nogaria", site: " ", horario: "Seg–Sáb" });
eq(cc.whatsapp, "91988887777".length >= 12 ? "91988887777" : specPadrao().contato.whatsapp, "WhatsApp sem DDI → EMPRESA");
const cc2 = configParaContato({ whatsapp: "5591988887777", instagram: "@nogaria", site: " ", horario: "Seg–Sáb" });
eq(cc2.whatsapp, "5591988887777", "WhatsApp com DDI usado");
eq(cc2.extras.map((e) => e.rotulo), ["Instagram", "Horário"], "extras só dos campos preenchidos");

console.log(`\n${n} asserções OK`);
