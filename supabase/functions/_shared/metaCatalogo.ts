// Catalog Batch API (Meta): marca itens como "out of stock" em segundos (o feed horário é só a reconciliação).
// POST /{catalog_id}/items_batch com requests=[{method:"UPDATE", data:{id:<retailer_id>, availability:"out of stock"}}].
export type OpcoesCatalogo = { catalogId: string; token: string; versao?: string; fetchFn?: typeof fetch };

export type Disponibilidade = "in stock" | "out of stock";

export async function marcarDisponibilidade(skus: string[], availability: Disponibilidade, o: OpcoesCatalogo): Promise<{ handles: string[] }> {
  if (!skus.length) return { handles: [] };
  const f = o.fetchFn ?? fetch;
  const corpo = new URLSearchParams({
    item_type: "PRODUCT_ITEM",
    requests: JSON.stringify(skus.map((id) => ({ method: "UPDATE", data: { id, availability } }))),
  });
  const r = await f(`https://graph.facebook.com/${o.versao ?? "v23.0"}/${o.catalogId}/items_batch`, {
    method: "POST", headers: { Authorization: `Bearer ${o.token}`, "Content-Type": "application/x-www-form-urlencoded" }, body: corpo,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Meta catálogo ${r.status}: ${JSON.stringify(j?.error ?? j).slice(0, 300)}`);
  return { handles: (j?.handles ?? []) as string[] };
}

export const marcarSemEstoque = (skus: string[], o: OpcoesCatalogo) => marcarDisponibilidade(skus, "out of stock", o);
export const marcarEmEstoque = (skus: string[], o: OpcoesCatalogo) => marcarDisponibilidade(skus, "in stock", o);

// Preço e promoção em segundos (mesma regra do feed): price = "de" (preço cheio com campanha ativa), sale_price + janela da promo.
// Sem promoção, `sale_price`/`sale_price_effective_date` vão `null` (a Meta só altera os campos enviados; null encerra a promoção).
export type PrecoCatalogo = { sku: string; price: number; sale_price: number | null; janela: string | null };

export const fmtBrl = (v: number) => `${Number(v).toFixed(2)} BRL`;

export async function atualizarPrecos(itens: PrecoCatalogo[], o: OpcoesCatalogo): Promise<{ handles: string[] }> {
  if (!itens.length) return { handles: [] };
  const f = o.fetchFn ?? fetch;
  const corpo = new URLSearchParams({
    item_type: "PRODUCT_ITEM",
    requests: JSON.stringify(itens.map((i) => ({
      method: "UPDATE",
      data: {
        id: i.sku, price: fmtBrl(i.price),
        sale_price: i.sale_price && i.janela ? fmtBrl(i.sale_price) : null,
        sale_price_effective_date: i.sale_price && i.janela ? i.janela : null,
      },
    }))),
  });
  const r = await f(`https://graph.facebook.com/${o.versao ?? "v23.0"}/${o.catalogId}/items_batch`, {
    method: "POST", headers: { Authorization: `Bearer ${o.token}`, "Content-Type": "application/x-www-form-urlencoded" }, body: corpo,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Meta catálogo ${r.status}: ${JSON.stringify(j?.error ?? j).slice(0, 300)}`);
  return { handles: (j?.handles ?? []) as string[] };
}
