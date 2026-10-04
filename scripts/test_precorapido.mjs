// Teste do preço rápido (puro). Rode: npm run test:precorapido
import assert from "node:assert/strict";
import { diasParado, markdownPorIdade, arredondarPsicologico, calcularPrecoRapido, planoEmMassa, FAIXAS_PADRAO } from "../src/lib/precoRapido.js";

let n = 0;
const eq = (a, b, m) => { assert.equal(a, b, m); n++; console.log(`  ok  ${m}`); };
const ok = (c, m) => { assert.ok(c, m); n++; console.log(`  ok  ${m}`); };
const HOJE = new Date("2026-10-03T12:00:00Z");
const dias = (d) => new Date(HOJE.getTime() - d * 86400000).toISOString();

console.log("idade e faixas (limites inclusivos)");
eq(diasParado({ disponivel_desde: dias(45) }, HOJE), 45, "45 dias");
eq(diasParado({}, HOJE), null, "sem data → null");
eq(markdownPorIdade(30), 0, "30 dias → 0%");
eq(markdownPorIdade(31), 10, "31 dias → 10%");
eq(markdownPorIdade(60), 10, "60 dias → 10%");
eq(markdownPorIdade(61), 20, "61 dias → 20%");
eq(markdownPorIdade(91), 30, "91+ → 30%");
eq(markdownPorIdade(500), 30, "500 → 30%");
eq(markdownPorIdade(null), 0, "sem data → 0%");

console.log("arredondamento");
eq(arredondarPsicologico(87), 89, "87 → 89");
eq(arredondarPsicologico(283), 279, "283 → 279 (9 mais próximo)");
eq(arredondarPsicologico(285), 289, "285 → 289");
eq(arredondarPsicologico(5), 9, "mínimo 9");
eq(arredondarPsicologico(999), 999, "999 fica 999");
eq(arredondarPsicologico(1280), 1300, "1280 → 1300");
eq(arredondarPsicologico(1260), 1250, "1260 → 1250");
eq(arredondarPsicologico(281, "cima"), 289, "cima: 281 → 289");
eq(arredondarPsicologico(290, "cima"), 299, "cima: 290 → 299");
eq(arredondarPsicologico(0), 0, "zero → 0");

console.log("cálculo");
const d = (rec, piso) => ({ recomendado: rec, piso });
let r = calcularPrecoRapido({ sku: "A", preco_ideal: 500, disponivel_desde: dias(70) }, d(500, 200), { hoje: HOJE });
eq(r.pctMarkdown, 20, "70 dias → 20%");
eq(r.novo, 399, "500 × 0,8 = 400 → 399");
ok(r.aplicar && !r.aprovacao, "aplica sem aprovação");
r = calcularPrecoRapido({ sku: "B", preco_ideal: 500, disponivel_desde: dias(100) }, d(500, 380), { hoje: HOJE });
eq(r.novo, 389, "piso 380 → 389 (≥ piso, termina em 9)");
ok(r.motivos.includes("limitado ao piso"), "marca limitado ao piso");
ok(r.novo >= 380, "nunca abaixo do piso");
r = calcularPrecoRapido({ sku: "C", preco_ideal: 1000, disponivel_desde: dias(100) }, d(500, 100), { hoje: HOJE });
ok(r.aprovacao && !r.aplicar, "queda > 40% exige aprovação");
r = calcularPrecoRapido({ sku: "D", classe: "A+", preco_ideal: 500, disponivel_desde: dias(100) }, d(500, 100), { hoje: HOJE });
ok(r.aprovacao, "A+ exige aprovação");
r = calcularPrecoRapido({ sku: "E", preco_ideal: 500 }, d(500, 100), { hoje: HOJE });
eq(r.pctMarkdown, 0, "sem data → sem markdown");
eq(r.novo, 499, "mas arredonda 500 → 499");
r = calcularPrecoRapido({ sku: "F" }, d(0, 0), { hoje: HOJE });
ok(r.ignorado && !r.aplicar, "sem recomendação → ignorado");
r = calcularPrecoRapido({ sku: "G", preco_ideal: 499, disponivel_desde: dias(10) }, d(500, 100), { hoje: HOJE });
ok(!r.aplicar && !r.aprovacao, "novo == atual → nada a aplicar");
r = calcularPrecoRapido({ sku: "H", preco_ideal: 500, disponivel_desde: dias(100) }, d(500, 0), { hoje: HOJE });
ok(r.aprovacao, "piso indefinido exige aprovação");
r = calcularPrecoRapido({ sku: "I", preco_ideal: 500, disponivel_desde: dias(100) }, d(500, 100), { hoje: HOJE, arredondar: false });
eq(r.novo, 350, "sem arredondar: 500 × 0,7 = 350");

console.log("só baixa preço");
r = calcularPrecoRapido({ sku: "J", preco_ideal: 400, disponivel_desde: dias(10) }, d(900, 100), { hoje: HOJE });
eq(r.novo, 400, "recomendação maior que o atual → mantém o atual");
ok(!r.aplicar, "e não aplica nada");
r = calcularPrecoRapido({ sku: "K", preco_ideal: 400, disponivel_desde: dias(10) }, d(900, 100), { hoje: HOJE, permitirAumento: true });
eq(r.novo, 899, "permitirAumento libera a subida (900 → 899)");
r = calcularPrecoRapido({ sku: "L", disponivel_desde: dias(100) }, d(500, 100), { hoje: HOJE });
ok(r.ignorado && r.ignorado.includes("sem preço atual") && !r.aplicar, "item sem preço não é precificado automaticamente");
r = calcularPrecoRapido({ sku: "M", preco_ideal: 200, disponivel_desde: dias(100) }, d(500, 300), { hoje: HOJE });
ok(r.aprovacao && !r.aplicar, "preço atual já abaixo do piso → revisão manual (não sobe sozinho)");
ok(r.motivos.some((m) => m.includes("abaixo do piso")), "motivo explica o piso");

console.log("plano em massa");
const itens = [
  { sku: "1", preco_ideal: 500, disponivel_desde: dias(70) },
  { sku: "2", preco_ideal: 1000, disponivel_desde: dias(100) },
  { sku: "3" },
];
const p = planoEmMassa(itens, (it) => (it.sku === "3" ? d(0, 0) : d(500, 100)), { hoje: HOJE });
eq(p.totais.total, 3, "3 linhas");
eq(p.totais.aplicar, 1, "1 aplica");
eq(p.totais.aprovacao, 1, "1 pede aprovação");
eq(p.totais.ignorados, 1, "1 ignorado");
eq(p.totais.deltaTotal, -101, "Δ total = 399 − 500");
ok(FAIXAS_PADRAO.length === 4, "4 faixas padrão");
console.log(`\n${n} asserções OK`);
