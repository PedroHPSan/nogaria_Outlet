// Edge Function: ml-notifications — webhook do Mercado Livre (inbox).
// O ML faz POST a cada evento (orders_v2, items...). Validamos a origem (application_id + user_id),
// gravamos em `webhook_eventos` (idempotente) e respondemos 200 rápido; o worker processa.
// Secrets: ML_APP_ID, ML_USER_ID (sem eles todo POST é recusado). Publicar SEM verify_jwt:
//   supabase functions deploy ml-notifications --no-verify-jwt
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { idExternoML, registrarEvento, resposta, validarOrigemML, type EventoML } from "../_shared/webhook.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  // Validação inicial do DevCenter costuma ser um GET — responde 200.
  if (req.method === "GET") return new Response("ok", { status: 200 });
  if (req.method !== "POST") return resposta({ error: "método não permitido" }, 405);

  const evt = (await req.json().catch(() => null)) as EventoML | null;
  const origemOk = validarOrigemML(evt, { applicationId: Deno.env.get("ML_APP_ID"), userId: Deno.env.get("ML_USER_ID") });
  if (!origemOk || !evt) return resposta({ error: "origem inválida" }, 403);

  try {
    const r = await registrarEvento(admin as never, { canal: "mercadolivre", externalId: idExternoML(evt), topico: evt.topic, payload: evt });
    return resposta({ received: true, duplicado: r.duplicado });
  } catch (e) {
    console.error("ml-notifications:", e);
    return resposta({ error: "falha ao registrar" }, 500); // o ML reenvia
  }
});
