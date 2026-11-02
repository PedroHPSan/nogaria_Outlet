// SP-API (Amazon BR): zera/ajusta a quantidade de uma oferta (Listings Items PATCH). Pura: recebe token e fetch.
const SPAPI_BASE = "https://sellingpartnerapi-na.amazon.com"; // BR usa a região NA
const MARKETPLACE_ID = "A2Q3Y263D00KWC";

export type OpcoesAmazon = { token: string; sellerId: string; fetchFn?: typeof fetch };

// Devolve { ausente: true } quando a Amazon não conhece o SKU (404): já não está à venda, nada a fazer.
export async function atualizarQuantidade(sku: string, quantidade: number, o: OpcoesAmazon): Promise<{ ausente: boolean; status?: string }> {
  const f = o.fetchFn ?? fetch;
  const url = `${SPAPI_BASE}/listings/2021-08-01/items/${encodeURIComponent(o.sellerId)}/${encodeURIComponent(sku)}?marketplaceIds=${MARKETPLACE_ID}`;
  const r = await f(url, {
    method: "PATCH",
    headers: { "x-amz-access-token": o.token, "content-type": "application/json" },
    body: JSON.stringify({
      productType: "PRODUCT",
      patches: [{ op: "replace", path: "/attributes/fulfillment_availability", value: [{ fulfillment_channel_code: "DEFAULT", quantity: quantidade }] }],
    }),
  });
  if (r.status === 404) return { ausente: true };
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Amazon ${r.status}: ${JSON.stringify(j?.errors ?? j).slice(0, 300)}`);
  if (j?.status === "INVALID") throw new Error(`Amazon recusou o ajuste de quantidade: ${JSON.stringify(j?.issues ?? []).slice(0, 300)}`);
  return { ausente: false, status: j?.status };
}
