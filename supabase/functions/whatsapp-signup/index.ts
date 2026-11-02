// Edge Function: whatsapp-signup — conclui o Cadastro Incorporado do WhatsApp (coexistência com o app WhatsApp Business).
// A página do app (admin logado) abre a janela da Meta e envia { code, waba_id, phone_number_id }. Aqui: troca o code por token
// (precisa do segredo do app, que NUNCA vai ao navegador), assina os webhooks da conta, pede a sincronização de contatos/histórico
// e grava a conexão em whatsapp_oauth. O token não volta na resposta.
// Secrets: WHATSAPP_APP_SECRET (obrigatório), WHATSAPP_APP_ID (opcional; padrão = app Nogaria Outlet), WHATSAPP_API_VERSION.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const APP_ID = Deno.env.get("WHATSAPP_APP_ID") ?? "1737544261422773";
const API = `https://graph.facebook.com/${Deno.env.get("WHATSAPP_API_VERSION") ?? "v23.0"}`;
const ID = /^\d{5,30}$/;

// Remove tokens/segredos de qualquer texto antes de devolver ou logar.
const redigir = (t: string) => t.replace(/(access_token|client_secret|code)=[^&\s"']+/gi, "$1=***").replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***").replace(/\bEA[A-Za-z0-9]{20,}\b/g, "***");

async function graph(caminho: string, token: string, corpo?: Record<string, unknown>) {
  const r = await fetch(`${API}${caminho}`, {
    method: corpo ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, ...(corpo ? { "Content-Type": "application/json" } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(redigir(`Meta ${r.status}: ${JSON.stringify(j?.error ?? j).slice(0, 300)}`));
  return j as Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "método não permitido" }, 405);
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ error: "não autenticado" }, 401);

    const { code, waba_id, phone_number_id } = (await req.json().catch(() => ({}))) ?? {};
    if (typeof code !== "string" || !code || !ID.test(String(waba_id)) || !ID.test(String(phone_number_id))) return json({ error: "dados do cadastro inválidos" }, 400);
    const secret = Deno.env.get("WHATSAPP_APP_SECRET");
    if (!secret) return json({ error: "WHATSAPP_APP_SECRET não configurado nas funções" }, 500);

    // 1) code → token (POST: o segredo vai no corpo, não na URL)
    const tr = await fetch(`${API}/oauth/access_token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: APP_ID, client_secret: secret, code }),
    });
    const tj = await tr.json().catch(() => ({}));
    if (!tr.ok || !tj.access_token) return json({ error: redigir(`Meta recusou o código: ${JSON.stringify(tj?.error ?? tj).slice(0, 200)}`) }, 502);
    const token = String(tj.access_token);
    const expira = tj.expires_in ? new Date(Date.now() + Number(tj.expires_in) * 1000).toISOString() : null;

    // 2) assina o app nos webhooks da conta (mensagens, statuses e, na coexistência, ecos/sincronização)
    await graph(`/${waba_id}/subscribed_apps`, token, {});
    // 3) dados do número para exibir
    const ph = await graph(`/${phone_number_id}?fields=display_phone_number,verified_name`, token).catch(() => ({} as Record<string, unknown>));
    // 4) coexistência: pede contatos e histórico (a Meta só aceita nas primeiras 24 h do cadastro)
    const sync = async (tipo: string) => {
      try { await graph(`/${phone_number_id}/smb_app_data`, token, { messaging_product: "whatsapp", sync_type: tipo }); return "ok"; }
      catch (e) { return `erro: ${(e as Error).message}`.slice(0, 200); }
    };
    const [sc, sh] = [await sync("smb_app_state_sync"), await sync("history")];

    const { error } = await admin.from("whatsapp_oauth").upsert({
      id: 1, waba_id: String(waba_id), phone_number_id: String(phone_number_id),
      display_phone: (ph.display_phone_number as string) ?? null, verified_name: (ph.verified_name as string) ?? null,
      access_token: token, expires_at: expira, sync_contatos: sc, sync_historico: sh, updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    await admin.from("eventos").insert({ sku: null, acao: "whatsapp:conectado", usuario: u.user.email ?? null, detalhe: `waba ${waba_id}, número ${phone_number_id}` }).then(() => {}, () => {});
    return json({ ok: true, waba_id, phone_number_id, display_phone: ph.display_phone_number ?? null, verified_name: ph.verified_name ?? null, sync_contatos: sc, sync_historico: sh });
  } catch (e) {
    console.error("whatsapp-signup:", redigir(String((e as Error)?.message ?? e)));
    return json({ error: redigir(String((e as Error)?.message ?? e)) }, 500);
  }
});
