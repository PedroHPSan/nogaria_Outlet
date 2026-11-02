// Cenário ponta a ponta do omnichannel contra o stack local (ver scripts/test_integrado.sh).
// Exercita as Edge Functions de verdade (Deno) falando com Postgres+PostgREST; Meta/Instagram em dry-run.
const E = (k: string) => Deno.env.get(k)!;
const REST = E("REST"), SERVICE = E("SERVICE_JWT"), USER = E("USER_JWT");
let ok = 0, falhas = 0;
const check = (cond: unknown, nome: string, det?: unknown) => {
  if (cond) { ok++; console.log(`  PASS | ${nome}`); } else { falhas++; console.log(`  FAIL | ${nome}${det !== undefined ? " | " + JSON.stringify(det) : ""}`); }
};

async function rest(path: string, o: { method?: string; body?: unknown; jwt?: string | null } = {}) {
  const h: Record<string, string> = { "Content-Type": "application/json", Prefer: "return=representation" };
  const jwt = o.jwt === undefined ? SERVICE : o.jwt;
  if (jwt) h.Authorization = `Bearer ${jwt}`;
  const r = await fetch(`${REST}/rest/v1${path}`, { method: o.method ?? "GET", headers: h, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const t = await r.text();
  let data: unknown = null; try { data = t ? JSON.parse(t) : null; } catch { data = t; }
  return { status: r.status, data: data as any };
}
const rpc = (fn: string, args: unknown, jwt?: string | null) => rest(`/rpc/${fn}`, { method: "POST", body: args, jwt });
const insere = async (tabela: string, linhas: unknown) => { const r = await rest(`/${tabela}`, { method: "POST", body: linhas }); if (r.status >= 300) throw new Error(`insert ${tabela}: ${JSON.stringify(r.data)}`); return r.data; };

async function worker() {
  let total = 0;
  for (let i = 0; i < 8; i++) {
    const r = await fetch(E("SYNC_URL"), { method: "POST", headers: { "x-cron-secret": "local" }, body: "{}" });
    const j = await r.json(); total += j.pegos;
    if (!j.pegos) break;
  }
  return total;
}

const hmac = async (corpo: string) => {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode("appsecret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "sha256=" + [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(corpo)))].map((b) => b.toString(16).padStart(2, "0")).join("");
};
async function zap(de: string, id: string, texto: string, assinar = true) {
  const corpo = JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ wa_id: de, profile: { name: "Cliente " + de.slice(-2) } }], messages: [{ id, from: de, type: "text", text: { body: texto } }] } }] }] });
  const r = await fetch(E("WA_URL"), { method: "POST", headers: { "x-hub-signature-256": assinar ? await hmac(corpo) : "sha256=00" }, body: corpo });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
const mensagensDe = async (waId: string, direcao: string) => (await rest(`/mensagens_whatsapp?wa_id=eq.${waId}&direcao=eq.${direcao}&order=id`)).data as any[];
const reservasAtivas = async (sku: string) => (await rest(`/reservas?sku=eq.${sku}&status=eq.ATIVA`)).data as any[];

const A = "5591900000001", B = "5591900000002", C = "5591900000003";
const sku = (n: number, m: number) => `NOG-${String(n).padStart(3, "0")}-${String(m).padStart(3, "0")}`;

