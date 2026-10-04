// Predefinições e histórico de catálogos (migration M7). Falha em silêncio quando as
// tabelas ainda não existem: o catálogo continua funcionando, só sem persistência.
import { supabase } from "./supabase";

export async function listarPredefinicoes() {
  try {
    const { data, error } = await supabase.from("catalogo_predefinicoes").select("id, nome, spec").order("criado_em", { ascending: false }).limit(50);
    if (!error && data) return data;
  } catch { /* sem tabela */ }
  return [];
}

export async function salvarPredefinicao(nome, spec, user) {
  const { error } = await supabase.from("catalogo_predefinicoes").insert({ nome: nome.trim().slice(0, 60), spec, criado_por: user?.email });
  if (error) throw error;
}

export async function excluirPredefinicao(id) {
  await supabase.from("catalogo_predefinicoes").delete().eq("id", id);
}

// Registro best-effort do que foi gerado (formato: pdf | link | cards | texto | csv).
export async function registrarHistorico({ titulo, formato, nItens, spec }, user) {
  try { await supabase.from("catalogo_historico").insert({ titulo, formato, n_itens: nItens, spec, criado_por: user?.email }); }
  catch { /* histórico é opcional */ }
}

export async function listarHistorico(limite = 10) {
  try {
    const { data, error } = await supabase.from("catalogo_historico").select("id, titulo, formato, n_itens, criado_em").order("criado_em", { ascending: false }).limit(limite);
    if (!error && data) return data;
  } catch { /* sem tabela */ }
  return [];
}
