// Acesso a dados do preço rápido: faixas de desconto por idade e aplicação em
// massa. Tolerante à migration 20260801120000 ainda não aplicada (usa o padrão).
import { supabase } from "./supabase";
import { FAIXAS_PADRAO } from "./precoRapido.js";

export async function carregarFaixas() {
  try {
    const { data, error } = await supabase.from("pricing_markdown_idade").select("dias_min, dias_max, pct").order("dias_min");
    if (!error && data?.length) return data;
  } catch { /* tabela inexistente: segue com o padrão */ }
  return FAIXAS_PADRAO;
}

// custo_proporcional (rateio do lote) por SKU, em lotes — alimenta o piso do motor.
export async function carregarCustos(skus) {
  const out = {};
  for (let i = 0; i < skus.length; i += 150) {
    const { data, error } = await supabase.from("vw_precificacao").select("sku, custo_proporcional").in("sku", skus.slice(i, i + 150));
    if (error) break; // view ausente: custo 0 (piso menos preciso — a UI avisa)
    (data || []).forEach((r) => { out[r.sku] = r.custo_proporcional; });
  }
  return out;
}

// Aplica as linhas com `aplicar` (preco_ideal) e registra o evento de cada uma.
// Retorna { ok, erros:[{sku, msg}] } — uma falha não derruba as demais.
export async function aplicarPlano(linhas, user) {
  const erros = [];
  let ok = 0;
  for (const l of linhas.filter((x) => x.aplicar && x.novo > 0)) {
    const { error } = await supabase.from("itens").update({ preco_ideal: l.novo, upd_by: user.email }).eq("sku", l.sku);
    if (error) { erros.push({ sku: l.sku, msg: error.message }); continue; }
    ok += 1;
    try {
      await supabase.from("eventos").insert({
        sku: l.sku, acao: `preco:rapido ${l.atual ?? "—"}→${l.novo} (${l.pctMarkdown}% idade)`, usuario: user.email,
      });
    } catch { /* auditoria best-effort */ }
  }
  return { ok, erros };
}