console.log("== 1. WhatsApp: webhook → inbox → worker → reservas e respostas ==");
await insere("itens", [1, 2, 3, 4, 5, 99].map((m) => ({ sku: sku(1, m), produto: `Item ${m}`, status: "PRONTO", preco_ideal: 100 })));
await insere("catalogos_publicos", { slug: "of1", titulo: "Oferta", payload: { itens: [1, 2, 3, 4].map((m) => ({ sku: sku(1, m) })) } });
const v = await fetch(`${E("WA_URL")}?hub.mode=subscribe&hub.verify_token=verif&hub.challenge=4242`);
check(v.status === 200 && (await v.text()) === "4242", "verificação do webhook (hub.challenge)");
check((await fetch(`${E("WA_URL")}?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1`)).status === 403, "verify_token errado → 403");
check((await zap(A, "wamid.X", "oi", false)).status === 403, "assinatura inválida → 403");
const r1 = await zap(A, "wamid.A1", `QUERO ${sku(1, 1)}`);
check(r1.status === 200 && r1.json.duplicado === false, "mensagem válida entra na inbox", r1);
check((await zap(A, "wamid.A1", `QUERO ${sku(1, 1)}`)).json.duplicado === true, "reenvio da Meta é duplicado (sem 2º job)");
await worker();
check((await reservasAtivas(sku(1, 1))).some((r) => r.criado_por === `wa:${A}` && r.origem_tipo === "carrinho_wa"), "QUERO reserva o item no nome do número");
check((await mensagensDe(A, "out")).some((m) => /Reservei/.test(m.texto)), "resposta de confirmação registrada");
for (const [i, m] of [[2, 2], [3, 3], [4, 4]] as const) { await zap(A, `wamid.A${i}`, `quero ${sku(1, m)}`); await worker(); }
check((await reservasAtivas(sku(1, 4))).length === 0, "4ª reserva do mesmo número é recusada (teto de 3)");
check((await mensagensDe(A, "out")).some((m) => /limite de 3/.test(m.texto)), "cliente recebe o aviso de limite");
await zap(B, "wamid.B1", `quero ${sku(1, 99)}`); await worker();
check((await reservasAtivas(sku(1, 99))).length === 0, "item fora de oferta pública não reserva por texto");
await insere("interesses", { codigo: "A1B2C", sku: sku(1, 5), status: "ABERTO" });
await zap(B, "wamid.B2", "pedido A1B2C"); await worker();
check((await reservasAtivas(sku(1, 5))).some((r) => r.origem_tipo === "interesse" && r.criado_por === `wa:${B}`), "código de pedido em € reserva para quem o reivindicou");
await zap(C, "wamid.C1", "pedido A1B2C"); await worker();
check((await mensagensDe(C, "out")).some((m) => /em atendimento/.test(m.texto)) && (await reservasAtivas(sku(1, 5)))[0]?.criado_por === `wa:${B}`, "outro número não sequestra o código");
await zap(C, "wamid.C2", "SAIR"); await worker();
check(((await rest(`/contatos_whatsapp?wa_id=eq.${C}`)).data as any[])[0]?.opt_out_em, "SAIR registra o opt-out");

console.log("== 2. Envio transacional (template) ==");
await insere("itens", { sku: sku(2, 1), produto: "Fone", status: "PRONTO" });
await insere("orcamentos", { codigo: "ORC-I1", slug: "i1", status: "ABERTA", origem: "whatsapp", itens: [{ sku: sku(2, 1), produto: "Fone", preco: 100 }], total: 100, validade: new Date(Date.now() + 3 * 864e5).toISOString(), cliente_nome: "Ana", cliente_whatsapp: "5591988887777" });
const e1 = await rpc("whatsapp_enviar", { p_ref_tipo: "sacola", p_ref: "ORC-I1", p_evento: "cobranca" }, USER);
const e2 = await rpc("whatsapp_enviar", { p_ref_tipo: "sacola", p_ref: "ORC-I1", p_evento: "cobranca" }, USER);
check(e1.status === 200 && e1.data && e2.data === null, "pedir o envio 2× gera 1 job só (idempotente)", [e1, e2]);
check((await rpc("enfileirar_job", { p_tipo: "wa.template", p_payload: {}, p_idem_key: "hack" }, USER)).status >= 400, "usuário logado não enfileira job arbitrário");
await worker();
const tpl = (await rest(`/mensagens_whatsapp?ref=eq.ORC-I1&tipo=eq.template`)).data as any[];
check(tpl.length === 1 && tpl[0].status === "dry_run" && /^Olá, Ana!/.test(tpl[0].texto) && tpl[0].wa_id === "5591988887777", "template enviado (dry-run) com destinatário e texto do banco", tpl);
const env = (await rpc("whatsapp_envios", { p_ref_tipo: "sacola", p_ref: "ORC-I1" }, USER)).data as any[];
check(env?.[0]?.evento === "cobranca" && env[0].job_status === "ok", "situação do envio visível ao app", env);

