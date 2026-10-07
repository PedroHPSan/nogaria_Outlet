// Acesso a dados do motor v2: lotes (custo composto), itens do lote (rateio com pesos), snapshot do
// rateio fechado e validação do preço. Tolerante a migrations ainda NÃO aplicadas: sem as colunas/
// tabelas novas (peso_rateio, composição do custo, snapshot, parâmetros) cai nas estimativas e nos
// pesos padrão. Nada aqui grava preço sozinho — só `validarPreco`, por ação humana.
import { supabase as supabasePadrao } from "./supabase.js";
import { derivarPreco } from "./precoView.js";
import { custoRealLote } from "./custoLote.js";
import { ratearLote, precificarV2, canalV2, explicar, aplicarConfig, porteLabel } from "./motorPreco.js";

let sb = supabasePadrao;
/** Troca o cliente (ex.: service role em scripts Node). */
export const usarCliente = (c) => { sb = c; };

const COLS = "sku, lote, produto, marca, modelo, grupo, estado, classe, status, cond_embalagem, canal_principal, destino, peso_kg, peso_real_kg, preco_ref_novo, preco_ref_usado, preco_ref_fonte, preco_ref_confianca, preco_novo_est, preco_ideal, preco_aprovacao, disponivel_desde";
const TTL_MS = 60_000;
const cache = { lotes: null, itens: new Map(), snap: new Map(), cfg: false };
let colunaPeso = true; // vira false se a migration peso_rateio ainda não existe

export const limparCache = () => { cache.lotes = null; cache.itens.clear(); cache.snap.clear(); };
export const temPesoRateio = () => colunaPeso;

/** Carrega parâmetros editáveis (pricing_v2_param / pricing_v2_canal) se existirem. */
export async function carregarConfig() {
  if (cache.cfg) return;
  cache.cfg = true;
  try {
    const [p, c] = await Promise.all([
      sb.from("pricing_v2_param").select("chave, valor"),
      sb.from("pricing_v2_canal").select("codigo, nome, taxa, fixo_valor, fixo_abaixo_de, frete_pct"),
    ]);
    aplicarConfig({ params: p.error ? null : p.data, canais: c.error ? null : c.data });
  } catch { /* tabelas inexistentes: segue com as constantes */ }
}

export async function carregarLotes(force = false) {
  if (!force && cache.lotes && Date.now() - cache.lotes.t < TTL_MS) return cache.lotes.rows;
  const { data, error } = await sb.from("lotes").select("*");
  if (error) throw error;
  cache.lotes = { t: Date.now(), rows: data || [] };
  return cache.lotes.rows;
}

