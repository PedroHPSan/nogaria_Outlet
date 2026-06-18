// Edge Function: ml-notifications
// Stub para o webhook de notificações do Mercado Livre.
// O ML faz POST aqui a cada evento; só precisamos confirmar com HTTP 200 rápido.
// Publicar SEM verify_jwt (o ML não envia JWT do Supabase):
//   supabase functions deploy ml-notifications --no-verify-jwt
Deno.serve(async (req) => {
  // Validação inicial do DevCenter costuma ser um GET — responde 200.
  if (req.method === "GET") return new Response("ok", { status: 200 });

  try {
    const evt = await req.json().catch(() => null);
    // Log apenas para auditoria; não processamos nada por enquanto.
    console.log("ML notification:", JSON.stringify(evt));
  } catch (_e) {
    // corpo inesperado — ainda assim confirmamos recebimento
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
