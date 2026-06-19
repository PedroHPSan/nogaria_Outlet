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

// Define a categoria (grupo) de um item; opcionalmente preenche a classe quando
// passada (usado na categorização em massa para preencher classe ainda vazia).
export async function definirCategoria(sku, grupo, user, classe) {
  const patch = { grupo: grupo || null, upd_by: user.email };
  if (classe) patch.classe = classe;
  const { error } = await supabase.from("itens").update(patch).eq("sku", sku);
  if (error) throw error;
}

// Move um item para outra etapa (status) com rastreabilidade. Registra um evento
// "status:<novo>" com detalhe "de <etapa anterior>" para aparecer no Registro.
// Usado tanto no avanço/retorno individual quanto no mover-etapa em massa.
export async function moverEtapa(sku, novoStatus, user, deStatusLabel) {
  const { error } = await supabase
    .from("itens").update({ status: novoStatus, upd_by: user.email }).eq("sku", sku);
  if (error) throw error;
  await supabase.from("eventos").insert({
    sku, acao: "status:" + novoStatus,
    detalhe: deStatusLabel ? `de ${deStatusLabel}` : null,
    usuario: user.email,
  });
}

// Próximo sequencial considerando lote real ou itens sem lote (prefixo SL).
async function proximoSeq(lote) {
  if (lote == null || lote === "") {
    const { data } = await supabase
      .from("itens").select("sku").like("sku", "NOG-SL-%").order("sku", { ascending: false }).limit(1);
    if (data && data.length) return (parseInt(data[0].sku.split("-").pop(), 10) || 0) + 1;
    return 1;
  }
  return proximoSeqLote(Number(lote));
}

// Campos do produto copiados para cada nova unidade (sem identidade única/venda).
const CAMPOS_COPIA = [
  "lote", "produto", "grupo", "classe", "marca", "modelo", "gtin", "ncm", "voltagem", "cor",
  "comprimento_cm", "largura_cm", "altura_cm", "peso_real_kg", "peso_kg",
  "preco_novo_est", "preco_sugerido", "preco_min", "preco_ideal",
  "preco_ref_novo", "preco_ref_usado", "preco_ref_fonte", "preco_ref_confianca",
  "destino", "canal_principal", "condicao_anuncio", "titulo_anuncio", "descricao_anuncio",
  "local_fisico", "caixa_num", "status",
  "estado", "testado", "funciona", "avaria", "acessorios_ok", "caixa_original",
];

// Desmembra um item em `total` unidades individuais (1 SKU cada). O item original é a
// unidade 1; cria total-1 novos itens no mesmo lote copiando os dados do produto (sem
// nº de série, fotos ou dados de venda). Registra auditoria. Retorna os novos itens.
export async function desmembrarItem(item, total, user) {
  const extras = Math.max(0, Math.floor(Number(total) || 0) - 1);
  if (!extras) return [];
  const lote = item.lote ?? null;

  const base = {};
  for (const k of CAMPOS_COPIA) if (item[k] !== undefined) base[k] = item[k];
  base.quantidade = 1;
  base.anuncio_feito = false;
  base.upd_by = user.email;

  const novos = [];
  for (let i = 0; i < extras; i++) {
    let seq = await proximoSeq(lote);
    let inserido = null, lastErr = null;
    for (let tent = 0; tent < 6; tent++) {
      const { data, error } = await supabase
        .from("itens").insert({ ...base, sku: buildSku(lote, seq) }).select().single();
      if (!error) { inserido = data; break; }
      lastErr = error;
      if (error.code === "23505") { seq++; continue; } // colisão de SKU
      break;
    }
    if (!inserido) throw lastErr || new Error("Falha ao criar unidade.");
    novos.push(inserido);
  }

  await supabase.from("eventos").insert({
    sku: item.sku, acao: "desmembrado", detalhe: `+${extras} unidade(s)`, usuario: user.email,
  });
  return novos;
}
