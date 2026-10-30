// Cotação EUR→BRL ao vivo (rede). Fonte principal: AwesomeAPI; reserva: Frankfurter (BCE).
// Retorna { taxa: R$ por 1 €, em: timestamp ms } ou lança erro se nenhuma fonte responder.
let cache = null; // reaproveita por 60 s na mesma sessão
const TTL_MS = 60 * 1000;

const comTimeout = (url) => fetch(url, { signal: AbortSignal.timeout(4000) });

// Fonte única do app: /api/cotacao (cache na borda). Se cair, tenta as fontes direto.
async function proprio() {
  const r = await comTimeout("/api/cotacao");
  if (!r.ok) throw new Error(`api ${r.status}`);
  const d = await r.json();
  if (!(d?.taxa > 0)) throw new Error("api sem cotação");
  return { taxa: Number(d.taxa), em: Number(d.em) || Date.now(), fonte: d.fonte || null };
}

async function awesome() {
  const r = await comTimeout("https://economia.awesomeapi.com.br/json/last/EUR-BRL");
  if (!r.ok) throw new Error(`awesomeapi ${r.status}`);
  const d = (await r.json()).EURBRL;
  const taxa = Number(d?.bid);
  if (!(taxa > 0)) throw new Error("awesomeapi sem cotação");
  return { taxa, em: d.timestamp ? Number(d.timestamp) * 1000 : Date.now(), fonte: "awesomeapi" };
}

async function frankfurter() {
  const r = await comTimeout("https://api.frankfurter.app/latest?from=EUR&to=BRL");
  if (!r.ok) throw new Error(`frankfurter ${r.status}`);
  const d = await r.json();
  const taxa = Number(d?.rates?.BRL);
  if (!(taxa > 0)) throw new Error("frankfurter sem cotação");
  return { taxa, em: Date.parse(`${d.date}T12:00:00Z`) || Date.now(), fonte: "frankfurter" };
}

// soProprio: só /api/cotacao (página pública: o navegador do cliente não consulta terceiros).
export async function cotacaoEuro({ forcar = false, soProprio = false } = {}) {
  if (!forcar && cache && Date.now() - cache.buscadoEm < TTL_MS) return cache.valor;
  let valor;
  try { valor = await proprio(); } catch (e) {
    if (soProprio) throw e;
    try { valor = await awesome(); } catch { valor = await frankfurter(); }
  }
  valor = { ...valor, consultadaEm: Date.now() }; // instante da consulta (a fonte pode ter publicado antes)
  cache = { valor, buscadoEm: Date.now() };
  return valor;
}
