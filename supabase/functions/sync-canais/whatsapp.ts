// Processador do canal WhatsApp: lê o evento da inbox e executa as ações (contatos, log de mensagens,
// reservas por "QUERO NOG-…", código de pedido em €, carrinho do catálogo, opt-in/opt-out, custos).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { enviarTexto, extrairEventos, interpretarTexto, motivoAmigavel, type Msg } from "../_shared/whatsapp.ts";

const HORAS_RESERVA = 24;
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

async function reservar(ctx: Ctx, skus: string[], origemTipo: string, origemRef: string, ate: Date) {
  const { error } = await ctx.admin.rpc("reservar_itens", {
    p_skus: skus, p_canal: "whatsapp", p_origem_tipo: origemTipo, p_origem_ref: origemRef, p_expira_em: ate.toISOString(), p_user: "whatsapp",
  });
  return error?.message ?? null;
}

async function tratarMensagem(ctx: Ctx, m: Msg) {
  const agora = new Date();
  await ctx.admin.from("contatos_whatsapp").upsert({
    wa_id: m.from, ...(m.nome ? { nome: m.nome } : {}), janela_ate: new Date(+agora + 24 * 3600e3).toISOString(), atualizado_em: agora.toISOString(),
  }, { onConflict: "wa_id" });
  // Idempotência: o wamid já registrado significa que esta mensagem foi tratada antes.
  const { error: eDup } = await ctx.admin.from("mensagens_whatsapp").insert(
    { wa_message_id: m.id, wa_id: m.from, direcao: "in", tipo: m.tipo, texto: m.texto, payload: m.bruto });
  if (eDup?.code === "23505") return;
  if (eDup) throw new Error(eDup.message);

  const ate = new Date(+agora + HORAS_RESERVA * 3600e3);
  if (m.tipo === "order" && m.itens.length) {
    const skus = m.itens.map((i) => i.sku);
    const erro = await reservar(ctx, skus, "carrinho_wa", m.from, ate);
    return responder(ctx, m.from, erro ? motivoAmigavel(erro)
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
    const erro = await reservar(ctx, [it.sku], "carrinho_wa", m.from, ate);
    return responder(ctx, m.from, erro ? motivoAmigavel(erro)
      : `Reservei ${it.sku} para você por ${HORAS_RESERVA}h. Nossa equipe confirma o pagamento por aqui.`);
  }
  // código de pedido em € (interesses): só responde se o código existe e está aberto
  const { data: p } = await ctx.admin.from("interesses").select("sku, valido_ate")
    .eq("codigo", it.codigo).eq("status", "ABERTO").gt("valido_ate", agora.toISOString()).maybeSingle();
  if (!p) return;
  const erro = await reservar(ctx, [p.sku], "interesse", it.codigo, new Date(p.valido_ate));
  return responder(ctx, m.from, erro ? motivoAmigavel(erro)
    : `Pedido ${it.codigo} recebido: ${p.sku} reservado. Nossa equipe envia o link de pagamento em breve.`);
}

export async function processarWhatsapp(payload: Record<string, unknown>, ctx: Ctx) {
  const { data: ev, error } = await ctx.admin.from("webhook_eventos").select("payload, processado_em")
    .eq("canal", String(payload.canal)).eq("external_id", String(payload.external_id)).single();
  if (error) throw new Error(error.message);
  if (ev.processado_em) return;
  const { mensagens, statuses } = extrairEventos(ev.payload);
  for (const m of mensagens) await tratarMensagem(ctx, m);
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
