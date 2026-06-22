// Controle de vias de impressão de etiquetas.
// Fonte da verdade: a tabela `eventos` (histórico/auditoria). Cada impressão de
// uma etiqueta de item gera um evento `etiqueta:impressa`; cada impressão de
// etiqueta de caixa/mala gera um `etiqueta_caixa:impressa`. O "nº de vias" é a
// contagem desses eventos; a "última impressão" é o evento mais recente. Assim
// não duplicamos estado nas tabelas `itens`/`caixas`.
import { supabase } from "./supabase";

export const ACAO_IMPRESSAO = "etiqueta:impressa";          // itens (produto/quarentena)
export const ACAO_IMPRESSAO_CAIXA = "etiqueta_caixa:impressa"; // caixas/malas

// Etiquetas de PRODUTO/QUARENTENA têm SKU de item real; as de CAIXA/MALA usam o
// código da caixa como "sku". Cada tipo entra no controle de vias com sua ação.
export const isItemLabel = (l) => !!(l && l.sku && l.tipo !== "CAIXA" && l.tipo !== "MALA");
export const isBoxLabel = (l) => !!(l && l.sku && (l.tipo === "CAIXA" || l.tipo === "MALA"));

// Registra uma via de impressão (um evento por etiqueta) no histórico.
// Tolerante a falha: a impressão física não deve quebrar por erro de log.
export async function registrarImpressao(labels, user, preset) {
  const all = labels || [];
  const itens = all.filter(isItemLabel);
  const caixas = all.filter(isBoxLabel);
  if (!itens.length && !caixas.length) return { ok: true, skus: [], caixas: [] };
  const detalhe = preset?.id || preset?.label || null;
  const usuario = user?.email || null;
  const rows = [
    ...itens.map((l) => ({ sku: l.sku, acao: ACAO_IMPRESSAO, detalhe, usuario })),
    ...caixas.map((l) => ({ sku: l.sku, acao: ACAO_IMPRESSAO_CAIXA, detalhe, usuario })),
  ];
  const { error } = await supabase.from("eventos").insert(rows);
  if (error) {
    console.error("Falha ao registrar impressão de etiqueta:", error.message);
    return { ok: false, skus: [], caixas: [] };
  }
  const skus = itens.map((l) => l.sku);
  // Atalho denormalizado p/ o filtro "triados sem etiqueta" (best-effort; a
  // verdade das vias continua em `eventos`).
  if (skus.length) await supabase.from("itens").update({ etiqueta_impressa: true }).in("sku", skus);
  return { ok: true, skus, caixas: caixas.map((l) => l.sku) };
}

// Conta vias por id a partir do histórico, para uma dada ação.
// Retorna { [id]: { vias, ultima } }; ids nunca impressos ficam ausentes.
async function contarVias(acao, ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return {};
  const { data, error } = await supabase
    .from("eventos")
    .select("sku, ts")
    .eq("acao", acao)
    .in("sku", list);
  if (error || !data) return {};
  const map = {};
  for (const r of data) {
    const cur = map[r.sku] || { vias: 0, ultima: null };
    cur.vias += 1;
    if (!cur.ultima || new Date(r.ts) > new Date(cur.ultima)) cur.ultima = r.ts;
    map[r.sku] = cur;
  }
  return map;
}

// Vias impressas por SKU de item.
export const buscarViasImpressao = (skus) => contarVias(ACAO_IMPRESSAO, skus);

// Vias impressas por código de caixa/mala.
export const buscarViasImpressaoCaixa = (codigos) => contarVias(ACAO_IMPRESSAO_CAIXA, codigos);

// Atualização otimista local após imprimir (evita reconsultar o banco na hora).
export function aplicarViasLocal(mapa, skus) {
  const agora = new Date().toISOString();
  const n = { ...mapa };
  for (const sku of skus || []) {
    const cur = n[sku] || { vias: 0, ultima: null };
    n[sku] = { vias: cur.vias + 1, ultima: agora };
  }
  return n;
}
