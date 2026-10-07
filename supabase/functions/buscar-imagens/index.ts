// Edge Function: buscar-imagens
// Busca de imagens no Google (Custom Search JSON API) e proxy de download, para anexar
// fotos de catálogo ao item em vez de fotografar no galpão. O proxy existe porque o
// navegador não consegue baixar imagens de sites de terceiros (CORS).
//
// Entradas (POST JSON):
//   { acao: "buscar", q: string, inicio?: number }  → { itens: [{ url, thumb, titulo, fonte, w, h }] }
//   { acao: "baixar", url: string }                  → bytes da imagem (Content-Type da origem)
//
// Secrets (supabase secrets set ...):
//   GOOGLE_CSE_KEY — chave da Custom Search JSON API (NUNCA logar)
//   GOOGLE_CSE_CX  — ID do mecanismo de busca (com "Pesquisa de imagens" ativada)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const MAX_BYTES = 8 * 1024 * 1024;

// Expande um IPv6 para 8 hextets (aceita "::" e sufixo IPv4). null se malformado.
function hextets(ip: string): number[] | null {
  let v = ip.toLowerCase();
  const m = v.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    const [x, y, z, w] = m[2].split(".").map(Number);
    v = m[1] + ((x << 8) | y).toString(16) + ":" + ((z << 8) | w).toString(16);
  }
  const [cabeca, cauda, extra] = v.split("::");
  if (extra !== undefined) return null;
  const h = cabeca ? cabeca.split(":") : [];
  const t = cauda === undefined ? [] : cauda ? cauda.split(":") : [];
  const falta = 8 - h.length - t.length;
  if (cauda === undefined ? falta !== 0 : falta < 1) return null;
  const todos = [...h, ...Array(cauda === undefined ? 0 : falta).fill("0"), ...t].map((x) => parseInt(x, 16));
  return todos.length === 8 && todos.every((n) => n >= 0 && n <= 0xffff) ? todos : null;
}

// Endereço não público (fail-closed): loopback, privado, link-local, CGNAT, multicast,
// reservado, ULA e IPv6 com IPv4 embutido (::ffff:/::/64:ff9b::) checados pelas regras v4.
function ipPrivado(ip: string): boolean {
  if (ip.includes(":")) {
    const h = hextets(ip);
    if (!h) return true;
    const zeros80 = h.slice(0, 5).every((n) => n === 0);
    const v4 = `${h[6] >> 8}.${h[6] & 255}.${h[7] >> 8}.${h[7] & 255}`;
    if (zeros80 && (h[5] === 0xffff || h[5] === 0)) return ipPrivado(v4); // ::ffff:a.b.c.d, ::a.b.c.d, ::, ::1
    if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((n) => n === 0)) return ipPrivado(v4);
    return (h[0] & 0xfe00) === 0xfc00 || (h[0] & 0xffc0) === 0xfe80 || (h[0] & 0xff00) === 0xff00 || h[0] === 0x2001 && h[1] === 0xdb8;
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !(n >= 0 && n <= 255))) return true;
  const [a, b, c] = p;
  return a === 10 || a === 127 || a === 0 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) ||
    (a === 192 && b === 0 && c === 0);
}

// Valida a URL e resolve o DNS (A e AAAA): rejeita se QUALQUER endereço for interno.
async function urlPermitida(raw: string): Promise<URL | null> {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  const h = u.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":")) return ipPrivado(h) ? null : u;
  const ips: string[] = [];
  for (const tipo of ["A", "AAAA"] as const) {
    try { ips.push(...(await Deno.resolveDns(h, tipo))); } catch { /* sem registro deste tipo */ }
  }
  if (!ips.length || ips.some(ipPrivado)) return null;
  return u;
}

// Segue redirecionamentos manualmente (máx. 3), revalidando cada destino.
async function buscarSeguro(raw: string): Promise<Response | null> {
  let atual = raw;
  for (let i = 0; i <= 3; i++) {
    const alvo = await urlPermitida(atual);
    if (!alvo) return null;
    const r = await fetch(alvo, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NogariaOutlet/1.0)", Accept: "image/*" },
      signal: AbortSignal.timeout(15000),
    });
    const loc = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && loc) { atual = new URL(loc, alvo).toString(); continue; }
    return r;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ error: "não autenticado" }, 401);

    const body = await req.json();

    if (body?.acao === "baixar") {
      const r = await buscarSeguro(String(body.url ?? ""));
      if (!r) return json({ error: "url inválida ou bloqueada" }, 400);
      if (!r.ok) return json({ error: "origem indisponível" }, 502);
      const tipo = r.headers.get("content-type") ?? "";
      if (!tipo.startsWith("image/")) return json({ error: "a URL não é uma imagem" }, 415);
      const declarado = Number(r.headers.get("content-length") ?? 0);
      if (declarado > MAX_BYTES) return json({ error: "imagem maior que 8 MB" }, 413);
      // Lê em streaming e aborta ao passar do limite (content-length pode faltar ou mentir).
      const partes: Uint8Array[] = [];
      let total = 0;
      const leitor = r.body?.getReader();
      if (!leitor) return json({ error: "resposta vazia" }, 502);
      while (true) {
        const { done, value } = await leitor.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) { await leitor.cancel(); return json({ error: "imagem maior que 8 MB" }, 413); }
        partes.push(value);
      }
      const buf = new Uint8Array(total);
      let off = 0;
      for (const c of partes) { buf.set(c, off); off += c.byteLength; }
      return new Response(buf, { headers: { ...cors, "Content-Type": tipo } });
    }

    if (body?.acao === "buscar") {
      const key = Deno.env.get("GOOGLE_CSE_KEY");
      const cx = Deno.env.get("GOOGLE_CSE_CX");
      if (!key || !cx) return json({ error: "google_nao_configurado" }, 501);
      const q = String(body.q ?? "").trim();
      if (!q) return json({ error: "informe 'q'" }, 400);
      const inicio = Math.min(Math.max(Number(body.inicio) || 1, 1), 91);
      const p = new URLSearchParams({
        key, cx, q, searchType: "image", num: "10", start: String(inicio),
        gl: "br", lr: "lang_pt", safe: "active", imgSize: "large",
      });
      const r = await fetch(`https://www.googleapis.com/customsearch/v1?${p}`);
      const d = await r.json();
      if (!r.ok) return json({ error: d?.error?.message ?? "falha na busca" }, 502);
      const itens = (d.items ?? []).map((i: any) => ({
        url: i.link,
        thumb: i.image?.thumbnailLink ?? i.link,
        titulo: i.title ?? "",
        fonte: i.displayLink ?? "",
        w: i.image?.width ?? null,
        h: i.image?.height ?? null,
      }));
      return json({ itens });
    }

    return json({ error: "acao inválida" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
