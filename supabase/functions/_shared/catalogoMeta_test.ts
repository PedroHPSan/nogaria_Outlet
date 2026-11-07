import assert from "node:assert/strict";
import { COLUNAS, condicaoMeta, faixaPreco, linhaCsv, montarFeed, precoPromoFeed, slugMacro } from "./catalogoMeta.ts";

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
  assert.equal(linhas[0].split(",").length, 19);
  assert.ok(linhas[1].includes("'=CMD()"));
  assert.ok(linhas[2].includes('"Tênis, Nike ""Air"""'));
});

Deno.test("C4: faixa de preço e rótulos (categoria, lote, estado, tamanho)", () => {
  assert.deepEqual([50, 50.01, 150, 199.9, 500, 900].map(faixaPreco), ["ate-50", "51-100", "101-150", "151-250", "251-500", "acima-500"]);
  const c = linhaCsv(l({ payload: { itens: [{ ...it, rotulos: { grupo: "Calçados", lote: 12, estado: "BOM", tamanho: "38" } }] } }), "https://x")!;
  assert.deepEqual(c.slice(10, 15), ["Calçados", "lote-12", "151-250", "BOM", "38"]);
  const vazio = linhaCsv(l(), "https://x")!;
  assert.deepEqual(vazio.slice(10), ["", "", "151-250", "", "", "", "", "", ""]);
});

Deno.test("macro-categoria: slug estável e colunas novas no fim (id/link intactos)", () => {
  assert.equal(slugMacro("Casa e Decoração"), "casa-e-decoracao");
  assert.equal(slugMacro("Infantil, Esporte e Lazer"), "infantil-esporte-e-lazer");
  const c = linhaCsv(l({ payload: { itens: [{ ...it, rotulos: { grupo: "Calçados", macro: "Calçados", grupo_norm: "Calçados" } }] } }), "https://outlet.exemplo")!;
  assert.deepEqual(c.slice(15, 17), ["calcados", "Calçados"]);
  assert.equal(c[0], "NOG-103-001");
  assert.equal(c[6], "https://outlet.exemplo/i/NOG-103-001");
});

const JANELA = "2026-11-10T00:00-03:00/2026-11-17T00:00-03:00";
Deno.test("campanha: sale_price e janela entram no FIM das colunas (colunas antigas intactas)", () => {
  assert.deepEqual(COLUNAS.slice(-2), ["sale_price", "sale_price_effective_date"]);
  assert.equal(COLUNAS.indexOf("id"), 0); assert.equal(COLUNAS.indexOf("link"), 6);
  const c = linhaCsv(l({ payload: { itens: [{ ...it, preco: 200, promo: { preco: 150, preco_cheio: 200, ativa: false, janela: JANELA } }] } }), "https://x")!;
  assert.equal(c[5], "200.00 BRL"); assert.equal(c[17], "150.00 BRL"); assert.equal(c[18], JANELA);
});
Deno.test("campanha ativa: price é o 'de' congelado, mesmo se o preço atual mudou", () => {
  const p = precoPromoFeed({ ...it, preco: 240, promo: { preco: 150, preco_cheio: 200, ativa: true, janela: JANELA } });
  assert.deepEqual(p, { price: 200, sale: "150.00 BRL", janela: JANELA });
});
Deno.test("campanha: sale_price >= price é omitido (a Meta rejeitaria) e sem promo as colunas ficam vazias", () => {
  assert.equal(precoPromoFeed({ ...it, preco: 100, promo: { preco: 120, preco_cheio: 100, ativa: false, janela: JANELA } }).sale, "");
  assert.equal(precoPromoFeed({ ...it, preco: 100, promo: { preco: 100, preco_cheio: 100, ativa: false, janela: JANELA } }).sale, "");
  const sem = linhaCsv(l(), "https://x")!;
  assert.deepEqual(sem.slice(17), ["", ""]);
  assert.equal(precoPromoFeed({ ...it, promo: null }).sale, "");
});
