// Teste do motor de preço v2 e do custo composto do lote (puros). Rode: npm run test:motorpreco
import assert from "node:assert/strict";
import { custoRealLote, TAXA_HISA_REAL, FRETE_TOTAL_ESTIMADO } from "../src/lib/custoLote.js";
import { ratearLote, precificarV2, precoParaMargem, lucroEm, pctVariavel, embalagemPorPeso, explicar, REGRAS, custoMaximoLance, aplicarConfig, CANAIS_V2, decomporCustos, porteLabel } from "../src/lib/motorPreco.js";

let n = 0;
const eq = (a, b, m) => { assert.equal(a, b, m); n++; console.log(`  ok  ${m}`); };
const ok = (c, m) => { assert.ok(c, m); n++; console.log(`  ok  ${m}`); };
const perto = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`); n++; console.log(`  ok  ${m}`); };

console.log("custo composto do lote");
const lotes = [
  { lote: 3, lance_final: 1544.9, custo_total: 1622.15 },
  { lote: 100, lance_final: 10155.9, custo_total: 10663.7 },
  { lote: 82, lance_final: 580.9, custo_total: 609.95 }, // sem resíduo conhecido
  { lote: 7, custo_total: 2507.35 }, // custo fixo (já é o valor pago)
];
const c3 = custoRealLote(lotes[0], lotes);
eq(c3.comissao, 77.25, "comissão 5% do lance");
eq(c3.taxaHisa, TAXA_HISA_REAL[3], "taxa HISA real do lote 3");
eq(c3.taxaOrigem, "real", "origem real");
ok(c3.total > 2062.15, "total = pago HISA + frete estimado");
const c82 = custoRealLote(lotes[2], lotes);
eq(c82.taxaHisa, 14.52, "lote sem resíduo: 2,5% do lance");
eq(c82.taxaOrigem, "estimado", "origem estimada");
const c7 = custoRealLote(lotes[3], lotes);
eq(c7.taxaOrigem, "incluida", "lote fora do sistema: não soma taxa");
perto(lotes.reduce((s, l) => s + custoRealLote(l, lotes).frete, 0), FRETE_TOTAL_ESTIMADO, 0.05, "frete rateado fecha em R$ 8.000");

console.log("regras de preço");
perto(pctVariavel("ML"), 0.51, 1e-9, "ML Clássico: 51% de custos percentuais");
perto(pctVariavel("LOCAL"), 0.29, 1e-9, "Local: 29%");
eq(embalagemPorPeso(0.1), 2, "porte P"); eq(embalagemPorPeso(1), 5, "porte M"); eq(embalagemPorPeso(5), 12, "porte G"); eq(embalagemPorPeso(12), 20, "porte GG"); eq(embalagemPorPeso(null), 5, "sem peso: M");
// exemplo do plano: custo 105 (sem embalagem) a R$312 no ML → lucro 47,88 (15,3%)
const l = lucroEm(312, 105, "ML");
perto(l.lucro, 47.88, 0.01, "plano: lucro R$ 47,88 no ML a R$ 312");
perto(precoParaMargem(105, "ML", 0), 214.29, 0.01, "plano: piso R$ 214,29");
perto(precoParaMargem(105, "ML", 0.25), 437.5, 0.01, "plano: mínimo R$ 437,50");
perto(precoParaMargem(105, "LOCAL", 0.25), 228.26, 0.01, "plano: mínimo local R$ 228,26");
// piso é o preço em que o lucro zera (consistência com lucroEm)
const piso = precoParaMargem(20, "ML", 0);
perto(lucroEm(piso, 20, "ML").lucro, 0, 0.02, "lucro no piso ≈ 0 (item barato, com tarifa fixa)");
const min25 = precoParaMargem(20, "ML", 0.25);
perto(lucroEm(min25, 20, "ML").margem, 0.25, 0.005, "margem no mínimo ≈ 25%");

console.log("rateio do lote");
const itens = [
  { sku: "A", alvo: 20, grupo: "Acessórios celular", pesoKg: 0.1, canal: "ML" },
  { sku: "B", alvo: 150, grupo: "Fones", pesoKg: 0.5, canal: "ML" },
  { sku: "C", alvo: 1500, grupo: "Robô aspirador", pesoKg: 6, canal: "ML" },
];
const rat = ratearLote(itens, 1000);
perto([...rat.values()].reduce((s, x) => s + x.custo, 0), 1000, 0.001, "Σ custo alocado = custo do lote");
ok(rat.get("A").custo < rat.get("B").custo && rat.get("B").custo < rat.get("C").custo, "custo cresce com o valor do item");
ok(rat.get("A").custo < 11.98, "capa carrega menos que no rateio por preço (R$ 11,98)");
const semRef = ratearLote([...itens, { sku: "D", alvo: 0, grupo: "Fones" }], 1000);
ok(semRef.get("D").refEstimada && semRef.get("D").custo > 0, "item sem referência nunca recebe custo 0");
perto([...semRef.values()].reduce((s, x) => s + x.custo, 0), 1000, 0.001, "com item sem ref a soma ainda fecha");
const peso = ratearLote(itens.map((i) => (i.sku === "C" ? { ...i, k: 0.25 } : i)), 1000);
ok(peso.get("C").custo < rat.get("C").custo, "peso manual k=0,25 reduz o custo do item");
const k99 = ratearLote(itens.map((i) => (i.sku === "C" ? { ...i, k: 99 } : i)), 1000);
ok(k99.get("C").custo >= rat.get("C").custo, "k é limitado a 4 (não explode)");
const tudoZero = ratearLote([{ sku: "X", alvo: 5, grupo: "Livros" }, { sku: "Y", alvo: 5, grupo: "Livros" }], 100);
perto(tudoZero.get("X").custo, 50, 0.01, "Σ contribuição 0 → igualitário");

console.log("preço e decisão");
const ml = precificarV2({ alvoMercado: 312, custoAloc: 105, canal: "ML", pesoKg: 1 });
eq(ml.status, "GIRO", "R$ 312 com custo 105 no ML: dá lucro, mas abaixo de 25%");
ok(ml.lucro > 0 && ml.margem < REGRAS.margemMin, "lucro positivo e margem < 25%");
const ok1 = precificarV2({ alvoMercado: 150, custoAloc: 27.05, canal: "ML", pesoKg: 1 });
eq(ok1.status, "ANUNCIAR", "plano: fone (custo 27,05) cobre a margem mínima");
const inv = precificarV2({ alvoMercado: 300, custoAloc: 400, canal: "ML", pesoKg: 1 });
ok(["INVIAVEL", "LOCAL"].includes(inv.status) && inv.sugerido !== 0, "custo > preço de mercado não vira ANUNCIAR");
eq(inv.status, "INVIAVEL", "custo 400 > mercado 300: inviável");
eq(precificarV2({ alvoMercado: 25, custoAloc: 1, canal: "ML" }).status, "KIT", "item de R$ 25: kit/combo");
eq(precificarV2({ alvoMercado: 0, custoAloc: 10, canal: "ML" }).status, "SEM_REF", "sem referência: não sugere preço");
eq(precificarV2({ alvoMercado: 200, custoAloc: 10, canal: "ML", refEstimada: true }).status, "SEM_REF", "referência estimada não gera preço");
const loc = precificarV2({ alvoMercado: 300, custoAloc: 95, canal: "ML", pesoKg: 1 });
ok(loc.status === "LOCAL" ? loc.canal === "LOCAL" && loc.sugerido > 0 : true, "se só o local fecha, a decisão vem com canal LOCAL");
const deg = precificarV2({ alvoMercado: 77, custoAloc: 5, canal: "ML", pesoKg: 1 });
eq(deg.sugerido, 79, "evita R$ 72–78,99 no ML (sobe para R$ 79)");
const txt = explicar(ok1, { condicao: "A" });
ok(txt.length >= 4 && txt.some((x) => /Lucro esperado/.test(x)) && txt.some((x) => /imposto sobre a receita 13,0%/.test(x)), "explicação cita mercado, custos e lucro");

console.log("custo máximo de lance");
const lance = custoMaximoLance([{ alvo: 1000, grupo: "Eletro", pesoKg: 5, canal: "ML" }]);
perto(lance, 1000 * 0.9 * 0.24 - 12, 0.01, "1 item: VEL × 24% − embalagem");
eq(custoMaximoLance([{ alvo: 0 }, { alvo: 10, canal: "ML", pesoKg: 1 }]), 0, "sem referência ou item que não cobre fixos: 0");
ok(custoMaximoLance([{ alvo: 1000, canal: "LOCAL", pesoKg: 5 }]) > lance, "canal local suporta lance maior que o ML");

console.log("aplicarConfig: null do banco não vira 0");
const fixoAmazon = CANAIS_V2.AMAZON.fixo(500);
aplicarConfig({ canais: [{ codigo: "AMAZON", nome: "Amazon", taxa: "0.12", fixo_valor: "2", fixo_abaixo_de: null, frete_pct: "0.10" }] });
eq(CANAIS_V2.AMAZON.fixo(500), fixoAmazon, "fixo_abaixo_de null = sempre cobra a tarifa (não zera)");
aplicarConfig({ canais: [{ codigo: "ML", nome: "ML", taxa: 0.12, fixo_valor: 6.5, fixo_abaixo_de: 79, frete_pct: 0.1 }] });
eq(CANAIS_V2.ML.fixo(100), 0, "ML acima de R$79 sem tarifa"); eq(CANAIS_V2.ML.fixo(50), 6.5, "ML abaixo de R$79 com tarifa");
aplicarConfig({ params: [{ chave: "margem_min", valor: null }, { chave: "imposto", valor: "0.13" }] });
eq(REGRAS.margemMin, 0.25, "parâmetro null mantém o padrão");

console.log("decomposição dos custos (memória de cálculo)");
const dc = decomporCustos(312, "ML");
eq(dc.linhas.length, 6, "6 custos percentuais separados");
perto(dc.total, 312 * 0.51, 0.02, "total no ML = 51% do preço (R$ 159,12)");
perto(dc.linhas.find((l) => l.id === "imposto").valor, 40.56, 0.01, "imposto 13% de R$ 312 = R$ 40,56");
eq(decomporCustos(50, "ML").fixo, 6.5, "ML abaixo de R$ 79: tarifa fixa R$ 6,50");
eq(decomporCustos(100, "ML").fixo, 0, "ML acima de R$ 79: sem tarifa fixa");
perto(decomporCustos(100, "LOCAL").total, 29, 0.01, "local: 29%");
ok(/GG/.test(porteLabel(10)) && /sem peso/.test(porteLabel(0)), "porte legível");
eq(precificarV2({ alvoMercado: 150, custoAloc: 27.05, canal: "ML", pesoKg: 1 }).base, 32.05, "base = custo alocado + embalagem");

console.log(`\n${n} asserções OK`);
