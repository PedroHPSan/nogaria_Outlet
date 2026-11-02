// Processador do canal WhatsApp: lê o evento da inbox e executa as ações (contatos, log de mensagens,
// reservas por "QUERO NOG-…", código de pedido em €, carrinho do catálogo, opt-in/opt-out, custos).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { enviarTexto, extrairEventos, interpretarTexto, motivoAmigavel, type Msg } from "../_shared/whatsapp.ts";

const HORAS_RESERVA = 2; // hold curto: estoque único não pode ficar preso por quem não pagou (a equipe assume ao criar a sacola)
const HORAS_FEP = 72; // janela grátis de ponto de entrada de anúncio (Click-to-WhatsApp)
const MAX_RESERVAS_POR_NUMERO = 3; // evita travar o estoque por mensagens em massa
type Ctx = { dryRun: boolean; admin: SupabaseClient };

async function responder(ctx: Ctx, para: string, texto: string) {
  const id = await enviarTexto(para, texto, {
    token: Deno.env.get("WHATSAPP_TOKEN"), phoneNumberId: Deno.env.get("WHATSAPP_PHONE_NUMBER_ID"),
    versao: Deno.env.get("WHATSAPP_API_VERSION") ?? undefined, dryRun: ctx.dryRun,
  });
  await ctx.admin.from("mensagens_whatsapp").upsert(
    { wa_message_id: id, wa_id: para, direcao: "out", tipo: "text", texto, status: "sent" },
    { onConflict: "wa_message_id", ignoreDuplicates: true },
  );
}

// Reserva pelo RPC `whatsapp_reservar`: teto por número, exigência de item publicado e lock, tudo no banco.
// Devolve { novos } (SKUs reservados agora; 0 = já eram do número) ou { erro }.
async function reservar(ctx: Ctx, waId: string, skus: string[], origemTipo: string, origemRef: string, ate: Date, exigirPublicado: boolean) {
  const { data, error } = await ctx.admin.rpc("whatsapp_reservar", {
    p_wa_id: waId, p_skus: skus, p_origem_tipo: origemTipo, p_origem_ref: origemRef, p_expira_em: ate.toISOString(),
    p_max: MAX_RESERVAS_POR_NUMERO, p_exigir_publicado: exigirPublicado,
  });
  return error ? { erro: error.message } : { novos: Number(data) };
}

