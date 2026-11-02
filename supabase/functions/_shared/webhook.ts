// Helper compartilhado dos webhooks de canais (Meta/WhatsApp/Instagram, Mercado Livre).
// Regra: validar a origem, só GRAVAR o evento na inbox `webhook_eventos` (idempotente por
// canal+external_id), enfileirar o processamento e responder 200 rápido. Quem processa é o worker.

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(texto: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(texto)));
}

function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Meta: header `X-Hub-Signature-256: sha256=<hmac hex do corpo BRUTO com o app secret>`.
export async function verificarAssinaturaMeta(corpoBruto: string, header: string | null, appSecret: string | undefined): Promise<boolean> {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const esperado = hex(await crypto.subtle.sign("HMAC", key, enc.encode(corpoBruto)));
  return iguais(esperado, header.slice("sha256=".length).toLowerCase());
}

// Meta: GET de verificação do webhook (hub.mode=subscribe & hub.verify_token). Devolve o challenge ou null.
export function desafioMeta(url: URL, verifyToken: string | undefined): string | null {
  const p = url.searchParams;
  if (!verifyToken || p.get("hub.mode") !== "subscribe" || p.get("hub.verify_token") !== verifyToken) return null;
  return p.get("hub.challenge");
}

export type EventoML = { topic?: string; resource?: string; user_id?: number | string; application_id?: number | string; sent?: string };

// Mercado Livre não assina o corpo: confere application_id e user_id contra a nossa app/conta.
export function validarOrigemML(evt: EventoML | null, esperado: { applicationId?: string; userId?: string }): boolean {
  if (!evt || !esperado.applicationId || !esperado.userId) return false;
  return String(evt.application_id) === esperado.applicationId && String(evt.user_id) === esperado.userId;
}

// Chave de deduplicação do ML: o mesmo (topic, resource, sent) reenviado é o mesmo evento.
export const idExternoML = (evt: EventoML) => `${evt.topic}:${evt.resource}:${evt.sent}`;

// Mínimo do cliente Supabase que usamos (facilita testar com um fake).
export interface Admin {
  from(t: string): { insert(row: unknown): PromiseLike<{ error: { code?: string; message: string } | null }> };
  rpc(fn: string, args: unknown): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

// Grava o evento e enfileira `processar.<canal>`. Reenvio do mesmo evento → { duplicado: true } sem 2º job.
export async function registrarEvento(
  admin: Admin, e: { canal: string; externalId: string; topico?: string; payload: unknown },
): Promise<{ duplicado: boolean }> {
  const { error } = await admin.from("webhook_eventos").insert({
    canal: e.canal, external_id: e.externalId, topico: e.topico ?? null, payload: e.payload,
  });
  if (error?.code === "23505") return { duplicado: true };
  if (error) throw new Error(error.message);
  const { error: eJob } = await admin.rpc("enfileirar_job", {
    p_tipo: `processar.${e.canal}`, p_payload: { canal: e.canal, external_id: e.externalId },
    p_idem_key: `evt:${e.canal}:${e.externalId}`,
  });
  if (eJob) throw new Error(eJob.message);
  return { duplicado: false };
}

export const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
