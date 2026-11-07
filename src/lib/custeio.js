// Custeio do lote: modo 'rateio' (valor do lote fixo, rateado entre os itens) ou 'soma' (custo do lote =
// soma do custo direto dos itens), mais custos adicionais (frete, separador…) no lote ou num item.
// O banco mantém lotes.custo_total e pricing_lote_custo por trigger (migration custeio_lote_produto).
import { supabase } from "./supabase";
import { limparCache } from "./motorPrecoDb";
import { loteSemCusto } from "./custoLote.js";

export { TIPOS_EXTRA, REGRAS_RATEIO, rotuloTipo, toNum, emTexto, formInicial, totalPrevisto, lerColado, payloadCusteio, BASES_GLOBAL, globalVazio, lerListaTexto, lerListaLotes, validarGlobal, soErros, descreverGlobal, globalVigente } from "./custeioCore.js";
import { toNum, formInicial, payloadCusteio, lerListaTexto, lerListaLotes } from "./custeioCore.js";

// Todas as páginas (PostgREST corta em 1.000).
async function paginado(montar) {
  let out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await montar().range(from, from + 999);
    if (error) throw error;
    out = out.concat(data || []);
    if (!data || data.length < 1000) break;
  }
  return out;
}

export const carregarItensCusto = (lote) =>
  paginado(() => supabase.from("itens")
    .select("sku,produto,status,custo_direto,valor_vendido,preco_sugerido").eq("lote", lote).order("sku"));

export async function carregarExtras(lote) {
  const { data, error } = await supabase.from("lote_custos_extra").select("id,sku,tipo,descricao,valor").eq("lote", lote).order("id");
  if (error) throw error;
  return data || [];
}

// Grava TUDO numa transação (RPC salvar_custeio_lote): custo direto das peças, extras (editados por id) e o lote.
// Se a migration custos_lote_v2 ainda não está no banco, cai no caminho antigo (várias chamadas) para não travar o uso.
export async function salvarCusteio({ lote, form, diretosAlterados }) {
  if (form.modo === "rateio" && !(toNum(form.valor) > 0)) throw new Error("Informe o valor pago pelo lote.");
  const { error } = await supabase.rpc("salvar_custeio_lote", payloadCusteio(lote, form, diretosAlterados));
  if (!error) { limparCache(); return; }
  if (error.code === "PGRST202" || /could not find the function/i.test(error.message || "")) return salvarCusteioLegado({ lote, form, diretosAlterados });
  throw error;
}

// Histórico de alterações de custo do lote (custo_auditoria).
export async function carregarHistoricoCusto(lote, limite = 100) {
  const { data, error } = await supabase.from("custo_auditoria").select("id,tabela,sku,acao,antes,depois,usuario,ts").eq("lote", lote).order("ts", { ascending: false }).limit(limite);
  if (error) throw error;
  return data || [];
}

async function salvarCusteioLegado({ lote, form, diretosAlterados }) {
  const valor = toNum(form.valor);
  if (form.modo === "rateio" && !(valor > 0)) throw new Error("Informe o valor pago pelo lote.");
  const { data: u } = await supabase.auth.getUser();
  const email = u?.user?.email || null;

  // 1) custo direto dos itens primeiro (o trigger do modo "soma" recalcula a cada item)
  const entradas = Object.entries(diretosAlterados);
  for (let i = 0; i < entradas.length; i += 20) {
    const res = await Promise.all(entradas.slice(i, i + 20).map(([sku, v]) =>
      supabase.from("itens").update({ custo_direto: toNum(v), upd_by: email }).eq("sku", sku)));
    const falha = res.find((r) => r.error);
    if (falha) throw falha.error;
  }
  // 2) adicionais: substitui a lista inteira do lote
  const del = await supabase.from("lote_custos_extra").delete().eq("lote", lote.lote);
  if (del.error) throw del.error;
  const linhas = form.extras.filter((e) => toNum(e.valor) > 0).map((e) => ({
    lote: lote.lote, sku: e.sku.trim() || null, tipo: e.tipo, descricao: e.descricao.trim() || null,
    valor: toNum(e.valor), criado_por: email,
  }));
  if (linhas.length) {
    const ins = await supabase.from("lote_custos_extra").insert(linhas);
    if (ins.error) throw ins.error;
  }
  // 3) o lote vira "composto"; fretes/outros legados já foram para os adicionais
  const comissao = toNum(form.comissao) ?? 0, taxa = toNum(form.taxa) ?? 0;
  const up = await supabase.from("lotes").update({
    modo_custeio: form.modo, custo_origem: "composto",
    lance_final: form.modo === "rateio" ? valor : (lote.lance_final ?? null),
    comissao_leiloeiro: form.modo === "rateio" ? comissao : (lote.comissao_leiloeiro ?? null),
    taxa_hisa: form.modo === "rateio" ? taxa : (lote.taxa_hisa ?? null),
    valor_pago_hisa: form.modo === "rateio" ? valor + comissao + taxa : (lote.valor_pago_hisa ?? null),
    frete_retirada: null, frete_transferencia: null, outros_custos: null,
  }).eq("lote", lote.lote);
  if (up.error) throw up.error;
  limparCache();
}