async function tratarMensagem(ctx: Ctx, m: Msg) {
  const agora = new Date();
  await ctx.admin.from("contatos_whatsapp").upsert({
    wa_id: m.from, ...(m.nome ? { nome: m.nome } : {}), janela_ate: new Date(+agora + 24 * 3600e3).toISOString(), atualizado_em: agora.toISOString(),
  }, { onConflict: "wa_id" });
  if (m.referral) { // atribuição venda → anúncio; só sobrescreve quando vier um clique novo
    await ctx.admin.from("contatos_whatsapp").update({
      ctwa_clid: m.referral.ctwaClid, referral_source_id: m.referral.sourceId, referral_source_type: m.referral.sourceType,
      referral_headline: m.referral.headline, referral_em: agora.toISOString(),
      fep_ate: m.referral.ctwaClid ? new Date(+agora + HORAS_FEP * 3600e3).toISOString() : null,
    }).eq("wa_id", m.from);
  }
  // Idempotência: o wamid já registrado significa que esta mensagem foi tratada antes.
  const { error: eDup } = await ctx.admin.from("mensagens_whatsapp").insert(
    { wa_message_id: m.id, wa_id: m.from, direcao: "in", tipo: m.tipo, texto: m.texto, payload: m.bruto });
  if (eDup?.code === "23505") return;
  if (eDup) throw new Error(eDup.message);

  const ate = new Date(+agora + HORAS_RESERVA * 3600e3);
  if (m.tipo === "order" && m.itens.length) {
    const skus = [...new Set(m.itens.map((i) => i.sku))];
    const r = await reservar(ctx, m.from, skus, "carrinho_wa", m.from, ate, true);
    return responder(ctx, m.from, r.erro ? motivoAmigavel(r.erro)
      : r.novos === 0 ? "Esses itens já estão reservados para você."
      : `Reservei ${skus.join(", ")} por ${HORAS_RESERVA}h. Nossa equipe confirma o pagamento por aqui.`);
  }
  const it = m.texto ? interpretarTexto(m.texto) : null;
  if (!it) return; // conversa livre → atendimento humano
  if (it.tipo === "sair") {
    await ctx.admin.from("contatos_whatsapp").update({ opt_out_em: agora.toISOString() }).eq("wa_id", m.from);
    return responder(ctx, m.from, "Pronto, você não receberá mais novidades. Se mudar de ideia, envie ENTRAR.");
  }
  if (it.tipo === "entrar") {
    await ctx.admin.from("contatos_whatsapp").update({ opt_in_em: agora.toISOString(), opt_out_em: null }).eq("wa_id", m.from);
    return responder(ctx, m.from, "Combinado! Você vai receber as novidades do Outlet. Para parar, envie SAIR.");
  }
  if (it.tipo === "quero") {
    const r = await reservar(ctx, m.from, [it.sku], "carrinho_wa", m.from, ate, true);
    return responder(ctx, m.from, r.erro ? motivoAmigavel(r.erro)
      : r.novos === 0 ? `${it.sku} já está reservado para você.`
      : `Reservei ${it.sku} para você por ${HORAS_RESERVA}h. Nossa equipe confirma o pagamento por aqui.`);
  }
  // código de pedido em €: o RPC amarra o código ao primeiro número que o reivindica e limita tentativas inválidas
  const { data: r } = await ctx.admin.rpc("whatsapp_reivindicar_codigo", { p_wa_id: m.from, p_codigo: it.codigo });
  if (!r || r.status === "invalido" || r.status === "bloqueado") return; // sem resposta: não confirma se o código existe
  if (r.status === "ja_usado") return responder(ctx, m.from, "Esse código já está em atendimento. Fale com a nossa equipe.");
  if (!r.nova) return responder(ctx, m.from, `Pedido ${it.codigo} já recebido. Nossa equipe envia o link de pagamento em breve.`);
  // o item do pedido em € já foi validado quando o pedido foi criado (oferta pública em €): não exige publicação de novo
  const res = await reservar(ctx, m.from, [r.sku], "interesse", it.codigo, new Date(r.valido_ate), false);
  return responder(ctx, m.from, res.erro ? motivoAmigavel(res.erro)
    : `Pedido ${it.codigo} recebido: ${r.sku} reservado. Nossa equipe envia o link de pagamento em breve.`);
}

export async function processarWhatsapp(payload: Record<string, unknown>, ctx: Ctx) {
  const { data: ev, error } = await ctx.admin.from("webhook_eventos").select("payload, processado_em")
    .eq("canal", String(payload.canal)).eq("external_id", String(payload.external_id)).single();
  if (error) throw new Error(error.message);
  if (ev.processado_em) return;
  const { mensagens, statuses, ecos } = extrairEventos(ev.payload);
  for (const m of mensagens) await tratarMensagem(ctx, m);
  for (const e of ecos) { // resposta da equipe pelo aplicativo: entra no histórico da conversa como saída
    const { error: eEco } = await ctx.admin.from("mensagens_whatsapp").upsert(
      { wa_message_id: e.id, wa_id: e.para, direcao: "out", tipo: e.tipo, texto: e.texto, status: "sent" },
      { onConflict: "wa_message_id", ignoreDuplicates: true });
    if (eEco) throw new Error(eEco.message);
  }
  for (const s of statuses) {
    // `statuses` traz o custo real: categoria/billable/pricing_model (só no status "sent"/"delivered").
    const { error: e } = await ctx.admin.from("mensagens_whatsapp").upsert({
      wa_message_id: s.id, wa_id: s.para, direcao: "out", status: s.status,
      ...(s.categoria ? { categoria: s.categoria, billable: s.billable, pricing_model: s.pricingModel } : {}),
    }, { onConflict: "wa_message_id" });
    if (e) throw new Error(e.message);
  }
  await ctx.admin.from("webhook_eventos").update({ processado_em: new Date().toISOString() })
    .eq("canal", String(payload.canal)).eq("external_id", String(payload.external_id));
}