console.log("== 3. Catálogo Meta e página /i/<sku> ==");
const s3 = sku(3, 1);
await insere("itens", { sku: s3, produto: "Tênis", status: "PRONTO" });
const payload = { titulo: "Tênis", itens: [{ sku: s3, produto: "Tênis Nike", preco: 199.9, foto: "https://x/f.jpg", marca: "Nike", condicao: "Usado ótimo", badge: { cls: "semi" } }] };
check((await rpc("item_publico", { p_sku: s3 }, null)).data === null, "anônimo não vê item não publicado");
const pub = await rpc("catalogo_meta_publicar", { p_sku: s3, p_payload: payload }, USER);
check(pub.status < 300, "publicar no catálogo (usuário logado)", pub);
const feed = async (t = "tokfeed") => { const r = await fetch(`${E("FEED_URL")}?t=${t}`); return { status: r.status, txt: await r.text() }; };
let f = await feed();
check(f.status === 200 && f.txt.includes(s3) && f.txt.includes("in stock") && f.txt.includes("199.90 BRL") && f.txt.includes(`https://outlet.exemplo/i/${s3}`), "feed CSV com o item em estoque", f.txt);
check((await feed("errado")).status === 401, "feed com token errado → 401");
check((await rpc("item_publico", { p_sku: s3 }, null)).data?.disponivel === true, "anônimo vê o item publicado, disponível");
await rpc("reservar_item", { p_sku: s3, p_canal: "whatsapp", p_origem_tipo: "manual", p_origem_ref: "t" });
f = await feed();
check(f.txt.includes("out of stock") && (await rpc("item_publico", { p_sku: s3 }, null)).data?.disponivel === false, "reservado → feed 'out of stock' e página indisponível");

console.log("== 4. Fila do Instagram: criar → aprovar → publicar → vender → comentar ==");
const s4 = sku(4, 1);
await insere("itens", [{ sku: s4, produto: "Bolsa", status: "PRONTO" }, { sku: sku(4, 2), produto: "Cinto", status: "PRONTO" }]);
const pid = (await rpc("publicacao_criar", { p_canal: "instagram", p_tipo: "feed", p_skus: [s4], p_payload: { legenda: "Bolsa linda #nogaria", midias: [`${REST}/storage/v1/object/public/ig-media/11111111-1111-1111-1111-111111111111/a.jpg`] } }, USER)).data;
check(typeof pid === "string", "rascunho criado pelo usuário logado", pid);
check((await rest(`/fila_publicacao?id=eq.${pid}`, { method: "PATCH", body: { status: "publicado" }, jwt: USER })).status >= 400 || ((await rest(`/fila_publicacao?id=eq.${pid}`)).data as any[])[0].status === "rascunho", "app não consegue mudar status direto");
check((await rpc("publicacao_aprovar", { p_id: pid }, USER)).data === "aprovado", "aprovação enfileira a publicação");
await worker();
let p = ((await rest(`/fila_publicacao?id=eq.${pid}`)).data as any[])[0];
check(p.status === "publicado" && String(p.external_id).startsWith("dry_") && p.publicado_em, "worker publica (simulado) e registra o id", p);
const ls = (await rest(`/listing_state?sku=eq.${s4}&canal=eq.instagram`)).data as any[];
check(ls[0]?.estado === "publicado" && ls[0].external_listing_id === p.external_id, "listing_state do Instagram atualizado");
const venda = await rpc("baixar_venda", { p_sku: s4, p_valor: 120, p_canal_venda: "WhatsApp", p_pedido_ref: "T-1", p_user: "teste" }, USER);
check(venda.status < 300, "venda registrada pela RPC", venda);
const jv = (await rest(`/integracao_jobs?idem_key=like.ret:instagram:${s4}:*`)).data as any[];
check(jv.length === 1 && jv[0].payload.media_id === p.external_id, "venda enfileira o comentário VENDIDO no post certo", jv);
await worker();
check(((await rest(`/integracao_jobs?idem_key=like.ret:instagram:${s4}:*`)).data as any[])[0].status === "ok", "comentário VENDIDO processado (simulado)");
check(((await rest(`/fila_publicacao?id=eq.${pid}`)).data as any[])[0].status === "esgotado", "publicação com todos os itens vendidos fica esgotada");
const s42 = sku(4, 2);
const pid2 = (await rpc("publicacao_criar", { p_canal: "instagram", p_tipo: "feed", p_skus: [s42], p_payload: { legenda: "x", midias: [`${REST}/storage/v1/object/public/ig-media/11111111-1111-1111-1111-111111111111/b.jpg`] } }, USER)).data;
await rpc("publicacao_agendar", { p_id: pid2, p_quando: new Date(Date.now() + 864e5).toISOString() }, USER);
check((await rpc("publicacao_aprovar", { p_id: pid2 }, USER)).data === "agendado", "aprovação com horário futuro fica agendada");
check((await rpc("publicacoes_enfileirar_vencidas", {})).data === 0, "agendada ainda não vencida não é enfileirada");
await rest(`/fila_publicacao?id=eq.${pid2}`, { method: "PATCH", body: { agendado_para: new Date(Date.now() - 6e4).toISOString() } });
check((await rpc("publicacoes_enfileirar_vencidas", {})).data === 1, "agendada vencida é enfileirada pelo cron");
await worker();
check(((await rest(`/fila_publicacao?id=eq.${pid2}`)).data as any[])[0].status === "publicado", "agendada publicada pelo worker");