async function itensDoLote(lote, force = false) {
  const c = cache.itens.get(lote);
  if (!force && c && Date.now() - c.t < TTL_MS) return c.rows;
  const rows = [];
  for (let from = 0; ; from += 1000) { // PostgREST limita 1000 por página (lote 103 tem 700+)
    let data, error;
    for (const cols of colunaPeso ? [`${COLS}, peso_rateio, peso_rateio_motivo`, COLS] : [COLS]) {
      const q = sb.from("itens").select(cols).range(from, from + 999);
      ({ data, error } = lote == null ? await q.is("lote", null) : await q.eq("lote", lote));
      if (!error) break;
      if (cols !== COLS && /peso_rateio/.test(error.message || "")) colunaPeso = false; // sem a migration
    }
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  cache.itens.set(lote, { t: Date.now(), rows });
  return rows;
}

async function snapshotDoLote(lote) {
  if (cache.snap.has(lote)) return cache.snap.get(lote);
  let m = null;
  try {
    const { data, error } = await sb.from("item_custo_snapshot").select("sku, custo_alocado").eq("lote", lote);
    if (!error && data?.length) m = new Map(data.map((r) => [r.sku, Number(r.custo_alocado)]));
  } catch { /* tabela inexistente */ }
  cache.snap.set(lote, m);
  return m;
}

const alvoDe = (it, params) => derivarPreco(it, params?.grupos?.[it.grupo] || {}, params, null).recomendado;
const kDe = (it, pesos) => (pesos && pesos[it.sku] != null ? pesos[it.sku] : Number(it.peso_rateio) || 1);

/**
 * Rateio completo de UM lote. `pesos` (sku → k) sobrescreve peso_rateio (pré-visualização).
 * Devolve { lote, custo (composição), linhas:[{it, alvo, k, custo, w, contrib, refEstimada, fechado}] }.
 */
export async function calcularLote(lote, params, { force = false, pesos = null } = {}) {
  await carregarConfig();
  const [lotes, todos] = await Promise.all([carregarLotes(force), itensDoLote(lote, force)]);
  const cadastro = lotes.find((l) => l.lote === lote);
  const custo = cadastro ? custoRealLote(cadastro, lotes) : null;
  const base = todos.map((it) => ({
    sku: it.sku, alvo: alvoDe(it, params), grupo: it.grupo, canal: canalV2(it.canal_principal),
    pesoKg: it.peso_real_kg ?? it.peso_kg, k: kDe(it, pesos),
  }));
  const rateio = custo ? ratearLote(base, custo.total) : new Map();
  const fechado = !!cadastro?.fechado_em && !pesos; // pré-visualização ignora o snapshot
  const snap = fechado ? await snapshotDoLote(lote) : null;
  const linhas = todos.map((it, i) => {
    const rt = rateio.get(it.sku);
    const custoItem = snap?.has(it.sku) ? snap.get(it.sku) : (rt?.custo ?? 0);
    return {
      it, alvo: base[i].alvo, k: base[i].k, custo: custoItem, w: rt?.w ?? 0, contrib: rt?.contrib ?? 0,
      refEstimada: !!rt?.refEstimada, fechado: !!snap?.has(it.sku),
    };
  });
  return { lote, cadastro, custo, linhas, fechado };
}

/**
 * Analisa itens (de vários lotes). Devolve Map sku → resultado v2:
 * { ...precificarV2, semCusto, loteCusto, custoOrigem, atual, aprovacao, explicacao[] }.
 */
export async function analisarItens(itens, params, { force = false } = {}) {
  const porLote = new Map();
  for (const it of itens) {
    const k = it.lote ?? null;
    if (!porLote.has(k)) porLote.set(k, []);
    porLote.get(k).push(it);
  }
  const out = new Map();
  for (const [lote, alvos] of porLote) {
    const calc = await calcularLote(lote, params, { force });
    const porSku = new Map(calc.linhas.map((l) => [l.it.sku, l]));
    for (const it of alvos) {
      const l = porSku.get(it.sku);
      const d = derivarPreco(it, params?.grupos?.[it.grupo] || {}, params, null);
      const pesoKg = it.peso_real_kg ?? it.peso_kg;
      const r = precificarV2({
        alvoMercado: d.recomendado, custoAloc: l?.custo ?? 0, canal: it.canal_principal,
        pesoKg, refEstimada: !!l?.refEstimada,
      });
      out.set(it.sku, {
        ...r, semCusto: !calc.custo, loteCusto: calc.custo?.total ?? null, custoOrigem: calc.custo?.origem ?? null,
        atual: Number(it.preco_ideal) > 0 ? Number(it.preco_ideal) : null,
        aprovacao: it.preco_aprovacao || null,
        explicacao: explicar(r, { condicao: it.estado || "", loteCusto: calc.custo?.total ?? null }),
        // Memória de cálculo (estruturada) para a tela do operador
        memoria: {
          mercado: d.derivacao,
          lote: calc.custo || null,
          loteFechado: calc.fechado,
          rateio: l ? { k: l.k, contrib: l.contrib, w: l.w, custo: l.custo, refEstimada: l.refEstimada, fechado: l.fechado } : null,
          somaContrib: calc.linhas.reduce((s2, x) => s2 + x.contrib, 0),
          nItens: calc.linhas.length,
          porte: porteLabel(pesoKg),
        },
      });
    }
  }
  return out;
}

/**
 * Valida um preço: grava preco_ideal + preco_aprovacao='APROVADO' + evento. Recusa preço abaixo do
 * piso (nunca grava prejuízo) — o chamador mostra o motivo. { ok, erro? }
 */
export async function validarPreco({ sku, preco, piso, user, origem = "motor-v2", motivo = null }) {
  const p = Number(preco);
  if (!(p > 0)) return { ok: false, erro: "Preço inválido." };
  if (Number(piso) > 0 && p < Number(piso)) return { ok: false, erro: `Abaixo do piso (R$ ${Number(piso).toFixed(2)}): não cobre custo e taxas.` };
  const { error } = await sb.from("itens").update({
    preco_ideal: p, preco_aprovacao: "APROVADO", preco_aprovacao_motivo: motivo || origem, upd_by: user?.email,
  }).eq("sku", sku);
  if (error) return { ok: false, erro: error.message };
  try {
    await sb.from("eventos").insert({ sku, acao: `preco:validado ${p} (${origem})`, usuario: user?.email });
  } catch { /* auditoria best-effort */ }
  limparCache();
  return { ok: true };
}

/** Grava o peso manual k de um item (0,25–4) com motivo + log. Requer a migration peso_rateio. */
export async function salvarPesoRateio({ sku, k, motivo, anterior, user }) {
  const v = Math.min(4, Math.max(0.25, Number(k)));
  if (!(v > 0)) return { ok: false, erro: "Peso inválido." };
  if (!String(motivo || "").trim()) return { ok: false, erro: "Informe o motivo do peso." };
  const { error } = await sb.from("itens").update({ peso_rateio: v, peso_rateio_motivo: motivo.trim(), upd_by: user?.email }).eq("sku", sku);
  if (error) {
    return { ok: false, erro: /peso_rateio/.test(error.message) ? "Migration do peso de rateio ainda não aplicada." : error.message };
  }
  try {
    await sb.from("item_peso_rateio_log").insert({ sku, valor_antes: anterior ?? 1, valor_depois: v, motivo: motivo.trim(), usuario: user?.email });
    await sb.from("eventos").insert({ sku, acao: `rateio:peso ${anterior ?? 1}→${v} (${motivo.trim()})`, usuario: user?.email });
  } catch { /* auditoria best-effort */ }
  limparCache();
  return { ok: true };
}

/** Congela o rateio do lote (snapshot) e marca o lote como fechado. Requer a migration do snapshot. */
export async function fecharRateio(lote, params, user) {
  const calc = await calcularLote(lote, params, { force: true });
  if (!calc.custo) return { ok: false, erro: "Lote sem custo cadastrado." };
  const rows = calc.linhas.map((l) => ({ sku: l.it.sku, lote, custo_alocado: l.custo, w: l.w, peso_k: l.k, calculado_por: user?.email }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("item_custo_snapshot").upsert(rows.slice(i, i + 500), { onConflict: "sku" });
    if (error) return { ok: false, erro: /item_custo_snapshot|fechado_em/.test(error.message) ? "Migration do snapshot ainda não aplicada." : error.message };
  }
  const { error } = await sb.from("lotes").update({ fechado_em: new Date().toISOString() }).eq("lote", lote);
  if (error) return { ok: false, erro: error.message };
  limparCache();
  return { ok: true, itens: rows.length };
}

/** Reabre o lote (apaga o congelamento): o rateio volta a ser calculado ao vivo. */
export async function reabrirRateio(lote) {
  const { error } = await sb.from("lotes").update({ fechado_em: null }).eq("lote", lote);
  if (error) return { ok: false, erro: error.message };
  limparCache();
  return { ok: true };
}
