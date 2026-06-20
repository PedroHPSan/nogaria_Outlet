// Caixas (2ª etapa): encaixotamento unificado. A caixa é uma entidade própria
// (tabela `caixas`): código auto-gerado, destino/local únicos, status aberta/
// fechada. O item aponta para a caixa via itens.caixa_id e, ao ser encaixotado,
// herda o destino/local da caixa (snapshot — o pricing por destino lê itens.destino).
// Lógica de dados isolada da UI, espelhando o padrão de lib/conferencia.js
// (retry em colisão de código + eventos best-effort).
import { supabase } from "./supabase";
import { pad3 } from "./model";

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

// Itens encaixotados numa caixa.
export async function itensDaCaixa(codigo) {
  const { data } = await supabase.from("itens").select("*").eq("caixa_id", codigo).order("sku");
  return data || [];
}