const pidX = (await rpc("publicacao_criar", { p_canal: "instagram", p_tipo: "feed", p_skus: [sku(4, 2)], p_payload: { legenda: "x", midias: ["https://evil.example/storage/v1/object/public/ig-media/11111111-1111-1111-1111-111111111111/a.jpg"] } }, USER));
check(pidX.status < 300, "URL com o padrão do bucket mas host de outro projeto passa na RPC (a barreira é o worker)");
await rpc("publicacao_aprovar", { p_id: pidX.data }, USER); await worker();
const px = ((await rest(`/fila_publicacao?id=eq.${pidX.data}`)).data as any[])[0];
check(px.status === "cancelado" && /fora do bucket/.test(px.erro), "worker recusa mídia de host que não é o do projeto", px);

console.log("== 5. Mercado Livre: inbox validada ==");
const evt = { topic: "orders_v2", resource: "/orders/1", user_id: 77, application_id: 99, sent: "2026-11-02T10:00:00Z" };
const ml = (o: unknown) => fetch(E("ML_URL"), { method: "POST", body: JSON.stringify(o) });
check((await (await ml(evt)).json()).duplicado === false, "evento válido entra na inbox");
check((await (await ml(evt)).json()).duplicado === true, "reenvio do ML é duplicado");
check((await ml({ ...evt, user_id: 1 })).status === 403, "origem inválida → 403");
await worker();
check(((await rest(`/webhook_eventos?canal=eq.mercadolivre`)).data as any[]).every((e) => e.processado_em), "worker marca o evento do ML como processado");

console.log("== 6. Reabrir sacola vencida (renovarSacola → reservar_itens) ==");
const [r1s, r2s, r3s] = [sku(6, 1), sku(6, 2), sku(6, 3)];
await insere("itens", [r1s, r2s, r3s, sku(6, 9)].map((k) => ({ sku: k, produto: "R", status: "PRONTO" })));
const reservaSacola = (skus: string[], ref: string, dias: number) => rpc("reservar_itens", { p_skus: skus, p_canal: "whatsapp", p_origem_tipo: "sacola", p_origem_ref: ref, p_expira_em: new Date(Date.now() + dias * 864e5).toISOString(), p_user: "teste" }, USER);
check((await reservaSacola([r1s, r2s], "ORC-R1", -1)).status < 300, "sacola separada (prazo já vencido)");
const rr = await reservaSacola([r1s, r2s], "ORC-R1", 7);
const at = (await rest(`/reservas?sku=in.(${r1s},${r2s})&status=eq.ATIVA`)).data as any[];
check(rr.status < 300 && at.length === 2 && at.every((r) => new Date(r.expira_em) > new Date(Date.now() + 6 * 864e5)), "reabrir: itens reservados de novo por 7 dias", at);
await reservaSacola([r3s], "ORC-R2", -1);
await rpc("reservas_expirar", {}, USER);
check((await reservaSacola([r3s], "ORC-OUTRO", 3)).status < 300, "outra origem pegou o item enquanto a sacola estava vencida");
const conflito = await reservaSacola([r3s, sku(6, 9)], "ORC-R2", 3);
check(conflito.status >= 400 && /ORC-OUTRO/.test(JSON.stringify(conflito.data)), "reabrir com item já separado por outro é recusado com o motivo", conflito.data);

