// supabase-js fala com <url>/rest/v1/...; o PostgREST puro serve na raiz. Este proxy tira o prefixo.
const alvo = Deno.env.get("POSTGREST_URL")!;
Deno.serve(async (req) => {
  const u = new URL(req.url);
  const corpo = ["GET", "HEAD"].includes(req.method) ? undefined : await req.arrayBuffer();
  const r = await fetch(alvo + u.pathname.replace(/^\/rest\/v1/, "") + u.search, { method: req.method, headers: req.headers, body: corpo });
  return new Response(r.body, { status: r.status, headers: r.headers });
});
