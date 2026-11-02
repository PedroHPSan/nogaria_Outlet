// Rode: npm run test:webhook (usa o Deno; sem rede, sem banco).
import assert from "node:assert/strict";
import { desafioMeta, idExternoML, registrarEvento, validarOrigemML, verificarAssinaturaMeta, type Admin } from "./webhook.ts";

const hmac = async (corpo: string, segredo: string) => {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "sha256=" + [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(corpo)))].map((b) => b.toString(16).padStart(2, "0")).join("");
};

Deno.test("Meta: assinatura válida passa, adulterada/ausente/sem segredo falha", async () => {
  const corpo = '{"entry":[]}';
  assert.equal(await verificarAssinaturaMeta(corpo, await hmac(corpo, "s3"), "s3"), true);
  assert.equal(await verificarAssinaturaMeta(corpo + " ", await hmac(corpo, "s3"), "s3"), false);
  assert.equal(await verificarAssinaturaMeta(corpo, await hmac(corpo, "outro"), "s3"), false);
  assert.equal(await verificarAssinaturaMeta(corpo, null, "s3"), false);
  assert.equal(await verificarAssinaturaMeta(corpo, await hmac(corpo, "s3"), undefined), false);
});

Deno.test("Meta: desafio de verificação", () => {
  const u = (q: string) => new URL("https://x/f?" + q);
  assert.equal(desafioMeta(u("hub.mode=subscribe&hub.verify_token=t&hub.challenge=123"), "t"), "123");
  assert.equal(desafioMeta(u("hub.mode=subscribe&hub.verify_token=errado&hub.challenge=123"), "t"), null);
  assert.equal(desafioMeta(u("hub.mode=subscribe&hub.verify_token=t&hub.challenge=123"), undefined), null);
});

Deno.test("ML: origem confere application_id e user_id; sem config recusa", () => {
  const evt = { topic: "orders_v2", resource: "/orders/1", user_id: 77, application_id: 99, sent: "2026-11-02T10:00:00Z" };
  assert.equal(validarOrigemML(evt, { applicationId: "99", userId: "77" }), true);
  assert.equal(validarOrigemML(evt, { applicationId: "98", userId: "77" }), false);
  assert.equal(validarOrigemML(evt, { applicationId: "99", userId: "1" }), false);
  assert.equal(validarOrigemML(evt, {}), false);
  assert.equal(validarOrigemML(null, { applicationId: "99", userId: "77" }), false);
  assert.equal(idExternoML(evt), "orders_v2:/orders/1:2026-11-02T10:00:00Z");
});

Deno.test("registrarEvento: reenvio não gera 2º job", async () => {
  const vistos = new Set<string>(); const jobs: string[] = [];
  const admin: Admin = {
    from: () => ({ insert: (row: unknown) => {
      const r = row as { canal: string; external_id: string }; const k = r.canal + "|" + r.external_id;
      if (vistos.has(k)) return Promise.resolve({ error: { code: "23505", message: "dup" } });
      vistos.add(k); return Promise.resolve({ error: null });
    } }),
    rpc: (_fn, args) => { jobs.push((args as { p_idem_key: string }).p_idem_key); return Promise.resolve({ data: 1, error: null }); },
  };
  const e = { canal: "mercadolivre", externalId: "t:r:s", payload: {} };
  assert.deepEqual(await registrarEvento(admin, e), { duplicado: false });
  assert.deepEqual(await registrarEvento(admin, e), { duplicado: true });
  assert.deepEqual(jobs, ["evt:mercadolivre:t:r:s"]);
});
