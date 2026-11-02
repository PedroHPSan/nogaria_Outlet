// C1: regra de elegibilidade ao catálogo (Foto OK ou além) e motivos de bloqueio.
import assert from "node:assert";
import { elegibilidadeCatalogo as el } from "../src/lib/catalogoElegibilidade.js";

const ok = { status: "FOTOGRAFADO", preco_ideal: 50, estado: "BOM", grupo: "Casa" };
const ctx = { fotos: 1 };

assert.deepStrictEqual(el(ok, ctx), { elegivel: true, motivos: [] });
for (const status of ["PRECIFICADO", "PRONTO", "ANUNCIADO"]) assert.ok(el({ ...ok, status }, ctx).elegivel, status);
for (const status of ["A_CATALOGAR", "TRIADO", "TESTADO"]) assert.deepStrictEqual(el({ ...ok, status }, ctx).motivos, ["etapa"], status);
for (const status of ["VENDIDO", "ENTREGUE", "DESCARTE"]) assert.deepStrictEqual(el({ ...ok, status }, { ...ctx, reservado: true }).motivos, ["vendido"], status);
assert.deepStrictEqual(el(ok, { fotos: 0 }).motivos, ["sem_foto"]);
assert.deepStrictEqual(el({ ...ok, preco_ideal: 0 }, ctx).motivos, ["sem_preco"]);
assert.deepStrictEqual(el({ ...ok, preco_ideal: null }, ctx).motivos, ["sem_preco"]);
assert.deepStrictEqual(el({ ...ok, estado: null }, ctx).motivos, ["sem_estado"]);
assert.deepStrictEqual(el({ ...ok, grupo: "  " }, ctx).motivos, ["sem_categoria"]);
assert.deepStrictEqual(el(ok, { ...ctx, reservado: true }).motivos, ["reservado"]);
assert.deepStrictEqual(el({ ...ok, preco_ideal: 0, grupo: null }, { fotos: 0, reservado: true }).motivos,
  ["sem_foto", "sem_preco", "sem_categoria", "reservado"]);
console.log("catalogo elegibilidade: ok");
