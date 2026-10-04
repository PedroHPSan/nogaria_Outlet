// Contato da Nogária editável sem deploy (tabela empresa_config, migration M6).
// Tolerante à ausência da tabela: cai no EMPRESA fixo.
import { supabase } from "./supabase";
import { configParaContato, CHAVES_CONTATO } from "./empresaConfigCore";

export async function carregarEmpresaConfig() {
  try {
    const { data, error } = await supabase.from("empresa_config").select("chave, valor");
    if (!error && data) return Object.fromEntries(data.map((r) => [r.chave, r.valor]));
  } catch { /* tabela inexistente */ }
  return {};
}

export const carregarContato = async () => configParaContato(await carregarEmpresaConfig());

export async function salvarEmpresaConfig(valores, user) {
  const linhas = CHAVES_CONTATO.map(({ chave }) => ({ chave, valor: String(valores[chave] ?? "").trim(), atualizado_por: user?.email, atualizado_em: new Date().toISOString() }))
    .filter((l) => l.valor);
  const vazias = CHAVES_CONTATO.map((c) => c.chave).filter((k) => !String(valores[k] ?? "").trim());
  if (linhas.length) { const { error } = await supabase.from("empresa_config").upsert(linhas); if (error) throw error; }
  if (vazias.length) await supabase.from("empresa_config").delete().in("chave", vazias);
}
