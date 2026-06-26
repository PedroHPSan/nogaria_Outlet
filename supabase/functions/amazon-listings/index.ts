// Edge Function: amazon-listings
// Fetch READ-ONLY das listagens reais do vendedor na Amazon (SP-API searchListingsItems)
// e reconciliação com a tabela `listing_state`. Espelha a auth/token de publicar-amazon.
//
// Secrets (já configurados p/ publicar-amazon): LWA_CLIENT_ID, LWA_CLIENT_SECRET, AMZ_SELLER_ID.
// Auth (verify_jwt off, igual publicar-amazon): bearer == SUPABASE_SERVICE_ROLE_KEY (admin)
//   OU um JWT de usuário logado (quando chamado pela app).
// Body opcional: { reconcile?: boolean }
//   - false (padrão): só LÊ a Amazon e devolve a comparação (não grava nada).
//   - true: faz upsert em listing_state marcando 'publicado' os SKUs encontrados na Amazon
//     que existem em `itens` (não rebaixa os ausentes — só relata).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_ROLE);

// Lê o claim `role` de um JWT sem verificar assinatura (o gateway já validou a apikey).
function jwtRole(t: string): string | null {
  try {
    const p = t.split(".")[1];
    const pad = p + "=".repeat((4 - (p.length % 4)) % 4);
    const payload = JSON.parse(atob(pad.replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role ?? null;
  } catch { return null; }
}

const MARKETPLACE_ID = "A2Q3Y263D00KWC"; // Amazon BR
const SPAPI_BASE = "https://sellingpartnerapi-na.amazon.com"; // BR usa a região NA
const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

// ---- LWA token (cache em amazon_oauth, idêntico a publicar-amazon.getAccessToken) ----
async function getAccessToken(): Promise<string> {
  const { data: row, error } = await admin.from("amazon_oauth").select("*").eq("id", 1).single();
  if (error || !row) throw new Error("amazon_oauth não configurado.");
  const now = Date.now();
  if (row.access_token && row.expires_at && new Date(row.expires_at).getTime() > now + 60_000) return row.access_token;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: row.refresh_token,
    client_id: Deno.env.get("LWA_CLIENT_ID")!,
    client_secret: Deno.env.get("LWA_CLIENT_SECRET")!,
  });
  const r = await fetch(LWA_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const j = await r.json();
  if (!j.access_token) throw new Error("Falha ao renovar token LWA: " + JSON.stringify(j));
  const expires_at = new Date(now + (j.expires_in ?? 3600) * 1000).toISOString();
  await admin.from("amazon_oauth").update({ access_token: j.access_token, expires_at, updated_at: new Date().toISOString() }).eq("id", 1);
  return j.access_token;
}

// ---- searchListingsItems: enumera TODAS as listagens do vendedor (paginado) ----
async function fetchTodasListagens(token: string, sellerId: string) {
  const itens: any[] = [];
  let pageToken: string | undefined;
  for (let guard = 0; guard < 300; guard++) { // trava de segurança: até 300 páginas
    const params = new URLSearchParams({
      marketplaceIds: MARKETPLACE_ID,
      includedData: "summaries,offers,issues,fulfillmentAvailability",
      pageSize: "20",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const url = `${SPAPI_BASE}/listings/2021-08-01/items/${sellerId}?${params.toString()}`;
    const r = await fetch(url, { headers: { "x-amz-access-token": token } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`SP-API ${r.status}: ${JSON.stringify(j).slice(0, 500)}`);
    for (const it of (j.items ?? [])) {
      const s = (it.summaries ?? [])[0] ?? {};
      const off = (it.offers ?? [])[0] ?? {};
      const fa = (it.fulfillmentAvailability ?? [])[0] ?? {};
      itens.push({
        sku: it.sku,
        asin: s.asin ?? null,
        status: s.status ?? [], // ex.: ["BUYABLE","DISCOVERABLE"]
        condicao: s.conditionType ?? null,
        nome: s.itemName ?? null,
        preco: off?.price?.amount != null ? Number(off.price.amount) : null,
        moeda: off?.price?.currencyCode ?? null,
        qtd: fa?.quantity ?? null,
        issues: (it.issues ?? []).length,
      });
    }
    pageToken = j.pagination?.nextToken;
    if (!pageToken) break;
  }
  return itens;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // Auth: service_role (admin/automação) ou usuário logado. O gateway do Supabase já
    // valida a ASSINATURA da apikey antes de rotear; aqui basta conferir o claim `role`
    // (cobre legado JWT e variações de valor do SERVICE_ROLE injetado) ou getUser p/ sessão.
    const bearer = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    let autorizado = !!bearer && (bearer === SERVICE_ROLE || jwtRole(bearer) === "service_role");
    if (!autorizado && bearer) {
      const { data: u } = await admin.auth.getUser(bearer);
      autorizado = !!u?.user;
    }
    if (!autorizado) return json({ error: "não autenticado" }, 401);

    const { reconcile } = (await req.json().catch(() => ({}))) ?? {};
    const sellerId = Deno.env.get("AMZ_SELLER_ID");
    if (!sellerId) return json({ error: "AMZ_SELLER_ID não configurado" }, 500);

    const token = await getAccessToken();
    const amazon = await fetchTodasListagens(token, sellerId);
    const skusAmazon = new Set(amazon.map((a) => a.sku));

    // Estado local: o que listing_state acha que está publicado, e quais SKUs existem em itens.
    const { data: ls } = await admin.from("listing_state").select("sku,estado").eq("canal", "amazon");
    const publicadosLocais = new Set((ls ?? []).filter((r) => r.estado === "publicado").map((r) => r.sku));
    // Checa só os SKUs vindos da Amazon (bounded) — evita o teto de 1000 linhas do select("sku").
    const { data: itensRows } = await admin.from("itens").select("sku").in("sku", [...skusAmazon]);
    const skusItens = new Set((itensRows ?? []).map((r: any) => r.sku));

    // Marca quais SKUs da Amazon existem (ou não) no nosso catálogo.
    for (const a of amazon) a.no_catalogo = skusItens.has(a.sku);

    const so_na_amazon = amazon.filter((a) => !publicadosLocais.has(a.sku)).map((a) => a.sku); // subiu, banco não sabe
    const so_no_banco = [...publicadosLocais].filter((s) => !skusAmazon.has(s)); // banco diz publicado, não achou na Amazon
    const em_ambos = amazon.filter((a) => publicadosLocais.has(a.sku)).map((a) => a.sku);
    const fora_do_catalogo = amazon.filter((a) => !a.no_catalogo).map((a) => a.sku); // na Amazon mas não em itens

    let reconciliados = 0;
    if (reconcile) {
      for (const a of amazon) {
        if (!a.no_catalogo) continue; // FK: só upsert de SKU que existe em itens
        await admin.from("listing_state").upsert({
          sku: a.sku, canal: "amazon", estado: "publicado",
          external_listing_id: a.asin || a.sku, ultimo_erro: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "sku,canal" });
        reconciliados++;
      }
    }

    return json({
      ok: true,
      reconcile: !!reconcile,
      total_amazon: amazon.length,
      total_publicado_local: publicadosLocais.size,
      resumo: {
        em_ambos: em_ambos.length,
        so_na_amazon: so_na_amazon.length,
        so_no_banco: so_no_banco.length,
        fora_do_catalogo: fora_do_catalogo.length,
        compraveis: amazon.filter((a) => (a.status ?? []).includes("BUYABLE")).length,
        so_discoverable: amazon.filter((a) => !(a.status ?? []).includes("BUYABLE")).length,
        com_issues: amazon.filter((a) => a.issues > 0).length,
      },
      so_na_amazon,
      so_no_banco,
      em_ambos,
      fora_do_catalogo,
      reconciliados,
      amazon, // detalhe item a item (sku, asin, status, preço, qtd, condição, issues)
    });
  } catch (e: any) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
