// Envio transacional pela WhatsApp Cloud API (template utility) com fallback no wa.me.
// Template/parâmetros vêm de supabase/functions/_shared/waTemplates.ts (mesma fonte do servidor).
import { supabase } from "./supabase";
import { paramsEvento, previa, TEMPLATES } from "../../supabase/functions/_shared/waTemplates.ts";

// Só aparece quando a conta da API está pronta (E1-1): evita enfileirar envios que não saem.
export const WA_API_ATIVA = import.meta.env.VITE_WHATSAPP_API === "1";

// Qual evento faz sentido para o estado atual da sacola (estado efetivo: ABERTA|VENDIDO|ENTREGUE).
export const eventoDaSacola = (estado) => ({ ABERTA: "cobranca", VENDIDO: "pago", ENTREGUE: "entrega" })[estado] || null;
export const ROTULO_EVENTO = { cobranca: "Cobrança", pago: "Pagamento", entrega: "Entrega" };

export const previaEnvio = (evento, sacola) => ({
  template: TEMPLATES[evento].nome,
  texto: previa(evento, paramsEvento(evento, sacola)),
});

export async function enviarPelaApi(sacola, evento) {
  const { error } = await supabase.rpc("whatsapp_enviar", { p_ref_tipo: "sacola", p_ref: sacola.codigo, p_evento: evento });
  if (error) throw error;
}

export async function situacaoEnvios(sacola) {
  const { data, error } = await supabase.rpc("whatsapp_envios", { p_ref_tipo: "sacola", p_ref: sacola.codigo });
  if (error) throw error;
  return data || [];
}

// Rótulo curto + se precisa do fallback manual (Cobrar por wa.me).
export function rotuloEnvio(e) {
  if (e.job_status === "morto") return { texto: "Falhou — use o botão Cobrar", falhou: true };
  if (e.msg_status === "read") return { texto: "Lida" };
  if (e.msg_status === "delivered") return { texto: "Entregue" };
  if (e.msg_status === "failed") return { texto: "Falhou — use o botão Cobrar", falhou: true };
  if (e.msg_status === "sent" || e.job_status === "ok") return { texto: "Enviada" };
  if (e.job_status === "erro") return { texto: "Tentando de novo…" };
  return { texto: "Na fila" };
}
