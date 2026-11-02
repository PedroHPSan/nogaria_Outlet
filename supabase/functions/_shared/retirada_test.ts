import assert from "node:assert/strict";
import { marcarSemEstoque } from "./metaCatalogo.ts";
import { atualizarQuantidade } from "./amazon.ts";
import { mensagemVendido } from "./instagram.ts";

const resp = (corpo: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(corpo), { status }));

Deno.test("catálogo Meta: items_batch UPDATE com availability out of stock", async () => {
  let url = "", corpo: URLSearchParams | undefined, auth = "";
  const fetchFn = ((u: string, init: RequestInit) => { url = u; corpo = init.body as URLSearchParams; auth = (init.headers as Record<string, string>).Authorization; return resp({ handles: ["h1"] }); }) as unknown as typeof fetch;
  const r = await marcarSemEstoque(["NOG-1-1", "NOG-1-2"], { catalogId: "CAT1", token: "T", fetchFn });
  assert.equal(url, "https://graph.facebook.com/v23.0/CAT1/items_batch");
  assert.equal(auth, "Bearer T");
  assert.equal(corpo!.get("item_type"), "PRODUCT_ITEM");
  assert.deepEqual(JSON.parse(corpo!.get("requests")!), [
    { method: "UPDATE", data: { id: "NOG-1-1", availability: "out of stock" } },
    { method: "UPDATE", data: { id: "NOG-1-2", availability: "out of stock" } }]);
  assert.deepEqual(r.handles, ["h1"]);
  assert.deepEqual((await marcarSemEstoque([], { catalogId: "C", token: "T", fetchFn })).handles, []);
});

Deno.test("catálogo Meta: erro HTTP vira exceção legível", async () => {
  const fetchFn = (() => resp({ error: { message: "token inválido" } }, 400)) as unknown as typeof fetch;
  await assert.rejects(marcarSemEstoque(["X"], { catalogId: "C", token: "T", fetchFn }), /Meta catálogo 400.*token inválido/);
});

Deno.test("Amazon: PATCH da quantidade para 0 no SKU certo, com productType e o caminho do atributo", async () => {
  let url = "", metodo = "", corpo: any, hdr: Record<string, string> = {};
  const fetchFn = ((u: string, init: RequestInit) => { url = u; metodo = init.method!; corpo = JSON.parse(init.body as string); hdr = init.headers as Record<string, string>; return resp({ status: "ACCEPTED" }); }) as unknown as typeof fetch;
  const r = await atualizarQuantidade("NOG-001-003", 0, { token: "TOK", sellerId: "SELLER", fetchFn });
  assert.equal(metodo, "PATCH");
  assert.ok(url.includes("/listings/2021-08-01/items/SELLER/NOG-001-003") && url.includes("marketplaceIds=A2Q3Y263D00KWC"));
  assert.equal(hdr["x-amz-access-token"], "TOK");
  assert.equal(corpo.productType, "PRODUCT");
  assert.deepEqual(corpo.patches[0], { op: "replace", path: "/attributes/fulfillment_availability", value: [{ fulfillment_channel_code: "DEFAULT", quantity: 0 }] });
  assert.deepEqual(r, { ausente: false, status: "ACCEPTED" });
});

Deno.test("Amazon: 404 = já fora do ar (ok); 4xx/INVALID falham alto", async () => {
  const f404 = (() => resp({ errors: [{ code: "NOT_FOUND" }] }, 404)) as unknown as typeof fetch;
  assert.deepEqual(await atualizarQuantidade("X", 0, { token: "T", sellerId: "S", fetchFn: f404 }), { ausente: true });
  const f403 = (() => resp({ errors: [{ code: "Unauthorized" }] }, 403)) as unknown as typeof fetch;
  await assert.rejects(atualizarQuantidade("X", 0, { token: "T", sellerId: "S", fetchFn: f403 }), /Amazon 403/);
  const inv = (() => resp({ status: "INVALID", issues: [{ code: "90226" }] })) as unknown as typeof fetch;
  await assert.rejects(atualizarQuantidade("X", 0, { token: "T", sellerId: "S", fetchFn: inv }), /recusou/);
});

Deno.test("comentário do Instagram: vendido x indisponível", () => {
  assert.equal(mensagemVendido("NOG-1"), "NOG-1 VENDIDO ✅");
  assert.equal(mensagemVendido("NOG-1", "vendido"), "NOG-1 VENDIDO ✅");
  assert.equal(mensagemVendido("NOG-1", "indisponivel"), "NOG-1 INDISPONÍVEL");
});
