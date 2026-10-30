// Cotação EUR→BRL ao vivo (rede). Fonte principal: AwesomeAPI; reserva: Frankfurter (BCE).
// Retorna { taxa: R$ por 1 €, em: timestamp ms } ou lança erro se nenhuma fonte responder.
let cache = null; // reaproveita por 60 s na mesma sessão
const TTL_MS = 60 * 1000;

async function awesome() {
  const r = await fetch("https://economia.awesomeapi.com.br/json/last/EUR-BRL");
  if (!r.ok) throw new Error(`awesomeapi ${r.status}`);
  const d = (await r.json()).EURBRL;
  const taxa = Number(d?.bid);
  if (!(taxa > 0)) throw new Error("awesomeapi sem cotação");
  return { taxa, em: d.timestamp ? Number(d.timestamp) * 1000 : Date.now() };
}

async function frankfurter() {
  const r = await fetch("https://api.frankfurter.app/latest?from=EUR&to=BRL");
  if (!r.ok) throw new Error(`frankfurter ${r.status}`);
  const d = await r.json();
  const taxa = Number(d?.rates?.BRL);
  if (!(taxa > 0)) throw new Error("frankfurter sem cotação");
  return { taxa, em: Date.parse(`${d.date}T12:00:00Z`) || Date.now() };
}

export async function cotacaoEuro({ forcar = false } = {}) {
  if (!forcar && cache && Date.now() - cache.buscadoEm < TTL_MS) return cache.valor;
  let valor;
  try { valor = await awesome(); } catch { valor = await frankfurter(); }
  cache = { valor, buscadoEm: Date.now() };
  return valor;
}
