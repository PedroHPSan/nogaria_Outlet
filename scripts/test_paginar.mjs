import assert from "node:assert";
import { lerTodas, combina, paginar, totalPaginas } from "../src/lib/paginar.js";
// lerTodas: junta páginas até vir uma incompleta (corte de 1.000 do PostgREST)
const base = Array.from({ length: 2500 }, (_, i) => i);
const chamadas = [];
const r = await lerTodas((de, ate) => { chamadas.push([de, ate]); return Promise.resolve({ data: base.slice(de, ate + 1), error: null }); });
assert.strictEqual(r.length, 2500); assert.deepStrictEqual(chamadas, [[0, 999], [1000, 1999], [2000, 2999]]);
const exato = await lerTodas((de, ate) => Promise.resolve({ data: base.slice(0, 2000).slice(de, ate + 1), error: null }));
assert.strictEqual(exato.length, 2000);
await assert.rejects(lerTodas(() => Promise.resolve({ data: null, error: new Error("falhou") })), /falhou/);
// busca: sem acento, sem caixa, todas as palavras
assert.ok(combina("Ventilador Turbo Coluna NOG-042-002", "ventilador turbo"));
assert.ok(combina("Fechadura Elétrica", "eletrica fech"));
assert.ok(!combina("Fechadura", "porta"));
assert.ok(combina("qualquer", ""));
// paginação
assert.strictEqual(totalPaginas(0), 1); assert.strictEqual(totalPaginas(101), 3);
assert.deepStrictEqual(paginar([1, 2, 3, 4, 5], 1, 2), [3, 4]);
console.log("paginar: ok");
