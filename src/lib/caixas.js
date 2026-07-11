// Caixas (2ª etapa): encaixotamento unificado. A caixa é uma entidade própria
// (tabela `caixas`): código auto-gerado, destino/local únicos, status aberta/
// fechada. O item aponta para a caixa via itens.caixa_id e, ao ser encaixotado,
// herda o destino/local da caixa (snapshot — o pricing por destino lê itens.destino).
// Lógica de dados isolada da UI, espelhando o padrão de lib/conferencia.js
// (retry em colisão de código + eventos best-effort).
import { supabase } from "./supabase";
import { pad3, STATUS_FORA_ESTOQUE_IN } from "./model";
import { chegadaDetalhe } from "./caixasFormat";

export const CAIXA_STATUS = { ABERTA: "ABERTA", FECHADA: "FECHADA" };
export const CAIXA_TIPO = { CAIXA: "CAIXA", MALA: "MALA" };
const prefixo = (tipo) => (tipo === CAIXA_TIPO.MALA ? "MALA" : "CX");

// Próximo código sequencial por tipo (CX-001 / MALA-001), parseando o sufixo do maior.
export async function proximoCodigoCaixa(tipo) {
  const p = prefixo(tipo);
  const { data } = await supabase
    .from("caixas").select("codigo").ilike("codigo", `${p}-%`).order("codigo", { ascending: false }).limit(1);
  const n = data && data.length ? (parseInt(data[0].codigo.split("-").pop(), 10) || 0) : 0;
  return `${p}-${pad3(n + 1)}`;
}

// Cria uma caixa (status ABERTA) com código auto-gerado; resolve colisão por retry.
export async function criarCaixa({ tipo, destino, local_fisico, referencia }, user) {
  const t = tipo === CAIXA_TIPO.MALA ? CAIXA_TIPO.MALA : CAIXA_TIPO.CAIXA;
  let codigo = await proximoCodigoCaixa(t);
  let criada = null, lastErr = null;
  for (let i = 0; i < 6; i++) {
    const { data, error } = await supabase.from("caixas").insert({
      codigo, tipo: t,
      destino: destino || null, local_fisico: local_fisico?.trim() || null,
      referencia: referencia?.trim() || null,
      status: CAIXA_STATUS.ABERTA, criado_por: user?.email,
    }).select().single();
    if (!error) { criada = data; break; }
    lastErr = error;
    if (error.code === "23505") { // código já existe — incrementa o sufixo
      const n = parseInt(codigo.split("-").pop(), 10) || 0;
      codigo = `${prefixo(t)}-${pad3(n + 1)}`;
      continue;
    }
    break;
  }
  if (!criada) throw lastErr || new Error("Falha ao criar a caixa.");
  await supabase.from("eventos").insert({
    sku: criada.codigo, acao: "caixa:criada",
    detalhe: `${criada.tipo} · ${criada.destino || "sem destino"}`, usuario: user?.email,
  });
  return criada;
}

// Encaixota um item: aponta para a caixa e herda destino/local dela. Retorna o item.
export async function adicionarItemCaixa(sku, caixa, user) {
  const { data, error } = await supabase.from("itens").update({
    caixa_id: caixa.codigo, destino: caixa.destino || null,
    local_fisico: caixa.local_fisico || null, upd_by: user?.email,
  }).eq("sku", sku).select().single();
  if (error) throw error;
  await supabase.from("eventos").insert({
    sku, acao: "caixa:item_add", detalhe: caixa.codigo, usuario: user?.email,
  });
  return data;
}

// Remove um item da caixa (não mexe em destino/local já herdados).
export async function removerItemCaixa(sku, user) {
  const { error } = await supabase.from("itens").update({ caixa_id: null, upd_by: user?.email }).eq("sku", sku);
  if (error) throw error;
  await supabase.from("eventos").insert({ sku, acao: "caixa:item_remove", usuario: user?.email });
}

export async function fecharCaixa(codigo, user) {
  const { error } = await supabase.from("caixas")
    .update({ status: CAIXA_STATUS.FECHADA, fechada_por: user?.email, fechada_em: new Date().toISOString() })
    .eq("codigo", codigo);
  if (error) throw error;
  await supabase.from("eventos").insert({ sku: codigo, acao: "caixa:fechada", usuario: user?.email });
}

export async function reabrirCaixa(codigo, user) {
  const { error } = await supabase.from("caixas")
    .update({ status: CAIXA_STATUS.ABERTA, fechada_por: null, fechada_em: null }).eq("codigo", codigo);
  if (error) throw error;
  await supabase.from("eventos").insert({ sku: codigo, acao: "caixa:reaberta", usuario: user?.email });
}

// Atualiza a caixa e PROPAGA destino/local para todos os itens dela (consistência).
export async function atualizarCaixa(codigo, patch, user) {
  const { data, error } = await supabase.from("caixas").update(patch).eq("codigo", codigo).select().single();
  if (error) throw error;
  if ("destino" in patch || "local_fisico" in patch) {
    const prop = {};
    if ("destino" in patch) prop.destino = patch.destino || null;
    if ("local_fisico" in patch) prop.local_fisico = patch.local_fisico || null;
    prop.upd_by = user?.email;
    await supabase.from("itens").update(prop).eq("caixa_id", codigo);
  }
  return data;
}

