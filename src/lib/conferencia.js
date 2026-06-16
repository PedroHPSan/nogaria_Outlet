// Conferência de produtos: definir/reatribuir lote (com rename de SKU) e
// inventário físico (marcar item como conferido). Lógica de dados isolada dos
// componentes, espelhando o padrão de retry-em-colisão de NewItem.jsx.
import { supabase } from "./supabase";
import { buildSku } from "./model";

// Próximo sequencial dentro de um lote real (parseia o sufixo do maior SKU).
async function proximoSeqLote(lote) {
  const { data } = await supabase
    .from("itens").select("sku").eq("lote", lote).order("sku", { ascending: false }).limit(1);
  if (data && data.length) return (parseInt(data[0].sku.split("-").pop(), 10) || 0) + 1;
  return 1;
}

// Garante que o lote exista em `lotes` antes de associar itens (FK itens_lote_fkey).
export async function garantirLote(lote, referencia) {
  const { error } = await supabase
    .from("lotes").insert({ lote: Number(lote), referencia: referencia?.trim() || null });
  if (error && error.code !== "23505") throw error; // 23505 = já existe
}

// Atribui (ou troca) o lote de um item, regenerando o SKU para NOG-<lote>-<seq>.
// As FKs fotos/publicacoes têm ON UPDATE CASCADE; eventos não tem FK e é
// atualizado à mão para manter o histórico ligado ao novo SKU. Retorna o novo SKU.
export async function atribuirLote(skuAntigo, lote, user) {
  const loteN = Number(lote);
  let seq = await proximoSeqLote(loteN);
  let novoSku = buildSku(loteN, seq);
  let ok = false, lastErr = null;
  for (let i = 0; i < 6; i++) {
    const { error } = await supabase
      .from("itens").update({ sku: novoSku, lote: loteN, upd_by: user.email }).eq("sku", skuAntigo);
    if (!error) { ok = true; break; }
    lastErr = error;
    if (error.code === "23505") { seq++; novoSku = buildSku(loteN, seq); } // colisão de SKU
    else break;
  }
  if (!ok) throw lastErr || new Error("Falha ao atribuir o lote.");

  await supabase.from("eventos").update({ sku: novoSku }).eq("sku", skuAntigo);
  await supabase.from("eventos").insert({
    sku: novoSku, acao: "lote:atribuido", detalhe: `${skuAntigo} → ${novoSku}`, usuario: user.email,
  });
  return novoSku;
}

// Marca um item como conferido fisicamente (carimbo de quem/quando) + auditoria.
export async function marcarConferido(sku, user) {
  const { error } = await supabase
    .from("itens")
    .update({ conferido_em: new Date().toISOString(), conferido_por: user.email })
    .eq("sku", sku);
  if (error) throw error;
  await supabase.from("eventos").insert({ sku, acao: "conferido", usuario: user.email });
}

// Limpa a marcação de conferência (reiniciar a conferência de um lote).
export async function limparConferencia(sku) {
  const { error } = await supabase
    .from("itens").update({ conferido_em: null, conferido_por: null }).eq("sku", sku);
  if (error) throw error;
}
