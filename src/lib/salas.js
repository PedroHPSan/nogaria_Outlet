// Salas: local físico estruturado (tabela `salas`) — irmã de `caixas`. Código
// auto-gerado (SALA-001), RLS padrão, eventos best-effort. Caixa/item apontam via
// sala_id; item encaixotado herda a sala da caixa (snapshot), item solto recebe
// sala direto. Lógica de dados isolada da UI, espelhando src/lib/caixas.js.
import { supabase } from "./supabase";
import { pad3, STATUS_FORA_ESTOQUE_IN } from "./model";

// Próximo código sequencial SALA-###, parseando o sufixo do maior existente.
export async function proximoCodigoSala() {
  const { data } = await supabase
    .from("salas").select("codigo").ilike("codigo", "SALA-%")
    .order("codigo", { ascending: false }).limit(1);
  const n = data && data.length ? (parseInt(data[0].codigo.split("-").pop(), 10) || 0) : 0;
  return `SALA-${pad3(n + 1)}`;
}

// Cria uma sala com código auto-gerado; resolve colisão por retry.
export async function criarSala({ nome, observacao }, user) {
  let codigo = await proximoCodigoSala();
  let criada = null, lastErr = null;
  for (let i = 0; i < 6; i++) {
    const { data, error } = await supabase.from("salas").insert({
      codigo, nome: nome?.trim() || codigo,
      observacao: observacao?.trim() || null,
      criado_por: user?.email,
    }).select().single();
    if (!error) { criada = data; break; }
    lastErr = error;
    if (error.code === "23505") {
      const num = parseInt(codigo.split("-").pop(), 10) || 0;
      codigo = `SALA-${pad3(num + 1)}`;
      continue;
    }
    break;
  }
  if (!criada) throw lastErr || new Error("Falha ao criar a sala.");
  await supabase.from("eventos").insert({
    sku: criada.codigo, acao: "sala:criada", detalhe: criada.nome, usuario: user?.email,
  });
  return criada;
}

// Edita a sala (nome/observacao/ativa). Grava evento sala:editada.
export async function atualizarSala(codigo, patch, user) {
  const { data, error } = await supabase.from("salas").update(patch).eq("codigo", codigo).select().single();
  if (error) throw error;
  await supabase.from("eventos").insert({
    sku: codigo, acao: "sala:editada", detalhe: patch.nome ?? null, usuario: user?.email,
  });
  return data;
}

// Lista salas (default: só ativas), mais recentes primeiro.
export async function listarSalas({ ativa = true } = {}) {
  let q = supabase.from("salas").select("*");
  if (ativa !== null) q = q.eq("ativa", ativa);
  const { data } = await q.order("criado_em", { ascending: false });
  return data || [];
}

// Busca uma sala pelo código (ex.: ao escanear o QR da porta). null se não existir.
export async function buscarSala(codigo) {
  const cod = String(codigo || "").trim().toUpperCase();
  if (!cod) return null;
  const { data } = await supabase.from("salas").select("*").eq("codigo", cod).maybeSingle();
  return data || null;
}

// Conteúdo de uma sala: caixas na sala + itens soltos (sem caixa) na sala.
// Oculta itens fora do estoque (VENDIDO/ENTREGUE/DESCARTE).
export async function conteudoSala(codigo) {
  const [caixasRes, itensRes] = await Promise.all([
    supabase.from("caixas").select("*").eq("sala_id", codigo).order("codigo"),
    supabase.from("itens").select("*").eq("sala_id", codigo).is("caixa_id", null)
      .not("status", "in", STATUS_FORA_ESTOQUE_IN).order("sku"),
  ]);
  return { caixas: caixasRes.data || [], itensSoltos: itensRes.data || [] };
}

// Aloca uma caixa numa sala e PROPAGA sala_id aos itens dela. Evento caixa:sala.
export async function alocarCaixaNaSala(codigoCaixa, salaCodigo, user) {
  const s = salaCodigo || null;
  const { data, error } = await supabase.from("caixas")
    .update({ sala_id: s }).eq("codigo", codigoCaixa).select().single();
  if (error) throw error;
  await supabase.from("itens").update({ sala_id: s, upd_by: user?.email }).eq("caixa_id", codigoCaixa);
  await supabase.from("eventos").insert({
    sku: codigoCaixa, acao: "caixa:sala", detalhe: s || "sem sala", usuario: user?.email,
  });
  return data;
}

// Aloca um item SOLTO numa sala. Se o item estiver numa caixa e forcarRetirarDaCaixa
// for falso, NÃO altera nada e retorna { precisaConfirmar: true, caixa_id } para a UI
// oferecer a retirada. Com forcarRetirarDaCaixa: remove da caixa e aloca na sala,
// registrando quem movimentou (evento item:sala com a origem).
export async function alocarItemNaSala(sku, salaCodigo, user, { forcarRetirarDaCaixa = false } = {}) {
  const s = salaCodigo || null;
  const { data: atual, error: e0 } = await supabase.from("itens")
    .select("sku, caixa_id").eq("sku", sku).single();
  if (e0) throw e0;
  if (atual.caixa_id && !forcarRetirarDaCaixa) {
    return { precisaConfirmar: true, caixa_id: atual.caixa_id };
  }
  const patch = { sala_id: s, upd_by: user?.email };
  let detalhe = s || "sem sala";
  if (atual.caixa_id && forcarRetirarDaCaixa) {
    patch.caixa_id = null;
    detalhe = `${s || "sem sala"} · retirado de ${atual.caixa_id}`;
  }
  const { data, error } = await supabase.from("itens").update(patch).eq("sku", sku).select().single();
  if (error) throw error;
  await supabase.from("eventos").insert({
    sku, acao: "item:sala", detalhe, usuario: user?.email,
  });
  return { item: data };
}

// Remove uma caixa da sala (sala_id=null) e propaga aos itens. Evento caixa:sala.
export async function removerCaixaDaSala(codigoCaixa, user) {
  return alocarCaixaNaSala(codigoCaixa, null, user);
}

// Remove um item solto da sala (sala_id=null). Evento item:sala.
export async function removerItemDaSala(sku, user) {
  const { error } = await supabase.from("itens").update({ sala_id: null, upd_by: user?.email }).eq("sku", sku);
  if (error) throw error;
  await supabase.from("eventos").insert({ sku, acao: "item:sala", detalhe: "sem sala", usuario: user?.email });
}

// Histórico de uma sala (eventos cuja `sku` é o código da sala), recentes primeiro.
export async function historicoSala(codigo) {
  const { data } = await supabase.from("eventos")
    .select("*").eq("sku", codigo).order("ts", { ascending: false });
  return data || [];
}
