// Item separado em sacola do WhatsApp conta como vendido (selo, filtros, bloqueio de link).
import assert from "node:assert/strict";
import { separadoEmSacola, indisponivelParaVenda, motivoIndisponivel, statusMetaItem, filtrarStatusItens } from "../src/lib/model.js";

const agora = new Date("2026-10-31T12:00:00Z");
const futuro = "2026-11-02T12:00:00Z", passado = "2026-10-30T12:00:00Z";
const sep = { sku: "A1", status: "ANUNCIADO", reservado_ate: futuro, reservado_por_orc: "ORC-0007" };

assert.equal(separadoEmSacola(sep, agora), true);
assert.equal(separadoEmSacola({ ...sep, reservado_ate: passado }, agora), false, "sacola vencida libera");
assert.equal(separadoEmSacola({ ...sep, status: "VENDIDO" }, agora), false, "vendido não é 'separado'");
assert.equal(indisponivelParaVenda(sep, agora), true);
assert.equal(indisponivelParaVenda({ sku: "B", status: "VENDIDO" }, agora), true);
assert.equal(indisponivelParaVenda({ sku: "C", status: "ANUNCIADO" }, agora), false);
assert.equal(motivoIndisponivel(sep, agora), "separado na sacola ORC-0007");
assert.equal(statusMetaItem(sep, agora).label, "Vendido · separado ORC-0007");
assert.equal(statusMetaItem({ status: "ANUNCIADO" }, agora).id, "ANUNCIADO");

// filtros: registra as chamadas do query builder
const fake = () => { const c = []; const q = new Proxy({}, { get: (_, m) => (...a) => { c.push([m, ...a]); return q; } }); q.calls = c; return { q, c }; };
let f = fake(); filtrarStatusItens(f.q, "", { agora });
assert.deepEqual(f.c.map((x) => x[0]), ["not", "or"], "estoque disponível exclui fora do estoque e separados");
f = fake(); filtrarStatusItens(f.q, "VENDIDO", { agora });
assert.match(f.c[0][1], /^status\.eq\.VENDIDO,and\(reservado_ate\.gt\./, "Vendido inclui separados");
f = fake(); filtrarStatusItens(f.q, "ENTREGUE", { agora });
assert.deepEqual(f.c, [["eq", "status", "ENTREGUE"]]);
f = fake(); filtrarStatusItens(f.q, "", { agora, incluirFora: true });
assert.equal(f.c.length, 0);
console.log("✓ separado em sacola: selo, bloqueio e filtros");
