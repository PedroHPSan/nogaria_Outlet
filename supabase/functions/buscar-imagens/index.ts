// Edge Function: buscar-imagens
// Busca de imagens no Google (Custom Search JSON API) e proxy de download, para anexar
// fotos de catálogo ao item em vez de fotografar no galpão. O proxy existe porque o
// navegador não consegue baixar imagens de sites de terceiros (CORS).
//
// Entradas (POST JSON):
//   { acao: "buscar", q: string, inicio?: number }  → { itens: [{ url, thumb, titulo, fonte, w, h }] }
//   { acao: "baixar", url: string }                  → bytes da imagem (Content-Type da origem)
//
// Cota: 30 buscas e 120 downloads por usuário/hora (migration 20261007120000_buscar_imagens_cota).
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
const TIPOS_OK = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]); // sem SVG (script)

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

// Valida a URL e resolve o DNS (A e AAAA). Devolve a URL e os IPs JÁ validados, ou null se
// qualquer endereço for interno. A conexão é feita nesses IPs (ver pedirFixo), então um
// segundo lookup (DNS rebinding) não consegue trocar o destino depois da checagem.
async function urlPermitida(raw: string): Promise<{ u: URL; ips: string[] } | null> {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  const h = u.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":")) return ipPrivado(h) ? null : { u, ips: [h] };
  const ips: string[] = [];
  for (const tipo of ["A", "AAAA"] as const) {
    try { ips.push(...(await Deno.resolveDns(h, tipo))); } catch { /* sem registro deste tipo */ }
  }
  if (!ips.length || ips.some(ipPrivado)) return null;
  return { u, ips };
}

const enc = new TextEncoder();
const dec = new TextDecoder();

// Leitor com buffer sobre uma conexão (para parsear HTTP/1.1 na mão).
class Leitor {
  buf: Uint8Array = new Uint8Array(0);
  constructor(private c: { read(p: Uint8Array): Promise<number | null> }) {}
  private async mais(): Promise<boolean> {
    const tmp = new Uint8Array(16384);
    let n: number | null;
    try { n = await this.c.read(tmp); }
    catch (e) {
      // Muitos servidores fecham o TLS sem close_notify ao terminar: tratar como EOF.
      if (e instanceof Deno.errors.UnexpectedEof) return false;
      throw e;
    }
    if (n === null) return false;
    const novo = new Uint8Array(this.buf.length + n);
    novo.set(this.buf); novo.set(tmp.subarray(0, n), this.buf.length);
    this.buf = novo;
    return true;
  }
  async ate(delim: string, max: number): Promise<string | null> {
    const d = enc.encode(delim);
    let desde = 0;
    while (true) {
      outer: for (let i = desde; i <= this.buf.length - d.length; i++) {
        for (let j = 0; j < d.length; j++) if (this.buf[i + j] !== d[j]) continue outer;
        const out = dec.decode(this.buf.subarray(0, i));
        this.buf = this.buf.subarray(i + d.length);
        return out;
      }
      desde = Math.max(0, this.buf.length - d.length + 1);
      if (this.buf.length > max || !(await this.mais())) return null;
    }
  }
  async ler(): Promise<Uint8Array | null> { // o que houver (até o fim da conexão)
    if (!this.buf.length && !(await this.mais())) return null;
    const out = this.buf; this.buf = new Uint8Array(0); return out;
  }
  async exato(n: number): Promise<Uint8Array | null> {
    while (this.buf.length < n) if (!(await this.mais())) return null;
    const out = this.buf.subarray(0, n); this.buf = this.buf.subarray(n); return out;
  }
}

