// Persistência do assistente de IA: grava o backfill (campos vazios) + o snapshot
// durável ia_analise numa única escrita, com auditoria best-effort.
import { supabase } from "./supabase";

export async function salvarAnaliseIA(sku, patch, iaAnalise, user) {
  const { data, error } = await supabase.from("itens")
    .update({ ...patch, ia_analise: iaAnalise, upd_by: user?.email })
    .eq("sku", sku).select().single();
  if (error) throw error;
  try {
    await supabase.from("eventos").insert({
      sku, acao: "ia:enriquecido",
      detalhe: `${(iaAnalise.aplicados || []).length} campo(s) · confiança ${iaAnalise.confianca || "—"}`,
      usuario: user?.email,
    });
  } catch { /* auditoria best-effort */ }
  return data;
}
