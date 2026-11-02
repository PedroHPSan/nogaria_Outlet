// Edge Function: catalogo-meta-feed — feed CSV do catálogo Meta (WhatsApp/Instagram/Facebook).
// A Meta busca a URL sozinha (agendamento no Commerce Manager, ex.: a cada 1 h):
//   https://<ref>.supabase.co/functions/v1/catalogo-meta-feed?t=<CATALOGO_FEED_TOKEN>
// Itens vendidos/reservados saem como "out of stock" (a Meta os marca indisponíveis nas mensagens já enviadas).
// Secrets: CATALOGO_FEED_TOKEN, PUBLIC_SITE_URL (ex.: https://outlet.exemplo). Publicar SEM verify_jwt.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { montarFeed, type LinhaFeed } from "../_shared/catalogoMeta.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const iguais = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

Deno.serve(async (req) => {
  if (req.method !== "GET") return new Response("método não permitido", { status: 405 });
  const token = Deno.env.get("CATALOGO_FEED_TOKEN"), site = Deno.env.get("PUBLIC_SITE_URL");
  if (!token || !site) return new Response("feed não configurado", { status: 503 });
  if (!iguais(new URL(req.url).searchParams.get("t") ?? "", token)) return new Response("não autorizado", { status: 401 });

  const { data, error } = await admin.rpc("catalogo_meta_feed");
  if (error) { console.error("catalogo-meta-feed:", error.message); return new Response("erro ao montar o feed", { status: 500 }); }
  const { csv, total, ignorados } = montarFeed((data ?? []) as LinhaFeed[], site);
  if (ignorados.length) console.warn("catalogo-meta-feed: itens sem foto/preço ignorados:", ignorados.join(","));
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store", "X-Total-Itens": String(total) } });
});