console.log("== 7. Guarda de status (N1/N2): o app não consegue vender direto ==");
const [v1, v2, v3] = [sku(7, 1), sku(7, 2), sku(7, 3)];
await insere("itens", [v1, v2, v3].map((k) => ({ sku: k, produto: "V", status: "PRONTO" })));
const direto = await rest(`/itens?sku=eq.${v1}`, { method: "PATCH", body: { status: "VENDIDO" }, jwt: USER });
check(direto.status >= 400 && /só por RPC/.test(JSON.stringify(direto.data)), "PATCH direto para VENDIDO (usuário logado) é recusado pelo banco", direto);
check(((await rest(`/itens?sku=eq.${v1}`)).data as any[])[0].status === "PRONTO", "o item continua PRONTO depois da tentativa");
check((await rest(`/itens?sku=eq.${v1}`, { method: "PATCH", body: { status: "PRECIFICADO" }, jwt: USER })).status < 300, "etapa comum da triagem continua editável direto");
check((await rpc("mover_etapa", { p_sku: v1, p_para: "PRONTO", p_user: "teste", p_de_label: "Precificado" }, USER)).status < 300, "mover_etapa por RPC funciona");
// o cenário do R1: o bot reservou, a equipe tenta vender na ficha para outra origem
await rpc("reservar_item", { p_sku: v2, p_canal: "whatsapp", p_origem_tipo: "carrinho_wa", p_origem_ref: "5591900000009", p_expira_em: new Date(Date.now() + 36e5).toISOString() });
const vendaFicha = await rpc("baixar_venda", { p_sku: v2, p_valor: 80, p_canal_venda: "B2C / Venda direta", p_pedido_ref: "FICHA-1", p_user: "teste" }, USER);
check(vendaFicha.status >= 400 && /reservado por 5591900000009/.test(JSON.stringify(vendaFicha.data)), "vender na ficha item reservado pelo bot é recusado com o motivo", vendaFicha.data);
check((await rpc("baixar_venda", { p_sku: v3, p_valor: 50, p_canal_venda: "WhatsApp", p_pedido_ref: "OK-1", p_user: "teste" }, USER)).status < 300, "venda de item livre passa pela RPC");
check((await rpc("mover_etapa", { p_sku: v3, p_para: "PRONTO", p_user: "teste" }, USER)).status >= 400, "voltar item vendido por mover_etapa é recusado");
check((await rpc("marcar_entregue", { p_sku: v3, p_user: "teste" }, USER)).status < 300, "marcar_entregue por RPC");
const reab = await rpc("reabrir_estoque", { p_sku: v3, p_motivo: "cliente devolveu", p_para: "PRONTO", p_user: "teste" }, USER);
check(reab.status < 300 && ((await rest(`/itens?sku=eq.${v3}`)).data as any[])[0].status === "PRONTO", "reabrir_estoque devolve o item ao estoque");

console.log("== 8. Retirada em todos os canais (N4) ==");
const w1 = sku(8, 1);
await insere("itens", { sku: w1, produto: "W", status: "PRONTO" });
await insere("listing_state", [
  { sku: w1, canal: "instagram", estado: "publicado", external_listing_id: "dry_M8" },
  { sku: w1, canal: "whatsapp", estado: "publicado", external_listing_id: null },
  { sku: w1, canal: "amazon", estado: "publicado", external_listing_id: "A8" }]);
check((await rpc("baixar_venda", { p_sku: w1, p_valor: 70, p_canal_venda: "WhatsApp", p_pedido_ref: "R-8", p_user: "teste" }, USER)).status < 300, "venda de item publicado em 3 canais");
const jr = (await rest(`/integracao_jobs?payload->>sku=eq.${w1}`)).data as any[];
check(jr.length === 3 && ["amazon.quantidade", "catalogo.retirar", "ig.comentar_vendido"].every((t) => jr.some((j) => j.tipo === t)), "1 job por canal publicado", jr.map((j) => j.tipo));
await worker();
check(((await rest(`/integracao_jobs?payload->>sku=eq.${w1}`)).data as any[]).every((j) => j.status === "ok"), "worker processa os 3 jobs (dry-run) sem erro");

console.log("== 9. Saúde geral ==");
const ruins = (await rest(`/integracao_jobs?status=in.(erro,morto)`)).data as any[];
check(ruins.length === 0, "nenhum job em erro/morto ao final", ruins);

console.log(`\n${ok} PASS, ${falhas} FAIL`);
Deno.exit(falhas ? 1 : 0);
