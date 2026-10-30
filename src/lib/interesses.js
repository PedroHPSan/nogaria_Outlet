// Pedidos de interesse da página pública no modo euro (tabela `interesses`).
// O cliente registra via RPC anônima (valor calculado no servidor); a equipe confere pelo código.
import { supabase } from "./supabase.js";
import { precoMisto } from "./precoEuro.js";

// O servidor decide preço e cotação (tabela `cotacoes`); o cliente só diz qual item e idioma.
// Retorna { codigo, eur, taxa, taxa_em, valido_ate } ou null se falhar (a venda segue só com o texto).
export async function registrarInteresse(slug, sku, lang) {
  try {
    const { data, error } = await supabase.rpc("registrar_interesse", { p_slug: slug, p_sku: sku, p_lang: lang });
    return error ? null : data;
  } catch { return null; }
}

export async function listarInteresses({ limite = 100 } = {}) {
  const { data, error } = await supabase.from("interesses").select("*").order("criado_em", { ascending: false }).limit(limite);
  if (error) throw error;
  return data || [];
}

export async function marcarInteresse(id, status) {
  const { error } = await supabase.from("interesses").update({ status }).eq("id", id);
  if (error) throw error;
}

// Pedido vencido (> 24 h) precisa ser recalculado com a cotação de agora.
export const vencido = (p, agora = Date.now()) => new Date(p.valido_ate).getTime() < agora;

// Valor em € de um pedido com a cotação atual (mesma fórmula do servidor).
export const eurAgora = (p, taxa) => precoMisto(p.brl_base, taxa)?.eur ?? null;
