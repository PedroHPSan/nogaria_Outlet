// Teste do núcleo puro de orçamentos. Rode: npm run test:orcamentos
import assert from "node:assert/strict";
import { podeTransitar, terminal, codigoOrcamento, proximoSeq, validadeEm, statusEfetivo, reservaAtiva, snapshotItens, totais, valoresPorItem, mensagemCliente, mensagemAceite } from "../src/lib/orcamentosCore.js";

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; console.log(`  ok  ${m}`); };
const ok = (c, m) => { assert.ok(c, m); n++; console.log(`  ok  ${m}`); };
const AG = new Date("2026-10-03T12:00:00Z");

console.log("transições");
ok(podeTransitar("RASCUNHO", "ENVIADO"), "rascunho → enviado");
ok(podeTransitar("ENVIADO", "VENDIDO"), "enviado → vendido (venda direta)");
ok(podeTransitar("RESERVADO", "VENDIDO"), "reservado → vendido");
ok(!podeTransitar("VENDIDO", "CANCELADO"), "vendido não cancela");
ok(!podeTransitar("CANCELADO", "RESERVADO"), "cancelado não reabre");
ok(terminal("EXPIRADO") && !terminal("ENVIADO"), "terminais");

console.log("código e validade");
eq(codigoOrcamento(12), "ORC-0012", "ORC-0012");
eq(proximoSeq("ORC-0012"), 13, "próximo = 13");
eq(proximoSeq(null), 1, "primeiro = 1");
eq(validadeEm(AG), "2026-10-05T12:00:00.000Z", "48 h por padrão");
eq(statusEfetivo({ status: "RESERVADO", validade: "2026-10-03T11:00:00Z" }, AG), "EXPIRADO", "reservado vencido → expirado");
eq(statusEfetivo({ status: "RESERVADO", validade: "2026-10-04T11:00:00Z" }, AG), "RESERVADO", "reservado válido");
eq(statusEfetivo({ status: "VENDIDO", validade: "2020-01-01" }, AG), "VENDIDO", "vendido não expira");
ok(reservaAtiva({ reservado_ate: "2026-10-04T00:00:00Z" }, AG) && !reservaAtiva({ reservado_ate: "2026-10-01T00:00:00Z" }, AG) && !reservaAtiva({}, AG), "reserva ativa");

console.log("totais");
const itens = snapshotItens([{ sku: "A", produto: "Sofá", preco_ideal: 1000 }, { sku: "B", produto: "Mesa", preco_ideal: 333.33 }, { sku: "C", produto: "Sem" }]);
eq(itens[0].preco, 1000, "snapshot congela o preço de venda");
const t = totais(itens, 10);
eq(t.subtotal, 1333.33, "subtotal");
eq(t.total, 1200, "total com 10% (centavos arredondados)");
eq(t.semPreco, ["C"], "item sem preço fora do total");
eq(totais(itens, 200).pct, 90, "desconto limitado a 90%");
const v = valoresPorItem(itens, 10);
eq(v.length, 2, "2 itens com valor");
eq(Math.round(v.reduce((s, x) => s + x.valor, 0) * 100) / 100, t.total, "soma dos valores = total");

console.log("mensagens");
const orc = { codigo: "ORC-0012", cliente_nome: "Maria", itens, desconto_pct: 10, validade: "2026-10-05T12:00:00Z" };
const m = mensagemCliente(orc, "https://x/o/abc");
ok(m.includes("ORC-0012") && m.includes("Maria") && m.includes("Sofá (A)") && m.includes("https://x/o/abc") && m.includes("Desconto de 10%"), "mensagem completa");
ok(m.includes("sob consulta"), "item sem preço aparece sob consulta");
ok(mensagemAceite(orc).includes("ORC-0012"), "aceite cita o código");
console.log(`\n${n} asserções OK`);
