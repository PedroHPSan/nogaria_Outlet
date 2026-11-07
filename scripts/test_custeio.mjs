// Teste das regras puras do custeio dos lotes (custeioCore + custoLote). Rode: npm run test:custeio
import assert from "node:assert/strict";
import { toNum, emTexto, formInicial, totalPrevisto, lerColado } from "../src/lib/custeioCore.js";
import { custoRealLote, loteSemCusto } from "../src/lib/custoLote.js";

const ok = (c, msg) => { assert.ok(c, msg); console.log(`  ok  ${msg}`); };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); console.log(`  ok  ${msg}`); };

console.log("números");
eq([toNum("1.234,56"), toNum("12,5"), toNum(""), toNum(null), toNum("abc"), toNum(7)], [1234.56, 12.5, null, null, null, 7], "toNum lê o formato brasileiro");
eq([emTexto(12.5), emTexto(null)], ["12,5", ""], "emTexto");

console.log("lote sem custo não vira custo zero");
const base = { lote: 1001, referencia: "LECLATÉE" };
ok(loteSemCusto({ ...base, custo_total: null }), "lote sem lance e sem custo_total = sem custo");
ok(loteSemCusto({ ...base, custo_total: 0 }), "custo_total 0 também é sem custo");
ok(loteSemCusto({ ...base, custo_origem: "composto", modo_custeio: "soma", custo_total: 0 }), "composto sem nenhum valor lançado = sem custo");
ok(!loteSemCusto({ ...base, custo_origem: "composto", modo_custeio: "soma", custo_total: 1500 }), "composto com valor tem custo");
ok(!loteSemCusto({ ...base, lance_final: 1000, custo_total: 1050 }), "lote com lance tem custo");
ok(!loteSemCusto({ lote: 7, custo_total: 500 }), "lote de custo fixo tem custo");
eq(custoRealLote({ ...base, custo_total: null }, [{ ...base }]), null, "custoRealLote devolve null (e não total 0)");
eq(custoRealLote({ ...base, custo_origem: "composto", modo_custeio: "soma", custo_total: 1500 }).total, 1500, "composto usa custo_total");

console.log("formulário");
const f = formInicial({ lote: 5, custo_origem: null, lance_final: 1000, custo_total: 1050, frete_retirada: 200 }, []);
eq([f.modo, f.valor, f.comissao], ["rateio", "1000", "50"], "lote legado: valor e comissão de 5%");
eq(f.extras.map((e) => [e.tipo, e.valor]), [["frete_retirada", "200"]], "frete legado vira custo adicional");
eq(totalPrevisto({ ...f, modo: "rateio" }, {}).total, 1000 + 50 + 0 + 200, "total do rateio = valor + comissão + taxa + extras");
eq(totalPrevisto({ modo: "soma", extras: [{ valor: "30" }], valor: "", comissao: "", taxa: "" }, { A: "10", B: "20,5", C: "" }).total, 60.5, "total da soma = custos diretos + extras");

console.log("colar da planilha");
const skus = ["NOG-1001-002", "NOG-1001-001", "NOG-1001-003"];
let r = lerColado("NOG-1001-001;12,50\nNOG-1001-002\t30\nNOG-1001-003 R$ 7,9\nXXX lixo\nNOG-9999-001;5", skus);
eq(r.valores, { "NOG-1001-001": "12,5", "NOG-1001-002": "30", "NOG-1001-003": "7,9" }, "casa pelo SKU (; tab ou espaço, com R$)");
eq([r.modo, r.ignorados.length], ["sku", 2], "linha sem SKU e SKU de outro lote são ignorados");
r = lerColado("10\n20,5\n30", skus);
eq(r.valores, { "NOG-1001-001": "10", "NOG-1001-002": "20,5", "NOG-1001-003": "30" }, "coluna única vale na ordem dos SKUs");
eq(lerColado("1\n2\n3\n4", skus).ignorados, ["4"], "valor além do número de itens é ignorado");
eq(lerColado("", skus).valores, {}, "texto vazio");
eq(lerColado("abc", skus).ignorados, ["abc"], "texto sem número não vira custo");
