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
export async function criarCaixa({ tipo, destino, sala_id, referencia, apelido }, user) {
  const t = tipo === CAIXA_TIPO.MALA ? CAIXA_TIPO.MALA : CAIXA_TIPO.CAIXA;
  let codigo = await proximoCodigoCaixa(t);
  let criada = null, lastErr = null;
  for (let i = 0; i < 6; i++) {
    const { data, error } = await supabase.from("caixas").insert({
      codigo, tipo: t,
      destino: destino || null, sala_id: sala_id || null,
      referencia: referencia?.trim() || null,
      apelido: apelido?.trim() || null,
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
    sala_id: caixa.sala_id || null, upd_by: user?.email,
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
  if ("destino" in patch || "sala_id" in patch) {
    const prop = {};
    if ("destino" in patch) prop.destino = patch.destino || null;
    if ("sala_id" in patch) prop.sala_id = patch.sala_id || null;
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

// Define/limpa o apelido (designação) da caixa. Evento `caixa:apelido`.
export async function definirApelidoCaixa(codigo, apelido, user) {
  const v = String(apelido || "").trim() || null;
  const { data, error } = await supabase.from("caixas").update({ apelido: v }).eq("codigo", codigo).select().single();
  if (error) throw error;
  await supabase.from("eventos").insert({ sku: codigo, acao: "caixa:apelido", detalhe: v || "removido", usuario: user?.email });
  return data;
}

// Nº de itens em estoque por caixa: { [codigo]: n } (pagina por causa do corte de 1.000 do PostgREST).
export async function contarItensPorCaixa() {
  const PAGE = 1000, out = {};
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase.from("itens").select("caixa_id")
      .not("caixa_id", "is", null).not("status", "in", STATUS_FORA_ESTOQUE_IN)
      .order("sku").range(from, from + PAGE - 1);
    for (const r of data || []) out[r.caixa_id] = (out[r.caixa_id] || 0) + 1;
    if (!data || data.length < PAGE) break;
  }
  return out;
}

// "Onde está?": acha o item por SKU ou GTIN e devolve { item, caixa } (caixa=null → solto).
export async function localizarItem(codigo) {
  const c = String(codigo || "").trim();
  if (!c) return null;
  const m = c.match(/[?&]item=([^&]+)/i);
  const sku = (m ? decodeURIComponent(m[1]) : c).trim().toUpperCase();
  let item = (await supabase.from("itens").select("*").eq("sku", sku).maybeSingle()).data;
  if (!item) item = (await supabase.from("itens").select("*").eq("gtin", c).limit(1)).data?.[0];
  if (!item) return null;
  const caixa = item.caixa_id ? await buscarCaixa(item.caixa_id) : null;
  return { item, caixa };
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

// Registra a chegada (ex.: em Belém): grava `chegou_em`, opcionalmente `destino` e
// `sala_id` (propagados aos itens da caixa) e evento `caixa:chegada`. `chegou_em`
// aceita data retroativa (default: agora). A sala substitui o antigo local livre.
export async function registrarChegada(codigo, { chegou_em, destino, sala_id }, user) {
  const quando = chegou_em || new Date().toISOString();
  const patchCaixa = { chegou_em: quando };
  const patchItens = { upd_by: user?.email };
  if (destino !== undefined) { const d = destino?.trim?.() || destino || null; patchCaixa.destino = d; patchItens.destino = d; }
  if (sala_id !== undefined) { const s = sala_id || null; patchCaixa.sala_id = s; patchItens.sala_id = s; }
  const { data, error } = await supabase.from("caixas")
    .update(patchCaixa).eq("codigo", codigo).select().single();
  if (error) throw error;
  await supabase.from("itens").update(patchItens).eq("caixa_id", codigo);
  await supabase.from("eventos").insert({
    sku: codigo, acao: "caixa:chegada", detalhe: chegadaDetalhe(quando, sala_id || null), usuario: user?.email,
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

// Item ausente na conferência: sai da caixa (caixa_id=null). O código da caixa de
// origem vai no `detalhe` do evento `caixa:item_faltando` (item) e o SKU no evento
// espelho da própria caixa — é o que permite listar o que faltou (itensFaltandoDaCaixa).
export async function marcarItemFaltando(sku, caixaCodigo, user) {
  const { error } = await supabase.from("itens")
    .update({ caixa_id: null, upd_by: user?.email }).eq("sku", sku);
  if (error) throw error;
  await supabase.from("eventos").insert([
    { sku, acao: "caixa:item_faltando", detalhe: caixaCodigo, usuario: user?.email },
    { sku: caixaCodigo, acao: "caixa:item_faltando", detalhe: sku, usuario: user?.email },
  ]);
}

// Itens que estavam na caixa e foram marcados como faltando (e não voltaram a ela):
// [{ item, quando, por }] — `item.caixa_id`/`sala_id` mostram onde estão agora.
export async function itensFaltandoDaCaixa(codigo) {
  const { data: evs } = await supabase.from("eventos")
    .select("sku, ts, usuario").eq("acao", "caixa:item_faltando").eq("detalhe", codigo)
    .not("sku", "like", "CX-%").not("sku", "like", "MALA-%").order("ts", { ascending: false });
  const ultimo = new Map();
  for (const e of evs || []) if (!ultimo.has(e.sku)) ultimo.set(e.sku, e);
  if (!ultimo.size) return [];
  const { data: itens } = await supabase.from("itens").select("*").in("sku", [...ultimo.keys()]);
  return (itens || [])
    .filter((it) => it.caixa_id !== codigo)
    .map((item) => ({ item, quando: ultimo.get(item.sku).ts, por: ultimo.get(item.sku).usuario }));
}

// Nº de itens que saíram de cada caixa (faltando) e ainda não voltaram: { [codigo]: n }.
// Usa os eventos espelho (sku = código da caixa, detalhe = SKU do item).
export async function contarFaltandoPorCaixa() {
  const { data: evs } = await supabase.from("eventos").select("sku, detalhe")
    .eq("acao", "caixa:item_faltando").or("sku.like.CX-%,sku.like.MALA-%").limit(2000);
  const pares = new Map();
  for (const e of evs || []) if (e.detalhe) pares.set(`${e.sku}|${e.detalhe}`, { caixa: e.sku, item: e.detalhe });
  if (!pares.size) return {};
  const skus = [...new Set([...pares.values()].map((v) => v.item))];
  const atual = {};
  for (let i = 0; i < skus.length; i += 200) {
    const { data } = await supabase.from("itens").select("sku, caixa_id").in("sku", skus.slice(i, i + 200));
    for (const it of data || []) atual[it.sku] = it;
  }
  const out = {};
  for (const { caixa, item } of pares.values()) {
    if (atual[item] && atual[item].caixa_id !== caixa) out[caixa] = (out[caixa] || 0) + 1;
  }
  return out;
}

// ───────────────────────── Rodadas de conferência ─────────────────────────
// Cada rodada (caixa_conferencias) guarda um resultado por item (caixa_conferencia_itens);
// só pode haver uma aberta por caixa (índice único parcial).
export const RESULTADO = { OK: "OK", FALTANDO: "FALTANDO", AVARIADO: "AVARIADO", SOBRANDO: "SOBRANDO" };

// Rodada aberta da caixa → { rodada, resultados: { [sku]: resultado }, sobrando: [item] } (rodada=null se não há).
export async function conferenciaAtual(codigo) {
  const { data: rodada } = await supabase.from("caixa_conferencias")
    .select("*").eq("caixa_id", codigo).is("concluida_em", null).maybeSingle();
  if (!rodada) return { rodada: null, resultados: {}, sobrando: [] };
  const { data: rs } = await supabase.from("caixa_conferencia_itens").select("sku, resultado").eq("conferencia_id", rodada.id);
  const resultados = {};
  for (const r of rs || []) resultados[r.sku] = r.resultado;
  const skus = Object.keys(resultados).filter((k) => resultados[k] === RESULTADO.SOBRANDO);
  const sobrando = skus.length
    ? ((await supabase.from("itens").select("*").in("sku", skus)).data || []).filter((it) => it.caixa_id !== codigo)
    : [];
  return { rodada, resultados, sobrando };
}

// Abre a rodada N+1 (ou devolve a que outra pessoa já abriu).
export async function iniciarConferencia(codigo, user) {
  const aberta = (await supabase.from("caixa_conferencias").select("*").eq("caixa_id", codigo).is("concluida_em", null).maybeSingle()).data;
  if (aberta) return aberta;
  const ult = (await supabase.from("caixa_conferencias").select("numero").eq("caixa_id", codigo).order("numero", { ascending: false }).limit(1)).data;
  const numero = (ult?.[0]?.numero || 0) + 1;
  const { data, error } = await supabase.from("caixa_conferencias")
    .insert({ caixa_id: codigo, numero, iniciada_por: user?.email }).select().single();
  if (error) {
    if (error.code === "23505") { // corrida com outro usuário: reaproveita a aberta
      const o = (await supabase.from("caixa_conferencias").select("*").eq("caixa_id", codigo).is("concluida_em", null).maybeSingle()).data;
      if (o) return o;
    }
    throw error;
  }
  await supabase.from("eventos").insert({ sku: codigo, acao: "caixa:conferencia_iniciada", detalhe: `rodada ${numero}`, usuario: user?.email });
  return data;
}

// Grava (ou troca) o resultado de um item na rodada.
export async function registrarResultadoItem(confId, sku, resultado, user) {
  const { error } = await supabase.from("caixa_conferencia_itens")
    .upsert({ conferencia_id: confId, sku, resultado, por: user?.email, em: new Date().toISOString() });
  if (error) throw error;
}

// Desfaz o resultado de um item (volta a pendente).
export async function limparResultadoItem(confId, sku) {
  const { error } = await supabase.from("caixa_conferencia_itens").delete().eq("conferencia_id", confId).eq("sku", sku);
  if (error) throw error;
}

// Resume os resultados da rodada contra os itens atuais da caixa (puro).
export function resumirRodada(itens, resultados) {
  const r = { total: itens.length, conferidos: 0, avariados: 0, pendentes: 0, faltando: 0, sobrando: 0 };
  for (const it of itens) {
    const x = resultados[it.sku];
    if (x === RESULTADO.OK) r.conferidos++;
    else if (x === RESULTADO.AVARIADO) { r.conferidos++; r.avariados++; }
    else r.pendentes++;
  }
  for (const k of Object.keys(resultados)) {
    if (resultados[k] === RESULTADO.FALTANDO) r.faltando++;
    else if (resultados[k] === RESULTADO.SOBRANDO) r.sobrando++;
  }
  return r;
}

// Conclui a rodada: grava totais, carimba a caixa como conferida e registra o resumo no histórico.
export async function concluirConferencia(rodada, itens, resultados, user) {
  const r = resumirRodada(itens, resultados);
  const agora = new Date().toISOString();
  const { error } = await supabase.from("caixa_conferencias").update({
    concluida_em: agora, concluida_por: user?.email,
    total: r.total, conferidos: r.conferidos, faltando: r.faltando, avariados: r.avariados, sobrando: r.sobrando,
  }).eq("id", rodada.id).is("concluida_em", null);
  if (error) throw error;
  await supabase.from("caixas").update({ conferida_em: agora, conferida_por: user?.email }).eq("codigo", rodada.caixa_id);
  await supabase.from("eventos").insert({
    sku: rodada.caixa_id, acao: "caixa:conferida", usuario: user?.email,
    detalhe: `rodada ${rodada.numero}: ${r.conferidos}/${r.total} ok · ${r.pendentes} pendente(s) · ${r.faltando} faltando · ${r.avariados} avariado(s) · ${r.sobrando} sobrando`,
  });
  return r;
}

// Item lido que não é da caixa: registra SOBRANDO (evento no item e espelho na caixa).
export async function registrarSobrando(rodada, sku, user) {
  await registrarResultadoItem(rodada.id, sku, RESULTADO.SOBRANDO, user);
  await supabase.from("eventos").insert([
    { sku, acao: "caixa:item_sobrando", detalhe: rodada.caixa_id, usuario: user?.email },
    { sku: rodada.caixa_id, acao: "caixa:item_sobrando", detalhe: sku, usuario: user?.email },
  ]);
}

// Histórico de uma caixa (eventos cuja `sku` é o código da caixa), recentes primeiro.
export async function historicoCaixa(codigo) {
  const { data } = await supabase.from("eventos")
    .select("*").eq("sku", codigo).order("ts", { ascending: false });
  return data || [];
}
