// Catalog Batch API (Meta): marca itens como "out of stock" em segundos (o feed horário é só a reconciliação).
// POST /{catalog_id}/items_batch com requests=[{method:"UPDATE", data:{id:<retailer_id>, availability:"out of stock"}}].
export type OpcoesCatalogo = { catalogId: string; token: string; versao?: string; fetchFn?: typeof fetch };

export async function marcarSemEstoque(skus: string[], o: OpcoesCatalogo): Promise<{ handles: string[] }> {
  if (!skus.length) return { handles: [] };
  const f = o.fetchFn ?? fetch;
  const corpo = new URLSearchParams({
    item_type: "PRODUCT_ITEM",
    requests: JSON.stringify(skus.map((id) => ({ method: "UPDATE", data: { id, availability: "out of stock" } }))),
  });
  const r = await f(`https://graph.facebook.com/${o.versao ?? "v23.0"}/${o.catalogId}/items_batch`, {
    method: "POST", headers: { Authorization: `Bearer ${o.token}`, "Content-Type": "application/x-www-form-urlencoded" }, body: corpo,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Meta catálogo ${r.status}: ${JSON.stringify(j?.error ?? j).slice(0, 300)}`);
  return { handles: (j?.handles ?? []) as string[] };
}
