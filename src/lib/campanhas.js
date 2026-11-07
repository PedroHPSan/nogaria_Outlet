// Camada de rede das campanhas (RPCs/tabelas da migration 20261107150000). Regras puras: campanhasCore.js.
import { supabase } from "./supabase";
import { analisarItens } from "./motorPrecoDb";
import { lucroEm } from "./motorPreco";
import { brasiliaParaIso } from "./campanhasCore";

const ok = ({ data, error }) => { if (error) throw error; return data; };

export const listarCampanhas = async () =>
  ok(await supabase.from("campanhas").select("*").order("inicio_em", { ascending: false }));

export const regrasDe = async (id) =>
  ok(await supabase.from("campanha_regras").select("*").eq("campanha_id", id).order("id"));

export async function listarOpcoes() {
  const [g, c] = await Promise.all([
    supabase.from("pricing_grupo").select("grupo,macro").order("grupo"),
    supabase.from("canais").select("codigo,nome").eq("ativo", true).order("nome"),
  ]);
  return { grupos: g.data || [], canais: c.data || [] };
}

const linhaRegra = (id, r) => ({
  campanha_id: id, tipo: r.tipo, alvo: r.tipo === "geral" ? null : String(r.alvo).trim(),
  canal: r.canal || null, desconto_pct: Number(r.desconto_pct),
});

// Cria ou atualiza o rascunho (campanha + regras). `form` = { nome, inicio, fim, arredondamento } em horário de Brasília.
export async function salvarRascunho(id, form, regras, user) {
  const base = {
    nome: form.nome.trim(), inicio_em: brasiliaParaIso(form.inicio), fim_em: brasiliaParaIso(form.fim),
    arredondamento: form.arredondamento,
  };
  let cid = id;
  if (cid) ok(await supabase.from("campanhas").update(base).eq("id", cid));
  else cid = ok(await supabase.from("campanhas").insert({ ...base, criado_por: user?.email }).select("id").single()).id;
  ok(await supabase.from("campanha_regras").delete().eq("campanha_id", cid));
  if (regras.length) ok(await supabase.from("campanha_regras").insert(regras.map((r) => linhaRegra(cid, r))));
  return cid;
}

export const excluirRascunho = async (id) => ok(await supabase.from("campanhas").delete().eq("id", id));

export const simular = async (id, canal = "*") =>
  ok(await supabase.rpc("campanha_simular", { p_id: id, p_canal: canal }));

// Lança o erro original (CONFLITO_SKU traz os SKUs em `details`; ver conflitosDoErro).
export const publicar = async (id, ignorarConflitos, user) =>
  ok(await supabase.rpc("campanha_publicar", { p_id: id, p_ignorar_conflitos: !!ignorarConflitos, p_user: user?.email ?? null }));

export const encerrar = async (id, user) =>
  ok(await supabase.rpc("campanha_encerrar", { p_id: id, p_user: user?.email ?? null }));

// Copia nome (+ " (cópia)"), regras e arredondamento para um novo rascunho; o prazo o usuário define.
export async function duplicar(id, user) {
  const [c, regras] = await Promise.all([
    supabase.from("campanhas").select("*").eq("id", id).single().then(ok), regrasDe(id),
  ]);
  const ini = new Date(Date.now() + 86400000), fim = new Date(Date.now() + 8 * 86400000);
  const novo = ok(await supabase.from("campanhas").insert({
    nome: `${c.nome} (cópia)`.slice(0, 80), inicio_em: ini.toISOString(), fim_em: fim.toISOString(),
    arredondamento: c.arredondamento, criado_por: user?.email,
  }).select("id").single());
  if (regras.length) ok(await supabase.from("campanha_regras").insert(regras.map((r) => linhaRegra(novo.id, r))));
  return novo.id;
}

