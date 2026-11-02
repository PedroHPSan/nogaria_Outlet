// Regras puras do WhatsApp Cloud API (sem rede/banco): interpretar texto e extrair eventos do webhook.

export type Intencao =
  | { tipo: "quero"; sku: string }
  | { tipo: "pedido"; codigo: string }
  | { tipo: "sair" }
  | { tipo: "entrar" };

const SKU = /\bNOG-(?:\d{3}|SL)-\d{3}\b/i;

// "QUERO NOG-103-415", "pedido A1B2C", "SAIR", "ENTRAR". Qualquer outro texto → null (atendimento humano).
export function interpretarTexto(texto: string): Intencao | null {
  const t = texto.trim();
  if (/^(sair|parar|stop|cancelar inscri[cç][aã]o)$/i.test(t)) return { tipo: "sair" };
  if (/^(entrar|quero receber|receber novidades)$/i.test(t)) return { tipo: "entrar" };
  const sku = t.match(SKU);
  if (sku && /\b(quero|reservar|reserva|eu quero)\b/i.test(t)) return { tipo: "quero", sku: sku[0].toUpperCase() };
  const cod = t.match(/^(?:pedido|c[oó]digo|code|pedido n[ºo])?\s*#?([A-F0-9]{5})$/i);
  if (cod) return { tipo: "pedido", codigo: cod[1].toUpperCase() };
  return null;
}

// Anúncio Click-to-WhatsApp: a Meta manda `referral` na 1ª mensagem vinda do anúncio (ctwa_clid = id do clique).
export type Referral = { ctwaClid: string | null; sourceId: string | null; sourceType: string | null; headline: string | null; sourceUrl: string | null };
export type Msg = { id: string; from: string; tipo: string; texto: string | null; nome: string | null; itens: { sku: string; quantidade: number }[]; referral: Referral | null; bruto: unknown };
export type Eco = { id: string; para: string; tipo: string; texto: string | null };
export type Status = { id: string; para: string; status: string; categoria: string | null; billable: boolean | null; pricingModel: string | null };

// Percorre entry[].changes[].value do webhook e devolve mensagens recebidas e statuses de envio.
export function extrairEventos(payload: unknown): { mensagens: Msg[]; statuses: Status[]; ecos: Eco[] } {
  const mensagens: Msg[] = []; const statuses: Status[] = []; const ecos: Eco[] = [];
  // deno-lint-ignore no-explicit-any
  for (const entry of (payload as any)?.entry ?? []) for (const ch of entry?.changes ?? []) {
    const v = ch?.value ?? {};
    const nomes = new Map<string, string>((v.contacts ?? []).map((c: { wa_id: string; profile?: { name?: string } }) => [c.wa_id, c.profile?.name ?? ""]));
    for (const m of v.messages ?? []) {
      const texto = m.type === "text" ? m.text?.body ?? null : m.type === "button" ? m.button?.text ?? null
        : m.type === "interactive" ? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null : null;
      const itens = m.type === "order"
        ? (m.order?.product_items ?? []).map((p: { product_retailer_id: string; quantity?: number }) => ({ sku: String(p.product_retailer_id).toUpperCase(), quantidade: p.quantity ?? 1 }))
        : [];
      const r = m.referral;
      const referral: Referral | null = r && (r.ctwa_clid || r.source_id)
        ? { ctwaClid: r.ctwa_clid ?? null, sourceId: r.source_id ? String(r.source_id) : null, sourceType: r.source_type ?? null, headline: r.headline ?? null, sourceUrl: r.source_url ?? null }
        : null;
      mensagens.push({ id: m.id, from: m.from, tipo: m.type, texto, nome: nomes.get(m.from) || null, itens, referral, bruto: m });
    }
    // Coexistência: o que a equipe envia pelo aplicativo WhatsApp Business chega como "message_echoes" (campo smb_message_echoes).
    for (const e of ch?.field === "smb_message_echoes" ? v.message_echoes ?? [] : []) {
      ecos.push({ id: e.id, para: e.to, tipo: e.type, texto: e.type === "text" ? e.text?.body ?? null : null });
    }
    for (const s of v.statuses ?? []) {
      statuses.push({ id: s.id, para: s.recipient_id, status: s.status, categoria: s.pricing?.category ?? null,
        billable: s.pricing?.billable ?? null, pricingModel: s.pricing?.pricing_model ?? null });
    }
  }
  return { mensagens, statuses, ecos };
}

// Traduz o erro das RPCs de reserva em texto seguro para o cliente (sem vazar códigos internos).
export function motivoAmigavel(erro: string): string {
  if (/LIMITE_RESERVAS/.test(erro)) return "Você já tem itens reservados (limite de 3). Conclua o pagamento para reservar mais.";
  if (/fora de estoque|já vendido/i.test(erro)) return "Esse item já foi vendido.";
  if (/já separado|reservado/i.test(erro)) return "Esse item já está reservado para outra pessoa.";
  if (/não encontrado/i.test(erro)) return "Não encontrei esse código. Confira e envie de novo.";
  return "Não consegui reservar agora. Nossa equipe vai te responder em breve.";
}

export async function enviarTexto(
  para: string, texto: string, o: { token?: string; phoneNumberId?: string; versao?: string; dryRun: boolean },
): Promise<string | null> {
  if (o.dryRun || !o.token || !o.phoneNumberId) { console.log(`[wa dry-run] -> ${para}: ${texto}`); return null; }
  const r = await fetch(`https://graph.facebook.com/${o.versao ?? "v23.0"}/${o.phoneNumberId}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${o.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: para, type: "text", text: { body: texto } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`WhatsApp ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j?.messages?.[0]?.id ?? null;
}
