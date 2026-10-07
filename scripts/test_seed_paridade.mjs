// Paridade entre os seeds da migration (pricing_v2_param/canal) e as constantes do motor v2.
// Recebe um JSON { params:[{chave,valor}], canais:[{codigo,nome,taxa,fixo_valor,fixo_abaixo_de,frete_pct}] }
// extraído do Postgres de teste (ver scripts/test_motor_docker.sh). Rode: node scripts/test_seed_paridade.mjs <json>
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REGRAS, CANAIS_V2, aplicarConfig, precificarV2 } from "../src/lib/motorPreco.js";

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; console.log(`  ok  ${m}`); };
const seed = JSON.parse(readFileSync(process.argv[2], "utf8"));
const amostra = [
  { alvoMercado: 312, custoAloc: 105, canal: "ML", pesoKg: 1 }, { alvoMercado: 77, custoAloc: 5, canal: "ML", pesoKg: 1 },
  { alvoMercado: 150, custoAloc: 27.05, canal: "SHOPEE", pesoKg: 1 }, { alvoMercado: 300, custoAloc: 95, canal: "AMAZON", pesoKg: 5 },
  { alvoMercado: 40, custoAloc: 2, canal: "LOCAL", pesoKg: 0.2 }, { alvoMercado: 500, custoAloc: 60, canal: "MAGALU", pesoKg: 9 },
];
const antes = amostra.map((a) => precificarV2(a));
const regrasAntes = JSON.stringify(REGRAS);
const canaisAntes = Object.fromEntries(Object.entries(CANAIS_V2).map(([k, c]) => [k, { taxa: c.taxa, frete: c.frete, f1: c.fixo(10), f2: c.fixo(500) }]));

console.log("seeds do banco × constantes do motor");
aplicarConfig(seed);
eq(JSON.stringify(REGRAS), regrasAntes, "as regras do seed reproduzem as constantes (imposto, comissão, adm, reserva, margem, mínimos)");
const canaisDepois = Object.fromEntries(Object.entries(CANAIS_V2).map(([k, c]) => [k, { taxa: c.taxa, frete: c.frete, f1: c.fixo(10), f2: c.fixo(500) }]));
eq(canaisDepois, canaisAntes, "os 8 canais do seed reproduzem taxa, frete e tarifa fixa (inclui o degrau R$79 do ML)");
eq(amostra.map((a) => precificarV2(a)), antes, "piso, mínimo, preço e lucro idênticos antes e depois de carregar o seed");

console.log("parâmetro editado no banco passa a valer");
aplicarConfig({ params: [{ chave: "margem_min", valor: "0.30" }] });
assert.ok(precificarV2(amostra[0]).minimo > antes[0].minimo); n++; console.log("  ok  margem 30% eleva o preço mínimo");
console.log(`\n${n} asserções OK`);
