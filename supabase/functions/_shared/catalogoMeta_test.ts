import assert from "node:assert/strict";
import { condicaoMeta, linhaCsv, montarFeed } from "./catalogoMeta.ts";

const it = { sku: "NOG-103-001", produto: "Tênis, Nike \"Air\"", marca: "Nike", cor: "Preto", condicao: "Usado em ótimo estado", medidas: "", badge: { cls: "semi" }, preco: 199.9, foto: "https://x/f.jpg" };
const l = (o = {}) => ({ sku: it.sku, payload: { itens: [it] }, disponivel: true, ...o });

Deno.test("linha do feed: campos, preço e link", () => {
  const c = linhaCsv(l(), "https://outlet.exemplo/")!;
  assert.equal(c[0], "NOG-103-001");
  assert.equal(c[3], "in stock");
  assert.equal(c[4], "used");
  assert.equal(c[5], "199.90 BRL");
  assert.equal(c[6], "https://outlet.exemplo/i/NOG-103-001");
  assert.equal(linhaCsv(l({ disponivel: false }), "https://x")![3], "out of stock");
});
Deno.test("condição: novo → new, resto → used", () => {
  assert.equal(condicaoMeta({ ...it, badge: { cls: "novo" } }), "new");
  assert.equal(condicaoMeta({ ...it, badge: null }), "used");
});
Deno.test("sem foto ou sem preço é ignorado (a Meta rejeitaria)", () => {
  assert.equal(linhaCsv(l({ payload: { itens: [{ ...it, foto: null }] } }), "https://x"), null);
  assert.equal(linhaCsv(l({ payload: { itens: [{ ...it, preco: 0 }] } }), "https://x"), null);
  const f = montarFeed([l(), l({ sku: "NOG-9", payload: { itens: [{ ...it, sku: "NOG-9", foto: null }] } })], "https://x");
  assert.equal(f.total, 1); assert.deepEqual(f.ignorados, ["NOG-9"]);
});
Deno.test("CSV: aspas/vírgula escapadas e fórmula neutralizada", () => {
  const f = montarFeed([l({ payload: { itens: [{ ...it, produto: "=CMD()" }] } }), l()], "https://x");
  const linhas = f.csv.trim().split("\n");
  assert.equal(linhas[0].split(",").length, 10);
  assert.ok(linhas[1].includes("'=CMD()"));
  assert.ok(linhas[2].includes('"Tênis, Nike ""Air"""'));
});
