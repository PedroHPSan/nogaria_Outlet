import assert from "node:assert/strict";
import { comentar, mensagemVendido, publicarNoInstagram, redigir, renovarToken } from "./instagram.ts";

function fake(estados: string[] = ["FINISHED"]) {
  const chamadas: { m: string; p: string; corpo: Record<string, string> }[] = [];
  let n = 0; let poll = 0;
  const fetchFn = ((url: URL, init: RequestInit) => {
    const corpo = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : Object.fromEntries(url.searchParams);
    chamadas.push({ m: init.method!, p: url.pathname, corpo });
    const j = url.pathname.endsWith("/permalink") ? {} : url.searchParams.get("fields") === "status_code" ? { status_code: estados[Math.min(poll++, estados.length - 1)] }
      : url.searchParams.get("fields") === "permalink" ? { permalink: "https://instagram.com/p/x" } : { id: `id${++n}` };
    return Promise.resolve(new Response(JSON.stringify(j), { status: 200 }));
  }) as unknown as typeof fetch;
  return { fetchFn, chamadas };
}
const base = { userId: "U", token: "T", esperar: () => Promise.resolve() };

Deno.test("feed: container com legenda → status → media_publish", async () => {
  const { fetchFn, chamadas } = fake();
  const salvos: string[] = [];
  const r = await publicarNoInstagram({ id: "p", tipo: "feed", payload: { legenda: "oi", midias: ["https://x/a.jpg"] } }, { ...base, fetchFn, salvarContainer: async (c) => { salvos.push(c); } });
  assert.deepEqual(chamadas.map((c) => c.m + " " + c.p.split("/").slice(-1)[0]), ["POST media", "GET id1", "POST media_publish", "GET id2"]);
  assert.equal(chamadas[0].corpo.caption, "oi"); assert.equal(chamadas[0].corpo.image_url, "https://x/a.jpg");
  assert.equal(chamadas[2].corpo.creation_id, "id1");
  assert.deepEqual(salvos, ["id1"]); assert.equal(r.mediaId, "id2"); assert.equal(r.permalink, "https://instagram.com/p/x");
});

Deno.test("carrossel: um container por imagem (is_carousel_item) e o pai com children e legenda", async () => {
  const { fetchFn, chamadas } = fake();
  await publicarNoInstagram({ id: "p", tipo: "carrossel", payload: { legenda: "L", midias: ["https://x/1.jpg", "https://x/2.jpg"] } }, { ...base, fetchFn });
  assert.equal(chamadas[0].corpo.is_carousel_item, "true"); assert.equal(chamadas[1].corpo.is_carousel_item, "true");
  assert.equal(chamadas[2].corpo.media_type, "CAROUSEL"); assert.equal(chamadas[2].corpo.children, "id1,id2"); assert.equal(chamadas[2].corpo.caption, "L");
  assert.equal(chamadas.at(-2)!.corpo.creation_id, "id3");
});

Deno.test("story não envia legenda", async () => {
  const { fetchFn, chamadas } = fake();
  await publicarNoInstagram({ id: "p", tipo: "story", payload: { legenda: "ignorada", midias: ["https://x/s.jpg"] } }, { ...base, fetchFn });
  assert.equal(chamadas[0].corpo.media_type, "STORIES"); assert.equal(chamadas[0].corpo.caption, undefined);
});

Deno.test("retomada: container_id salvo não recria o container", async () => {
  const { fetchFn, chamadas } = fake();
  await publicarNoInstagram({ id: "p", tipo: "feed", container_id: "C9", payload: { midias: ["https://x/a.jpg"] } }, { ...base, fetchFn });
  assert.ok(!chamadas.some((c) => c.m === "POST" && c.p.endsWith("/U/media")));
  assert.equal(chamadas.find((c) => c.p.endsWith("media_publish"))!.corpo.creation_id, "C9");
});

Deno.test("aguarda IN_PROGRESS, falha em ERROR e se esgotar as tentativas", async () => {
  const ok = fake(["IN_PROGRESS", "IN_PROGRESS", "FINISHED"]);
  await publicarNoInstagram({ id: "p", tipo: "feed", payload: { midias: ["https://x/a.jpg"] } }, { ...base, fetchFn: ok.fetchFn });
  await assert.rejects(publicarNoInstagram({ id: "p", tipo: "feed", payload: { midias: ["https://x/a.jpg"] } }, { ...base, fetchFn: fake(["ERROR"]).fetchFn }), /ERROR/);
  await assert.rejects(publicarNoInstagram({ id: "p", tipo: "feed", payload: { midias: ["https://x/a.jpg"] } }, { ...base, fetchFn: fake(["IN_PROGRESS"]).fetchFn }), /em processamento/);
});

Deno.test("erro HTTP da API vira exceção legível; comentário VENDIDO", async () => {
  const falha = (() => Promise.resolve(new Response(JSON.stringify({ error: { message: "token inválido" } }), { status: 400 }))) as unknown as typeof fetch;
  await assert.rejects(comentar("M1", "x", { ...base, fetchFn: falha }), /Instagram 400.*token inválido/);
  const { fetchFn, chamadas } = fake();
  await comentar("M1", mensagemVendido("NOG-1"), { ...base, fetchFn });
  assert.equal(chamadas[0].p.endsWith("/M1/comments"), true); assert.equal(chamadas[0].corpo.message, "NOG-1 VENDIDO ✅");
});

Deno.test("redigir remove tokens; renovarToken não vaza a URL em falha de rede", async () => {
  assert.equal(redigir("GET https://graph.instagram.com/refresh_access_token?grant_type=x&access_token=IGAAabc123&y=1 falhou"), "GET https://graph.instagram.com/refresh_access_token?grant_type=x&access_token=***&y=1 falhou");
  assert.equal(redigir("Authorization: Bearer abc.def-ghi"), "Authorization: Bearer ***");
  const rede = (() => Promise.reject(new TypeError("error sending request for url (https://graph.instagram.com/refresh_access_token?access_token=SEGREDO)"))) as unknown as typeof fetch;
  await assert.rejects(renovarToken({ ...base, fetchFn: rede }), (e: Error) => !/SEGREDO/.test(e.message) && /rede/.test(e.message));
  const ruim = (() => Promise.resolve(new Response(JSON.stringify({ error: { message: "invalid access_token=SEGREDO" } }), { status: 400 }))) as unknown as typeof fetch;
  await assert.rejects(renovarToken({ ...base, fetchFn: ruim }), (e: Error) => !/SEGREDO/.test(e.message));
}); 