// GET HTTP/1.1 conectando direto no IP validado (SNI/Host = nome original). Devolve uma
// Response com o corpo em streaming; o chamador aplica os limites de tamanho.
async function pedirFixo(u: URL, ips: string[]): Promise<Response> {
  const https = u.protocol === "https:";
  const porta = Number(u.port) || (https ? 443 : 80);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  let conn: Deno.Conn = await Deno.connect({ hostname: ips[0], port: porta });
  const timer = setTimeout(() => { try { conn.close(); } catch { /* já fechada */ } }, 15000);
  try {
    if (https) conn = await Deno.startTls(conn as Deno.TcpConn, { hostname: host });
    const req = `GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\n` +
      "User-Agent: Mozilla/5.0 (compatible; NogariaOutlet/1.0)\r\nAccept: image/*\r\n" +
      "Accept-Encoding: identity\r\nConnection: close\r\n\r\n";
    await conn.write(enc.encode(req));
    const lei = new Leitor(conn);
    const cab = await lei.ate("\r\n\r\n", 32768);
    if (!cab) throw new Error("cabeçalho inválido");
    const linhas = cab.split("\r\n");
    const status = Number(linhas[0].split(" ")[1]);
    if (!(status >= 200 && status <= 599)) throw new Error("status inválido");
    const headers = new Headers();
    for (const l of linhas.slice(1)) {
      const i = l.indexOf(":");
      if (i > 0) { try { headers.append(l.slice(0, i).trim(), l.slice(i + 1).trim()); } catch { /* cabeçalho inválido */ } }
    }
    const chunked = (headers.get("transfer-encoding") ?? "").toLowerCase().includes("chunked");
    const fim = () => { clearTimeout(timer); try { conn.close(); } catch { /* já fechada */ } };
    if (status === 204 || status === 304 || (status >= 300 && status < 400)) {
      fim();
      return new Response(null, { status, headers });
    }
    let restante = 0; // bytes que faltam do chunk atual (transfer-encoding: chunked)
    const corpo = new ReadableStream<Uint8Array>({
      // O stream só chama pull de novo depois de um enqueue: repete até entregar dados ou fechar.
      async pull(ctl) {
        try {
          while (true) {
            if (!chunked) {
              const c = await lei.ler();
              if (c === null) { fim(); ctl.close(); } else ctl.enqueue(c);
              return;
            }
            // Dentro de um chunk, repassa o que chegou sem bufferizar o chunk inteiro (o tamanho
            // é declarado pelo servidor remoto); o teto de 8 MB é aplicado por quem consome.
            if (restante > 0) {
              const c = await lei.ler();
              if (c === null) throw new Error("chunk truncado");
              const parte = c.subarray(0, restante);
              lei.buf = c.subarray(parte.length); // devolve o excedente ao buffer
              restante -= parte.length;
              if (restante === 0 && (await lei.exato(2)) === null) throw new Error("chunk truncado");
              ctl.enqueue(parte);
              return;
            }
            const tam = await lei.ate("\r\n", 1024);
            const n = tam === null ? NaN : parseInt(tam.split(";")[0].trim(), 16);
            if (!(n >= 0)) throw new Error("chunk inválido");
            if (n === 0) { fim(); ctl.close(); return; }
            restante = n;
          }
        } catch (e) { fim(); ctl.error(e); }
      },
      cancel() { fim(); },
    });
    return new Response(corpo, { status, headers });
  } catch (e) {
    clearTimeout(timer);
    try { conn.close(); } catch { /* já fechada */ }
    throw e;
  }
}

// Segue redirecionamentos manualmente (máx. 3), revalidando e re-resolvendo cada destino.
async function buscarSeguro(raw: string): Promise<Response | null> {
  let atual = raw;
  for (let i = 0; i <= 3; i++) {
    const ok = await urlPermitida(atual);
    if (!ok) return null;
    const r = await pedirFixo(ok.u, ok.ips);
    const loc = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && loc) { atual = new URL(loc, ok.u).toString(); continue; }
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

    // Cota por usuário/hora (tabela buscar_imagens_uso). Fail-closed: sem a migration, nega.
    const LIMITES = { buscar: 30, baixar: 120 } as const;
    const acao = (await req.clone().json())?.acao as keyof typeof LIMITES;
    if (!(acao in LIMITES)) return json({ error: "acao inválida" }, 400);
    const { data: dentro, error: eCota } = await admin.rpc("consumir_cota_busca", {
      p_user: u.user.id, p_acao: acao, p_limite: LIMITES[acao],
    });
    if (eCota) { console.error("buscar-imagens cota:", eCota.message); return json({ error: "erro interno" }, 500); }
    if (!dentro) return json({ error: "limite de uso atingido, tente mais tarde" }, 429);

    const body = await req.json();

    if (body?.acao === "baixar") {
      const r = await buscarSeguro(String(body.url ?? ""));
      if (!r) return json({ error: "url inválida ou bloqueada" }, 400);
      if (!r.ok) return json({ error: "origem indisponível" }, 502);
      const tipo = r.headers.get("content-type") ?? "";
      const tipoBase = tipo.split(";")[0].trim().toLowerCase();
      if (!TIPOS_OK.has(tipoBase)) return json({ error: "formato de imagem não suportado" }, 415);
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
      return new Response(buf, { headers: { ...cors, "Content-Type": tipoBase, "X-Content-Type-Options": "nosniff" } });
    }

    if (body?.acao === "buscar") {
      const key = Deno.env.get("GOOGLE_CSE_KEY");
      const cx = Deno.env.get("GOOGLE_CSE_CX");
      if (!key || !cx) return json({ error: "google_nao_configurado" }, 501);
      const q = String(body.q ?? "").trim();
      if (!q || q.length > 200) return json({ error: "informe 'q' (até 200 caracteres)" }, 400);
      const inicio = Math.min(Math.max(Number(body.inicio) || 1, 1), 91);
      const p = new URLSearchParams({
        key, cx, q, searchType: "image", num: "10", start: String(inicio),
        gl: "br", lr: "lang_pt", safe: "active", imgSize: "large",
      });
      const r = await fetch(`https://www.googleapis.com/customsearch/v1?${p}`);
      const d = await r.json();
      if (!r.ok) return json({ error: d?.error?.message ?? "falha na busca" }, 502);
      const itens = (d.items ?? [])
        .filter((i: any) => typeof i.link === "string" && i.link.startsWith("https://") && i.image?.thumbnailLink)
        .map((i: any) => ({
          url: i.link,
          thumb: i.image.thumbnailLink,
          titulo: i.title ?? "",
          fonte: i.displayLink ?? "",
          w: i.image?.width ?? null,
          h: i.image?.height ?? null,
        }));
      return json({ itens });
    }

    return json({ error: "acao inválida" }, 400);
  } catch (e) {
    console.error("buscar-imagens:", (e as Error)?.message);
    return json({ error: "erro interno" }, 500);
  }
});
