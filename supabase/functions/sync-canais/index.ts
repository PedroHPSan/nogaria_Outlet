// Edge Function: sync-canais — worker da outbox `integracao_jobs`.
// Disparo: pg_cron + pg_net a cada 2 min, só quando há job vencido (migration omnichannel_worker) com o header x-cron-secret.
// Auth (verify_jwt off): x-cron-secret == CRON_SECRET OU bearer == SUPABASE_SERVICE_ROLE_KEY.
// Secrets: CRON_SECRET; SYNC_DRY_RUN=1 faz os handlers não chamarem canais externos.
// Body opcional: { limite?: number } (padrão 10, máx. 50).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handlers } from "./handlers.ts";
import { redigir } from "../_shared/instagram.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function autorizado(req: Request): boolean {
  const cron = Deno.env.get("CRON_SECRET");
  if (cron && req.headers.get("x-cron-secret") === cron) return true;
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return bearer !== "" && bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "método não permitido" }, 405);
  if (!autorizado(req)) return json({ error: "não autorizado" }, 401);

  const { limite } = await req.json().catch(() => ({}));
  const dryRun = Deno.env.get("SYNC_DRY_RUN") === "1";
  const { data: jobs, error } = await admin.rpc("jobs_claim", { p_limite: Math.min(Number(limite) || 10, 50) });
  if (error) return json({ error: error.message }, 500);

  const resumo = { pegos: jobs?.length ?? 0, ok: 0, erro: 0, morto: 0 };
  for (const job of jobs ?? []) {
    let erro: string | null = null;
    try {
      const h = handlers[job.tipo];
      if (!h) throw new Error(`handler não registrado: ${job.tipo}`);
      await h(job.payload ?? {}, { dryRun, admin, job: { id: job.id, tentativas: job.tentativas } });
    } catch (e) {
      erro = redigir(e instanceof Error ? e.message : String(e));
    }
    const { data: status } = await admin.rpc("job_concluir", { p_id: job.id, p_ok: erro === null, p_erro: erro });
    if (status === "ok") resumo.ok++; else if (status === "morto") resumo.morto++; else resumo.erro++;
  }
  return json(resumo);
});
