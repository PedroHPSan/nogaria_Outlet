import assert from "node:assert/strict";
import { idemKeyEnvio, numeroWa, paramsEvento, previa } from "./waTemplates.ts";

const s = { codigo: "ORC-0007", cliente_nome: "Ana\nSilva", total: 140, validade: "2026-11-05T15:00:00Z",
  itens: [{ sku: "NOG-103-001", produto: "Fone" }, { sku: "NOG-103-002", produto: "Cabo" }] };

Deno.test("cobrança: parâmetros sem quebra de linha e prévia preenchida", () => {
  const p = paramsEvento("cobranca", s);
  assert.equal(p[0], "Ana Silva");
  assert.equal(p[1], "ORC-0007");
  assert.equal(p[2], "2 itens: Fone (NOG-103-001), Cabo (NOG-103-002)");
  assert.match(p[3], /140,00/);
  assert.equal(p[4], "05/11");
  assert.ok(p.every((x) => !/[\n\t]/.test(x)));
  assert.match(previa("cobranca", p), /^Olá, Ana Silva! Sua reserva da sacola ORC-0007 está confirmada: 2 itens/);
});
Deno.test("pago e entrega", () => {
  assert.deepEqual(paramsEvento("entrega", s), ["Ana Silva", "ORC-0007"]);
  assert.match(previa("pago", paramsEvento("pago", s)), /sacola ORC-0007 \(.*140,00\)/);
  assert.equal(paramsEvento("entrega", { ...s, cliente_nome: null })[0], "cliente");
});
Deno.test("resumo longo é truncado em 150", () => {
  const muitos = Array.from({ length: 30 }, (_, i) => ({ sku: `NOG-103-${String(i).padStart(3, "0")}`, produto: "Produto longo" }));
  assert.ok(paramsEvento("cobranca", { ...s, itens: muitos })[2].length <= 150);
});
Deno.test("numeroWa e idem", () => {
  assert.equal(numeroWa("(91) 98888-7777"), "5591988887777");
  assert.equal(numeroWa("+55 91 98888-7777"), "5591988887777");
  assert.equal(numeroWa("12345"), null);
  assert.equal(numeroWa(null), null);
  assert.equal(idemKeyEnvio("sacola", "ORC-1", "pago"), "wa:sacola:ORC-1:pago");
});
