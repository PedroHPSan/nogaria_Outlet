// Publicação no Instagram (Business Login for Instagram, graph.instagram.com): container → status → media_publish.
// Funções recebem `fetchFn` e `esperar` para serem testadas sem rede.

export type Pub = { id: string; tipo: "feed" | "carrossel" | "story"; payload: { legenda?: string; midias: string[] }; container_id?: string | null };
export type Opcoes = {
  userId: string; token: string; versao?: string; fetchFn?: typeof fetch;
  esperar?: (ms: number) => Promise<void>; salvarContainer?: (id: string) => Promise<void>;
};

const API = (v?: string) => `https://graph.instagram.com/${v ?? "v23.0"}`;

async function chamar(o: Opcoes, metodo: "GET" | "POST", caminho: string, params: Record<string, string>) {
  const f = o.fetchFn ?? fetch;
  const url = new URL(`${API(o.versao)}${caminho}`);
  const init: RequestInit = { method: metodo, headers: { Authorization: `Bearer ${o.token}` } };
  if (metodo === "GET") for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  else { init.body = new URLSearchParams(params); (init.headers as Record<string, string>)["Content-Type"] = "application/x-www-form-urlencoded"; }
  const r = await f(url, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Instagram ${r.status}: ${JSON.stringify(j?.error ?? j).slice(0, 300)}`);
  return j as Record<string, unknown>;
}

// Espera o container ficar FINISHED (imagens costumam ser instantâneas). Se não terminar, lança: o job tenta de novo
// e retoma pelo container_id salvo, sem recriar.
async function aguardar(o: Opcoes, containerId: string, tentativas = 5) {
  const esperar = o.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  for (let i = 0; i < tentativas; i++) {
    const s = await chamar(o, "GET", `/${containerId}`, { fields: "status_code" });
    if (s.status_code === "FINISHED") return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`container ${containerId}: ${s.status_code}`);
    await esperar(3000);
  }
  throw new Error(`container ${containerId} ainda em processamento`);
}

export async function publicarNoInstagram(pub: Pub, o: Opcoes): Promise<{ mediaId: string; permalink: string | null; containerId: string }> {
  const legenda = pub.payload.legenda ?? "";
  let containerId = pub.container_id ?? "";
  if (!containerId) {
    if (pub.tipo === "carrossel") {
      const filhos: string[] = [];
      for (const url of pub.payload.midias) {
        const c = await chamar(o, "POST", `/${o.userId}/media`, { image_url: url, is_carousel_item: "true" });
        filhos.push(String(c.id));
      }
      containerId = String((await chamar(o, "POST", `/${o.userId}/media`, { media_type: "CAROUSEL", children: filhos.join(","), caption: legenda })).id);
    } else if (pub.tipo === "story") {
      containerId = String((await chamar(o, "POST", `/${o.userId}/media`, { media_type: "STORIES", image_url: pub.payload.midias[0] })).id); // story não aceita legenda pela API
    } else {
      containerId = String((await chamar(o, "POST", `/${o.userId}/media`, { image_url: pub.payload.midias[0], caption: legenda })).id);
    }
    await o.salvarContainer?.(containerId);
  }
  await aguardar(o, containerId);
  const mediaId = String((await chamar(o, "POST", `/${o.userId}/media_publish`, { creation_id: containerId })).id);
  let permalink: string | null = null;
  try { permalink = String((await chamar(o, "GET", `/${mediaId}`, { fields: "permalink" })).permalink ?? "") || null; } catch { /* opcional */ }
  return { mediaId, permalink, containerId };
}

export async function comentar(mediaId: string, mensagem: string, o: Opcoes): Promise<void> {
  await chamar(o, "POST", `/${mediaId}/comments`, { message: mensagem });
}

// Renova o token de longa duração (válido 60 dias; só renova se tiver ≥24 h e não expirado).
export async function renovarToken(o: Opcoes): Promise<{ token: string; expiraEm: string }> {
  const f = o.fetchFn ?? fetch;
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token"); url.searchParams.set("access_token", o.token);
  let r: Response;
  try { r = await f(url); } catch { throw new Error("falha de rede ao renovar o token do Instagram"); } // a URL carrega o token: não propagar o erro cru
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(redigir(`Instagram ${r.status}: ${JSON.stringify(j?.error ?? j).slice(0, 300)}`));
  return { token: String(j.access_token), expiraEm: new Date(Date.now() + Number(j.expires_in) * 1000).toISOString() };
}

// Remove tokens de qualquer texto antes de gravar em erro/log (o refresh do Instagram leva o token na URL).
export function redigir(texto: string): string {
  return texto
    .replace(/(access_token|client_secret|fb_exchange_token)=[^&\s"']+/gi, "$1=***")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***")
    .replace(/\bIG[A-Za-z0-9_-]{30,}\b/g, "***");
}

export const mensagemVendido = (sku: string, motivo: string = "vendido") => (motivo === "indisponivel" ? `${sku} INDISPONÍVEL` : `${sku} VENDIDO ✅`);
