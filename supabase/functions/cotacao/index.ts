// Edge Function: cotacao
// Busca a cotação EUR→BRL (AwesomeAPI; reserva Frankfurter) e a grava em `cotacoes`
// (no máx. 1 gravação por 60 s). É a ÚNICA fonte do valor em € dos pedidos: a RPC
// registrar_interesse lê a última linha daqui, nunca um valor enviado pelo cliente.
// Deploy sem verificação de JWT (chamada pelo /api/cotacao): supabase functions deploy cotacao --no-verify-jwt
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function buscar(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function externa() {
  try {
    const d = (await buscar("https://economia.awesomeapi.com.br/json/last/EUR-BRL")).EURBRL;
    const taxa = Number(d?.bid);
    if (taxa > 0) return { taxa, em: d.timestamp ? new Date(Number(d.timestamp) * 1000) : new Date(), fonte: "awesomeapi" };
  } catch { /* tenta a reserva */ }
  const d = await buscar("https://api.frankfurter.app/latest?from=EUR&to=BRL");
  const taxa = Number(d?.rates?.BRL);
  if (!(taxa > 0)) throw new Error("sem cotação");
  return { taxa, em: new Date(), fonte: "frankfurter" };
}

Deno.serve(async () => {
  try {
    const { data: ult } = await admin.from("cotacoes").select("taxa, em, fonte, criado_em").order("criado_em", { ascending: false }).limit(1).maybeSingle();
    if (ult && Date.now() - new Date(ult.criado_em).getTime() < 60_000) {
      return json({ taxa: Number(ult.taxa), em: new Date(ult.em).getTime(), fonte: ult.fonte });
    }
    const c = await externa();
    await admin.from("cotacoes").insert({ taxa: c.taxa, em: c.em.toISOString(), fonte: c.fonte });
    return json({ taxa: c.taxa, em: c.em.getTime(), fonte: c.fonte });
  } catch {
    return json({ erro: "cotação indisponível" }, 502);
  }
});
