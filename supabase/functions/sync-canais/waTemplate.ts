// Handler `wa.template`: envia um template utility (cobrança / pagamento / entrega) de uma sacola.
// O destinatário e os parâmetros vêm SEMPRE do banco (orcamentos), nunca do payload do job.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { EVENTOS, numeroWa, paramsEvento, previa, TEMPLATES, type Evento } from "../_shared/waTemplates.ts";

type Ctx = { dryRun: boolean; admin: SupabaseClient };

export async function enviarTemplate(payload: Record<string, unknown>, ctx: Ctx) {
  const evento = payload.evento as Evento;
  if (payload.ref_tipo !== "sacola" || !EVENTOS.includes(evento)) throw new Error("payload inválido");
  const ref = String(payload.ref);
  const { data: s, error } = await ctx.admin.from("orcamentos")
    .select("codigo, cliente_nome, cliente_whatsapp, itens, total, validade").eq("codigo", ref).eq("origem", "whatsapp").single();
  if (error) throw new Error(`sacola ${ref}: ${error.message}`);
  const para = numeroWa(s.cliente_whatsapp);
  if (!para) throw new Error(`sacola ${ref}: WhatsApp do cliente ausente ou inválido`);

  // Já enviado com sucesso (retomada após falha ao gravar o log) → não duplica.
  const { count } = await ctx.admin.from("mensagens_whatsapp").select("id", { count: "exact", head: true })
    .eq("ref_tipo", "sacola").eq("ref", ref).eq("evento", evento).eq("direcao", "out").not("wa_message_id", "is", null);
  if ((count ?? 0) > 0) return;

  const params = paramsEvento(evento, s);
  const tpl = TEMPLATES[evento];
  let wamid: string | null = null;
  const token = Deno.env.get("WHATSAPP_TOKEN"), phone = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (ctx.dryRun || !token || !phone) {
    console.log(`[wa dry-run] template ${tpl.nome} -> ${para}: ${previa(evento, params)}`);
  } else {
    const r = await fetch(`https://graph.facebook.com/${Deno.env.get("WHATSAPP_API_VERSION") ?? "v23.0"}/${phone}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to: para, type: "template",
        template: { name: tpl.nome, language: { code: "pt_BR" },
          components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`WhatsApp ${r.status}: ${JSON.stringify(j?.error ?? j).slice(0, 300)}`);
    wamid = j?.messages?.[0]?.id ?? null;
  }
  const { error: eLog } = await ctx.admin.from("mensagens_whatsapp").insert({
    wa_message_id: wamid, wa_id: para, direcao: "out", tipo: "template", texto: previa(evento, params),
    status: wamid ? "sent" : "dry_run", ref_tipo: "sacola", ref, evento, template: tpl.nome,
  });
  if (eLog) throw new Error(eLog.message);
}
