// Teste das regras puras do custeio dos lotes (custeioCore + custoLote). Rode: npm run test:custeio
import assert from "node:assert/strict";
import { toNum, emTexto, formInicial, totalPrevisto, lerColado, payloadCusteio, REGRAS_RATEIO, globalVazio, validarGlobal, soErros, lerListaLotes, lerListaTexto, descreverGlobal, globalVigente } from "../src/lib/custeioCore.js";
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

console.log("payload da RPC salvar_custeio_lote");
const fo = { modo: "rateio", valor: "1.000,50", comissao: "50", taxa: "", extras: [
  { id: 7, sku: "", tipo: "frete_retirada", descricao: " frete ", valor: "120", regra_rateio: "igual" },
  { id: null, sku: " NOG-1-001 ", tipo: "impostos", descricao: "", valor: "10" },
  { id: null, sku: "", tipo: "outros", descricao: "", valor: "0" }] };
const pl = payloadCusteio({ lote: 5 }, fo, { "NOG-1-002": "35,90", "NOG-1-003": "" });
eq([pl.p_lote, pl.p_modo, pl.p_lance, pl.p_comissao, pl.p_taxa], [5, "rateio", 1000.5, 50, 0], "rateio: valor, comissão e taxa numéricos (taxa vazia = 0)");
eq(pl.p_extras, [{ id: 7, sku: null, tipo: "frete_retirada", descricao: "frete", valor: 120, regra_rateio: "igual" }, { id: null, sku: "NOG-1-001", tipo: "impostos", descricao: null, valor: 10, regra_rateio: "motor" }], "extras: mantém id, limpa texto, ignora valor zero, regra padrão");
eq(pl.p_diretos, { "NOG-1-002": 35.9, "NOG-1-003": null }, "custos diretos: vazio limpa (null)");
const ps = payloadCusteio({ lote: 5 }, { ...fo, modo: "soma", extras: [] }, {});
eq([ps.p_modo, ps.p_lance, ps.p_comissao, ps.p_taxa], ["soma", null, null, null], "soma: sem valor do lote");
eq(REGRAS_RATEIO.map((r) => r[0]), ["motor", "igual", "valor", "peso"], "regras de rateio oferecidas");
eq(formInicial({ lote: 1, custo_origem: "composto", modo_custeio: "soma" }, [{ id: 3, sku: null, tipo: "frete_retirada", valor: 50, regra_rateio: "peso" }]).extras[0].regra_rateio, "peso", "formulário carrega a regra do extra");

console.log("custos globais");
const gOk = { ...globalVazio(), nome: "Taxa de separação", valor: "2,5", vigencia_inicio: "2026-11-01" };
eq(validarGlobal(gOk), [], "global válido");
ok(validarGlobal({ ...gOk, nome: "x" }).some((m) => /nome/i.test(m)), "nome curto");
ok(validarGlobal({ ...gOk, valor: "" }).some((m) => /valor/i.test(m)), "valor obrigatório");
ok(validarGlobal({ ...gOk, base: "pct_custo_lote", valor: "120" }).some((m) => /0 a 100/.test(m)), "percentual acima de 100");
ok(validarGlobal({ ...gOk, vigencia_inicio: "" }).some((m) => /início/i.test(m)), "vigência obrigatória");
ok(validarGlobal({ ...gOk, vigencia_fim: "2026-10-01" }).some((m) => /antes do início/.test(m)), "fim antes do início");
ok(validarGlobal({ ...gOk, lotes: "abc" }).some((m) => /Lotes/.test(m)), "lotes inválidos");
const emb = validarGlobal({ ...gOk, tipo: "embalagem" });
ok(emb.length === 1 && soErros(emb).length === 0, "embalagem: só AVISO de contagem em dobro (não bloqueia)");
eq(lerListaLotes("1001, 1003; 1001\nx"), [1001, 1003], "lista de lotes sem repetição");
eq(lerListaTexto("Vestuário, Calçados;"), ["Vestuário", "Calçados"], "lista de grupos");
ok(descreverGlobal({ valor: 2, base: "por_item", grupos: ["Vestuário"], lotes: null }).includes("grupos: Vestuário") && descreverGlobal({ valor: 10, base: "pct_custo_lote" }).startsWith("10%"), "descrição legível");
ok(globalVigente({ ativo: true, vigencia_inicio: "2026-11-01", vigencia_fim: null }, "2026-12-01"), "vigente sem fim");
ok(!globalVigente({ ativo: true, vigencia_inicio: "2026-11-01", vigencia_fim: "2026-11-30" }, "2026-12-01"), "fora da vigência");
ok(!globalVigente({ ativo: false, vigencia_inicio: "2026-11-01" }, "2026-11-05"), "inativo");
