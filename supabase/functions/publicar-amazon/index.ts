// Edge Function: publicar-amazon
// Publica um item na Amazon via SP-API Listings Items (modo OFERTA), após revisão
// humana no cliente. O SERVIDOR é a autoridade: re-valida o pre-flight (preço/banda/
// GTIN) antes de chamar a Amazon. Idempotência via tabela `listing_state` (sku,canal).
//
// Espelha o estilo de enriquecer-produto/precos-mercado (cors, json, admin, getUser;
// refresh de token OAuth como o getAccessToken do ML). `verify_jwt` off (auth na função).
//
// Secrets (produção — NÃO setar nesta tarefa): LWA_CLIENT_ID, LWA_CLIENT_SECRET,
//   AMZ_SELLER_ID, AMZ_DRY_RUN. Com AMZ_DRY_RUN=1 devolve o payload SEM chamar a Amazon.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const MARKETPLACE_ID = "A2Q3Y263D00KWC"; // Amazon BR
const SPAPI_BASE = "https://sellingpartnerapi-na.amazon.com"; // BR usa a região NA
const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

// ---- pre-flight (espelha src/lib/marketplace/preflight.js) ----
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
function gtinValido(g: unknown) {
  const s = String(g ?? "").trim().toUpperCase();
  if (/^\d{13}$/.test(s)) return { ok: true, tipo: "EAN", valor: s };
  if (/^\d{12}$/.test(s)) return { ok: true, tipo: "UPC", valor: s };
  if (/^\d{14}$/.test(s)) return { ok: true, tipo: "GTIN", valor: s };
  if (/^[A-Z0-9]{10}$/.test(s) && /[A-Z]/.test(s)) return { ok: true, tipo: "ASIN", valor: s };
  return { ok: false, tipo: null as string | null, valor: null as string | null };
}
function bandaPreco(it: any, min = 0.4, max = 2.5) {
  const p = num(it?.preco_ideal), ref = num(it?.preco_ref_novo);
  if (p == null || ref == null || ref <= 0) return { ok: true, ratio: null as number | null };
  const ratio = p / ref;
  return { ok: ratio >= min && ratio <= max, ratio };
}
function preflightAmazon(it: any) {
  const gv = gtinValido(it?.gtin);
  const banda = bandaPreco(it);
  const temPreco = (num(it?.preco_ideal) ?? 0) > 0;
  const erros: { bucket: string; msg: string }[] = [];
  if (!temPreco) erros.push({ bucket: "PREFLIGHT", msg: "Sem preço de venda (preco_ideal > 0)." });
  if (!banda.ok) erros.push({ bucket: "PREFLIGHT", msg: `Preço fora da faixa de sanidade (${banda.ratio?.toFixed(2)}× a referência).` });
  if (!gv.ok) erros.push({ bucket: "PREFLIGHT", msg: "GTIN/EAN/UPC/ASIN inválido." });
  return { ok: erros.length === 0, erros, idProduto: gv.ok ? { tipo: gv.tipo!, valor: gv.valor! } : null };
}

// ---- payload (espelha src/lib/marketplace/amazonPayload.js) ----
function condicaoListings(estado: string, condEmb?: string) {
  const caixaAvariada = condEmb && condEmb !== "PERFEITA";
  switch (estado) {
    case "Novo": return caixaAvariada ? "used_like_new" : "new_new";
    case "Embalagem aberta/avariada": return "used_like_new";
    case "Usado":
    case "Usado funcionando": return "used_good";
    case "Usado sem teste": return "used_acceptable";
    case "Avariado": return "used_acceptable";
    default: return "used_good";
  }
}
function montarPayload(item: any, idProduto: { tipo: string; valor: string }) {
  const preco = Number(item.preco_ideal);
  const qtd = Number(item.quantidade) > 0 ? Number(item.quantidade) : 1;
  const attributes: any = {
    condition_type: [{ marketplace_id: MARKETPLACE_ID, value: condicaoListings(item.estado, item.cond_embalagem) }],
    purchasable_offer: [{ marketplace_id: MARKETPLACE_ID, currency: "BRL", our_price: [{ schedule: [{ value_with_tax: preco }] }] }],
    fulfillment_availability: [{ fulfillment_channel_code: "DEFAULT", quantity: qtd }],
  };
  if (idProduto.tipo === "ASIN") attributes.merchant_suggested_asin = [{ marketplace_id: MARKETPLACE_ID, value: idProduto.valor }];
  else attributes.externally_assigned_product_identifier = [{ marketplace_id: MARKETPLACE_ID, type: idProduto.tipo.toLowerCase(), value: idProduto.valor }];
  return { productType: "PRODUCT", requirements: "LISTING_OFFER_ONLY", attributes };
}

