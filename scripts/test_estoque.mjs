// Estoque ativo: VENDIDO/ENTREGUE/DESCARTE ficam fora do estoque e das caixas.
// Garante a fonte única (model.js) e que catálogo continua com o mesmo conjunto
// após a consolidação (portfolio.js não é testado aqui pois puxa o cliente
// supabase e sua lista é privada — deriva da mesma constante).
import assert from "node:assert";
import { STATUS_FORA_ESTOQUE, STATUS_FORA_ESTOQUE_IN, foraDoEstoque } from "../src/lib/model.js";
import { CATALOGO_STATUS_EXCLUIR } from "../src/lib/catalogoCore.js";

const asSet = (arr) => new Set(arr);
const mesmoConjunto = (a, b) =>
  a.length === b.length && a.every((x) => asSet(b).has(x));

// 1) Conjunto central é exatamente VENDIDO, ENTREGUE, DESCARTE.
{
  assert.ok(mesmoConjunto(STATUS_FORA_ESTOQUE, ["VENDIDO", "ENTREGUE", "DESCARTE"]),
    `STATUS_FORA_ESTOQUE inesperado: ${STATUS_FORA_ESTOQUE.join(",")}`);
}

// 2) foraDoEstoque: true p/ os três; false p/ estoque ativo.
{
  for (const s of ["VENDIDO", "ENTREGUE", "DESCARTE"]) {
    assert.equal(foraDoEstoque(s), true, `${s} deveria estar fora do estoque`);
  }
  for (const s of ["A_CATALOGAR", "PRONTO", "ANUNCIADO"]) {
    assert.equal(foraDoEstoque(s), false, `${s} deveria contar como estoque`);
  }
}

// 3) Helper para PostgREST (.not("status","in", ...)) bem formado.
{
  assert.equal(STATUS_FORA_ESTOQUE_IN, `(${STATUS_FORA_ESTOQUE.join(",")})`);
  assert.ok(STATUS_FORA_ESTOQUE_IN.startsWith("(") && STATUS_FORA_ESTOQUE_IN.endsWith(")"));
}

// 4) Catálogo continua representando o mesmo conjunto (pós-consolidação).
{
  assert.ok(mesmoConjunto(CATALOGO_STATUS_EXCLUIR, STATUS_FORA_ESTOQUE),
    `CATALOGO_STATUS_EXCLUIR divergiu: ${CATALOGO_STATUS_EXCLUIR.join(",")}`);
}

console.log("test_estoque OK");