// Custo de UMA peça (ficha do item). Lote sem custo → vira "por peça" (soma dos itens); lote composto → só o custo direto;
// lote legado com custo geral → recusa com a explicação (não descarta o custo que já existe).
export async function salvarCustoItem({ lote, item, valor }) {
  const v = toNum(valor);
  if (v == null || v < 0) throw new Error("Informe um valor válido.");
  if (!lote) throw new Error("Esta peça não tem lote.");
  if (lote.custo_origem === "composto") {
    const { data: u } = await supabase.auth.getUser();
    const r = await supabase.from("itens").update({ custo_direto: v, upd_by: u?.user?.email || null }).eq("sku", item.sku);
    if (r.error) throw r.error;
    limparCache();
    return { convertido: false };
  }
  if (!loteSemCusto(lote)) {
    throw new Error(`O lote ${lote.lote} já tem um custo geral cadastrado. Para dar custo por peça, abra "Custo do lote" e escolha "Soma dos itens".`);
  }
  const form = { ...formInicial(lote, await carregarExtras(lote.lote)), modo: "soma" };
  await salvarCusteio({ lote, form, diretosAlterados: { [item.sku]: String(v).replace(".", ",") } });
  return { convertido: true };
}


// ---- Custos globais (tabelas custos_globais / custos_globais_excecao) ----
export async function listarGlobais() {
  const { data, error } = await supabase.from("custos_globais").select("*").order("id");
  if (error) throw error;
  return data || [];
}
export async function listarExcecoes(globalId) {
  const { data, error } = await supabase.from("custos_globais_excecao").select("lote").eq("global_id", globalId);
  if (error) throw error;
  return (data || []).map((r) => r.lote);
}
export async function salvarGlobal(f) {
  const { data: u } = await supabase.auth.getUser();
  const linha = {
    nome: f.nome.trim(), tipo: f.tipo, valor: toNum(f.valor), base: f.base, regra_rateio: f.regra_rateio,
    grupos: lerListaTexto(f.grupos).length ? lerListaTexto(f.grupos) : null,
    lotes: lerListaLotes(f.lotes).length ? lerListaLotes(f.lotes) : null,
    vigencia_inicio: f.vigencia_inicio, vigencia_fim: f.vigencia_fim || null, ativo: !!f.ativo, atualizado_em: new Date().toISOString(),
  };
  const r = f.id ? await supabase.from("custos_globais").update(linha).eq("id", f.id)
                 : await supabase.from("custos_globais").insert({ ...linha, criado_por: u?.user?.email || null });
  if (r.error) throw r.error;
  limparCache();
}
export async function removerGlobal(id) {
  const { error } = await supabase.from("custos_globais").delete().eq("id", id);
  if (error) throw error;
  limparCache();
}
export async function definirExcecao(globalId, lote, excecao) {
  const r = excecao
    ? await supabase.from("custos_globais_excecao").upsert({ global_id: globalId, lote })
    : await supabase.from("custos_globais_excecao").delete().eq("global_id", globalId).eq("lote", lote);
  if (r.error) throw r.error;
  limparCache();
}