// ---- tradução de issues da Amazon ----
const ERROS: Record<string, { bucket: string; msg: string }> = {
  "13013": { bucket: "ATRIBUTO", msg: "Atributo obrigatório faltando." },
  "8058": { bucket: "MARCA", msg: "Sem permissão para listar esta marca/categoria (gated)." },
  "8560": { bucket: "GTIN", msg: "Produto não encontrado pelo identificador." },
  "8684": { bucket: "GTIN", msg: "GTIN/EAN inválido." },
  "18299": { bucket: "PRECO", msg: "Preço fora da política da Amazon." },
  "18749": { bucket: "IMAGEM", msg: "Imagem principal obrigatória/inválida." },
  "5461": { bucket: "MARCA", msg: "Restrição de marca (Brand Registry)." },
  "18503": { bucket: "CATEGORIA", msg: "Categoria exige aprovação." },
  "18653": { bucket: "CONDICAO", msg: "Condição inválida para a oferta." },
  "90188": { bucket: "GTIN", msg: "Identificador já associado a outro ASIN." },
  "90226": { bucket: "ATRIBUTO", msg: "Valor de atributo inválido." },
  "18555": { bucket: "DUPLICADO", msg: "SKU já existe / oferta duplicada." },
  "18320": { bucket: "ESTOQUE", msg: "Quantidade/fulfillment inválido." },
  "18329": { bucket: "PRECO", msg: "Preço ou moeda inválidos." },
};
const traduzErro = (code: unknown, fallback = "Erro da Amazon.") =>
  ERROS[String(code ?? "").trim()] || { bucket: "DESCONHECIDO", msg: fallback };

// ---- LWA token (cache em amazon_oauth, espelha precos-mercado.getAccessToken) ----
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

async function salvarEstado(sku: string, patch: Record<string, unknown>) {
  try {
    await admin.from("listing_state").upsert(
      { sku, canal: "amazon", updated_at: new Date().toISOString(), ...patch },
      { onConflict: "sku,canal" },
    );
  } catch { /* best-effort (ex.: tabela ainda não migrada localmente) */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ error: "não autenticado" }, 401);

    const { sku, acao } = (await req.json()) ?? {};
    if (!sku) return json({ error: "informe o sku" }, 400);

    const { data: item } = await admin.from("itens").select("*").eq("sku", sku).single();
    if (!item) return json({ error: "item não encontrado" }, 404);

    if (acao === "pausar") {
      await salvarEstado(sku, { estado: "pausado" });
      return json({ ok: true, estado: "pausado" });
    }

    // Pre-flight no servidor (autoridade).
    const pf = preflightAmazon(item);
    if (!pf.ok) {
      await salvarEstado(sku, { estado: "erro", ultimo_erro: pf.erros.map((e) => e.msg).join("; ") });
      return json({ ok: false, estado: "erro", erros: pf.erros });
    }

    const payload = montarPayload(item, pf.idProduto!);

    if (Deno.env.get("AMZ_DRY_RUN") === "1") {
      await salvarEstado(sku, { estado: "publicando", payload });
      return json({ ok: true, dry_run: true, estado: "publicando", modo: "oferta", payload });
    }

    // Caso real.
    await salvarEstado(sku, { estado: "publicando", payload });
    const token = await getAccessToken();
    const sellerId = Deno.env.get("AMZ_SELLER_ID")!;
    const url = `${SPAPI_BASE}/listings/2021-08-01/items/${sellerId}/${encodeURIComponent(sku)}?marketplaceIds=${MARKETPLACE_ID}`;
    const r = await fetch(url, {
      method: "PUT",
      headers: { "x-amz-access-token": token, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    const issues = (j.issues ?? []).filter((i: any) => i.severity === "ERROR");
    if (!r.ok || issues.length) {
      const erros = (issues.length ? issues : [{ code: r.status }]).map((i: any) => ({ code: i.code, ...traduzErro(i.code, i.message) }));
      await salvarEstado(sku, { estado: "erro", ultimo_erro: erros.map((e) => e.msg).join("; "), payload });
      return json({ ok: false, estado: "erro", erros });
    }
    const external = j.sku || sku;
    await salvarEstado(sku, { estado: "publicado", external_listing_id: external, ultimo_erro: null, payload });
    return json({ ok: true, estado: "publicado", external_listing_id: external, modo: "oferta" });
  } catch (e: any) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
