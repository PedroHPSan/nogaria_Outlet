// Cotação EUR→BRL única para a página pública e o app (evita cada navegador consultar
// terceiros e mostrar valores diferentes). Cache de 60 s na borda da Vercel.
// Resposta: { taxa: R$ por 1 €, em: timestamp ms, fonte }.
const TIMEOUT_MS = 4000;

async function buscar(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

async function awesome() {
  const d = (await buscar("https://economia.awesomeapi.com.br/json/last/EUR-BRL")).EURBRL;
  const taxa = Number(d?.bid);
  if (!(taxa > 0)) throw new Error("sem cotação");
  return { taxa, em: d.timestamp ? Number(d.timestamp) * 1000 : Date.now(), fonte: "awesomeapi" };
}

async function frankfurter() {
  const d = await buscar("https://api.frankfurter.app/latest?from=EUR&to=BRL");
  const taxa = Number(d?.rates?.BRL);
  if (!(taxa > 0)) throw new Error("sem cotação");
  return { taxa, em: Date.now(), fonte: "frankfurter" };
}

// Fonte preferida: Edge Function `cotacao`, que também grava a taxa usada pela RPC dos pedidos.
async function viaSupabase() {
  const base = process.env.VITE_SUPABASE_URL, key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!base || !key) throw new Error("sem supabase");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${base}/functions/v1/cotacao`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (!(d?.taxa > 0)) throw new Error("sem cotação");
    return d;
  } finally { clearTimeout(timer); }
}

export default async function handler(req, res) {
  try {
    let c;
    try { c = await viaSupabase(); } catch {
      try { c = await awesome(); } catch { c = await frankfurter(); }
    }
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    res.status(200).json(c);
  } catch {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ erro: "cotação indisponível" });
  }
}
