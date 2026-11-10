// Handlers de retirada de canal (job criado pelo trigger itens_retirar_canais): catalogo.retirar e amazon.quantidade.
// Em dry-run (SYNC_DRY_RUN=1 / AMZ_DRY_RUN=1) só registram no log. Falha NÃO é silenciosa: erro vira retry/`morto` e aparece nos alertas.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { atualizarPrecos, marcarEmEstoque, marcarSemEstoque, type PrecoCatalogo } from "../_shared/metaCatalogo.ts";
import { atualizarQuantidade } from "../_shared/amazon.ts";

type Ctx = { dryRun: boolean; admin: SupabaseClient };

export async function retirarCatalogo(payload: Record<string, unknown>, ctx: Ctx) {
  const sku = String(payload.sku);
  if (ctx.dryRun) { console.log(`[catalogo dry-run] marcaria ${sku} como out of stock`); return; }
  const token = Deno.env.get("META_CATALOG_TOKEN"), catalogId = Deno.env.get("META_CATALOG_ID");
  if (!token || !catalogId) {
    // Sem credencial a retirada imediata não é possível; o feed (disponibilidade ao vivo) retira em até 1 h.
    console.warn(`catalogo.retirar ${sku}: META_CATALOG_TOKEN/META_CATALOG_ID ausentes — o feed retira em até 1 h`);
    return;
  }
  await marcarSemEstoque([sku], { catalogId, token, versao: Deno.env.get("META_API_VERSION") ?? undefined });
}

// Reserva liberada/expirada e a peça voltou a ficar disponível: devolve "in stock" (o feed reconcilia de qualquer forma).
export async function reporCatalogo(payload: Record<string, unknown>, ctx: Ctx) {
  const sku = String(payload.sku);
  if (ctx.dryRun) { console.log(`[catalogo dry-run] marcaria ${sku} como in stock`); return; }
  const token = Deno.env.get("META_CATALOG_TOKEN"), catalogId = Deno.env.get("META_CATALOG_ID");
  if (!token || !catalogId) { console.warn(`catalogo.repor ${sku}: META_CATALOG_TOKEN/META_CATALOG_ID ausentes — o feed repõe em até 1 h`); return; }
  await marcarEmEstoque([sku], { catalogId, token, versao: Deno.env.get("META_API_VERSION") ?? undefined });
}

// Preço/promoção mudou (ficha, campanha publicada/encerrada, peça incluída/removida): empurra o preço ATUAL para a Meta.
// O estado é lido na hora de executar (RPC catalogo_meta_preco, mesma regra do feed); o feed de hora em hora reconcilia.
export async function precoCatalogo(payload: Record<string, unknown>, ctx: Ctx) {
  const skus = ((payload.skus ?? []) as unknown[]).map(String);
  if (!skus.length) return;
  if (ctx.dryRun) { console.log(`[catalogo dry-run] atualizaria o preço de ${skus.length} peça(s) na Meta`); return; }
  const token = Deno.env.get("META_CATALOG_TOKEN"), catalogId = Deno.env.get("META_CATALOG_ID");
  if (!token || !catalogId) { console.warn(`catalogo.preco (${skus.length} peças): META_CATALOG_TOKEN/META_CATALOG_ID ausentes — o feed atualiza em até 1 h`); return; }
  const { data, error } = await ctx.admin.rpc("catalogo_meta_preco", { p_skus: skus });
  if (error) throw new Error(`catalogo_meta_preco: ${error.message}`);
  const itens = ((data ?? []) as Record<string, unknown>[]).map((r): PrecoCatalogo => ({
    sku: String(r.sku), price: Number(r.price),
    sale_price: r.sale_price == null ? null : Number(r.sale_price), janela: r.janela == null ? null : String(r.janela),
  }));
  await atualizarPrecos(itens, { catalogId, token, versao: Deno.env.get("META_API_VERSION") ?? undefined });
}

async function tokenLwa(admin: SupabaseClient): Promise<string> {
  const { data: row, error } = await admin.from("amazon_oauth").select("*").eq("id", 1).single();
  if (error || !row) throw new Error("amazon_oauth não configurado.");
  if (row.access_token && row.expires_at && new Date(row.expires_at).getTime() > Date.now() + 60_000) return row.access_token;
  const r = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token", refresh_token: row.refresh_token,
      client_id: Deno.env.get("LWA_CLIENT_ID")!, client_secret: Deno.env.get("LWA_CLIENT_SECRET")!,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error("Falha ao renovar o token LWA da Amazon.");
  await admin.from("amazon_oauth").update({
    access_token: j.access_token, expires_at: new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", 1);
  return j.access_token;
}

export async function amazonQuantidade(payload: Record<string, unknown>, ctx: Ctx) {
  const sku = String(payload.sku), quantidade = Number(payload.quantidade ?? 0);
  if (ctx.dryRun || Deno.env.get("AMZ_DRY_RUN") === "1") { console.log(`[amazon dry-run] quantidade de ${sku} = ${quantidade}`); return; }
  const sellerId = Deno.env.get("AMZ_SELLER_ID");
  if (!sellerId) throw new Error("AMZ_SELLER_ID ausente");
  const r = await atualizarQuantidade(sku, quantidade, { token: await tokenLwa(ctx.admin), sellerId });
  await ctx.admin.from("listing_state").update({
    estado: quantidade === 0 ? "pausado" : "publicado", quantidade_publicada: quantidade,
    pausado_motivo: quantidade === 0 ? String(payload.motivo ?? "vendido") : null, ultimo_erro: null,
    sync_em: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("sku", sku).eq("canal", "amazon");
  if (r.ausente) console.warn(`amazon.quantidade ${sku}: a Amazon não conhece o SKU (já fora do ar)`);
}