// Lucro por SKU antes/depois do desconto, com o mesmo motor de custo da ficha do item.
// Sem custo cadastrado → { semCusto: true }. Falha de custo não derruba a simulação.
export async function margensDaSimulacao(linhas, params) {
  const out = new Map();
  const skus = [...new Set(linhas.filter((l) => Number(l.desconto_pct) > 0).map((l) => l.sku))];
  try {
    for (let i = 0; i < skus.length; i += 200) {
      const { data } = await supabase.from("itens").select("*").in("sku", skus.slice(i, i + 200));
      const mapa = await analisarItens(data || [], params);
      for (const l of linhas) {
        const r = mapa.get(l.sku);
        if (!r || Number(l.desconto_pct) <= 0) continue;
        const direto = (data || []).find((x) => x.sku === l.sku)?.custo_direto;
        const semCusto = r.semCusto || (!(direto != null && direto !== "") && !(r.custoAloc > 0));
        out.set(l.sku, semCusto ? { semCusto: true } : {
          antes: lucroEm(Number(l.preco_cheio), r.base, r.canal).lucro,
          depois: lucroEm(Number(l.preco), r.base, r.canal).lucro,
        });
      }
    }
  } catch { /* margem é informativa */ }
  return out;
}

export const resultadoCampanha = async (id) => ok(await supabase.rpc("campanha_resultado", { p_id: id }));

// Campanhas que cobrem o SKU (para o aviso na ficha do item).
export async function campanhasDoItem(sku) {
  const { data } = await supabase.from("campanha_itens")
    .select("campanha_id,preco_cheio,desconto_pct,canal,regra_tipo,campanhas(nome,inicio_em,fim_em,status)").eq("sku", sku);
  return data || [];
}

// Vendas do SKU dentro de campanhas e o log (quem incluiu/removeu) — auditoria por produto.
export async function vendasEHistoricoDoItem(sku) {
  const [v, l] = await Promise.all([
    supabase.from("campanha_vendas").select("campanha_id,valor_vendido,preco_promo,decisao,fechado_em,origem_ref").eq("sku", sku),
    supabase.from("campanha_log").select("id,campanha_id,acao,detalhe,usuario,ts").eq("sku", sku).order("ts", { ascending: false }).limit(50),
  ]);
  return { vendas: v.data || [], log: l.data || [] };
}

// Campanhas publicadas e ainda em andamento (destino de "incluir este produto").
export async function campanhasEmAndamento() {
  const { data } = await supabase.from("campanhas").select("id,nome,inicio_em,fim_em,status").eq("status", "PUBLICADA").gt("fim_em", new Date().toISOString()).order("inicio_em", { ascending: false });
  return data || [];
}

// ---- Auditoria dos produtos (campanha_auditar) e manutenção da campanha publicada ----
export const auditarCampanha = async (id, canal = "*") => ok(await supabase.rpc("campanha_auditar", { p_id: id, p_canal: canal }));
export const incluirItens = async (id, skus, pct, user) =>
  ok(await supabase.rpc("campanha_incluir_itens", { p_id: id, p_skus: skus, p_pct: Number(pct), p_user: user?.email ?? null }));
export const removerItemCampanha = async (id, sku, user) =>
  ok(await supabase.rpc("campanha_remover_item", { p_id: id, p_sku: sku, p_user: user?.email ?? null }));
export const reaplicarRegras = async (id, user) => ok(await supabase.rpc("campanha_reaplicar", { p_id: id, p_user: user?.email ?? null }));
export const logCampanha = async (id, limite = 200) =>
  ok(await supabase.from("campanha_log").select("id,sku,acao,detalhe,usuario,ts").eq("campanha_id", id).order("ts", { ascending: false }).limit(limite));

// Elegibilidade ao catálogo (regra única C1) de várias peças: { sku: { elegivel, motivos } }.
export async function elegibilidadeDe(skus) {
  const out = {};
  for (let i = 0; i < skus.length; i += 10) {
    const res = await Promise.all(skus.slice(i, i + 10).map((sku) => supabase.rpc("catalogo_elegibilidade", { p_sku: sku })));
    res.forEach((r, k) => { const row = r.data?.[0]; if (row) out[skus[i + k]] = { elegivel: !!row.elegivel, motivos: row.motivos || [] }; });
  }
  return out;
}

// Publica no catálogo (WhatsApp/Meta) SÓ as peças dadas (as elegíveis da campanha). Idempotente. Devolve { ok, erros:[{sku, erro}] }.
export async function publicarPecasNoCatalogo(skus, onProgresso) {
  const { publicarLote } = await import("./catalogoMeta");
  const itens = [];
  for (let i = 0; i < skus.length; i += 100) itens.push(...ok(await supabase.from("itens").select("*").in("sku", skus.slice(i, i + 100))));
  return publicarLote(itens, { simultaneos: 3, onProgresso });
}