// Lista caixas (opcionalmente por status), mais recentes primeiro.
export async function listarCaixas({ status } = {}) {
  let q = supabase.from("caixas").select("*");
  if (status) q = q.eq("status", status);
  const { data } = await q.order("criado_em", { ascending: false });
  return data || [];
}

// Busca uma caixa pelo código (ex.: ao escanear o QR da etiqueta). null se não existir.
export async function buscarCaixa(codigo) {
  const cod = String(codigo || "").trim().toUpperCase();
  if (!cod) return null;
  const { data } = await supabase.from("caixas").select("*").eq("codigo", cod).maybeSingle();
  return data || null;
}

// Itens encaixotados numa caixa. Esconde VENDIDO/ENTREGUE/DESCARTE: eles saíram
// do estoque (foram pro cliente), mas mantêm caixa_id como histórico no banco.
export async function itensDaCaixa(codigo) {
  const { data } = await supabase
    .from("itens").select("*").eq("caixa_id", codigo)
    .not("status", "in", STATUS_FORA_ESTOQUE_IN).order("sku");
  return data || [];
}

// ───────────────────────── Chegada / armazenamento / conferência ─────────────────────────

// Define o local de armazenamento da caixa e PROPAGA para os itens dela. Grava
// evento `caixa:local`. Usado para "indicar onde a caixa está armazenada".
export async function definirLocalCaixa(codigo, local, user) {
  const l = local?.trim() || null;
  const { data, error } = await supabase.from("caixas")
    .update({ local_fisico: l }).eq("codigo", codigo).select().single();
  if (error) throw error;
  await supabase.from("itens").update({ local_fisico: l, upd_by: user?.email }).eq("caixa_id", codigo);
  await supabase.from("eventos").insert({
    sku: codigo, acao: "caixa:local", detalhe: l || "sem local", usuario: user?.email,
  });
  return data;
}

// Registra a chegada (ex.: em Belém): grava `chegou_em` + local (propagado aos itens)
// e evento `caixa:chegada` com detalhe "Belém · dd/mm/aaaa · <local>". `chegou_em`
// aceita data retroativa (default: agora). Se `destino` for informado, também o
// atualiza na caixa e propaga aos itens (as etiquetas leem o destino do item/caixa) —
// usado p/ corrigir o destino quando a caixa chega (ex.: de "SP storage" p/ "Belém").
export async function registrarChegada(codigo, { chegou_em, local, destino }, user) {
  const l = local?.trim() || null;
  const quando = chegou_em || new Date().toISOString();
  const patchCaixa = { chegou_em: quando, local_fisico: l };
  const patchItens = { local_fisico: l, upd_by: user?.email };
  if (destino !== undefined) {
    const d = destino?.trim() || null;
    patchCaixa.destino = d;
    patchItens.destino = d;
  }
  const { data, error } = await supabase.from("caixas")
    .update(patchCaixa).eq("codigo", codigo).select().single();
  if (error) throw error;
  await supabase.from("itens").update(patchItens).eq("caixa_id", codigo);
  await supabase.from("eventos").insert({
    sku: codigo, acao: "caixa:chegada", detalhe: chegadaDetalhe(quando, l), usuario: user?.email,
  });
  return data;
}

// Marca a caixa como reconferida (carimbo quem/quando) + evento `caixa:conferida`.
export async function conferirCaixa(codigo, user) {
  const { data, error } = await supabase.from("caixas")
    .update({ conferida_em: new Date().toISOString(), conferida_por: user?.email })
    .eq("codigo", codigo).select().single();
  if (error) throw error;
  await supabase.from("eventos").insert({ sku: codigo, acao: "caixa:conferida", usuario: user?.email });
  return data;
}

// Item danificado na conferência: estado='Avariado', permanece na caixa. Evento `caixa:item_avaria`.
export async function marcarItemAvariado(sku, user) {
  const { error } = await supabase.from("itens")
    .update({ estado: "Avariado", upd_by: user?.email }).eq("sku", sku);
  if (error) throw error;
  await supabase.from("eventos").insert({ sku, acao: "caixa:item_avaria", usuario: user?.email });
}

// Item ausente na conferência: sai da caixa (caixa_id=null). Evento `caixa:item_faltando`.
export async function marcarItemFaltando(sku, user) {
  const { error } = await supabase.from("itens")
    .update({ caixa_id: null, upd_by: user?.email }).eq("sku", sku);
  if (error) throw error;
  await supabase.from("eventos").insert({ sku, acao: "caixa:item_faltando", usuario: user?.email });
}

// Histórico de uma caixa (eventos cuja `sku` é o código da caixa), recentes primeiro.
export async function historicoCaixa(codigo) {
  const { data } = await supabase.from("eventos")
    .select("*").eq("sku", codigo).order("ts", { ascending: false });
  return data || [];
}
