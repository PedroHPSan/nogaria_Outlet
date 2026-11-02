// Edge Function: whatsapp-webhook — webhook da WhatsApp Cloud API (inbox).
// GET: verificação da Meta (hub.challenge). POST: valida X-Hub-Signature-256, grava o corpo na inbox
// `webhook_eventos` (external_id = sha256 do corpo; reenvio da Meta é ignorado) e responde 200.
// O processamento (reservas, respostas, custos) é do worker: handler `processar.whatsapp`.
// Secrets: WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN. Publicar SEM verify_jwt (ver config.toml).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { desafioMeta, registrarEvento, resposta, sha256Hex, verificarAssinaturaMeta } from "../_shared/webhook.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  if (req.method === "GET") {
    const c = desafioMeta(new URL(req.url), Deno.env.get("WHATSAPP_VERIFY_TOKEN"));
    return c === null ? resposta({ error: "verificação negada" }, 403) : new Response(c, { status: 200 });
  }
  if (req.method !== "POST") return resposta({ error: "método não permitido" }, 405);

  const corpo = await req.text();
  if (!(await verificarAssinaturaMeta(corpo, req.headers.get("x-hub-signature-256"), Deno.env.get("WHATSAPP_APP_SECRET")))) {
    return resposta({ error: "assinatura inválida" }, 403);
  }
  let payload: unknown;
  try { payload = JSON.parse(corpo); } catch { return resposta({ error: "corpo inválido" }, 400); }

  try {
    const r = await registrarEvento(admin as never, { canal: "whatsapp", externalId: await sha256Hex(corpo), topico: "whatsapp_business_account", payload });
    return resposta({ received: true, duplicado: r.duplicado });
  } catch (e) {
    console.error("whatsapp-webhook:", e);
    return resposta({ error: "falha ao registrar" }, 500); // a Meta reenvia
  }
});
