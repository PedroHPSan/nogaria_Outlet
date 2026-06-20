// Controle de vias de impressão de etiquetas.
// Fonte da verdade: a tabela `eventos` (histórico/auditoria). Cada impressão de
// uma etiqueta de item gera um evento `etiqueta:impressa`. O "nº de vias" de um
// SKU é a contagem desses eventos; a "última impressão" é o evento mais recente.
// Assim não duplicamos estado na tabela `itens`.
import { supabase } from "./supabase";

export const ACAO_IMPRESSAO = "etiqueta:impressa";

// Só etiquetas de PRODUTO/QUARENTENA têm SKU de item real. Etiquetas de
// CAIXA/MALA usam o caixa_num como "sku" e não entram no controle de vias.
const isItemLabel = (l) => !!(l && l.sku && l.tipo !== "CAIXA" && l.tipo !== "MALA");

// Registra uma via de impressão (um evento por item) no histórico.
// Tolerante a falha: a impressão física não deve quebrar por erro de log.
export async function registrarImpressao(labels, user, preset) {
  const itens = (labels || []).filter(isItemLabel);
  if (!itens.length) return { ok: true, skus: [] };
  const detalhe = preset?.id || preset?.label || null;
  const rows = itens.map((l) => ({
    sku: l.sku,
    acao: ACAO_IMPRESSAO,
    detalhe,
    usuario: user?.email || null,
  }));
  const { error } = await supabase.from("eventos").insert(rows);
  if (error) {
    console.error("Falha ao registrar impressão de etiqueta:", error.message);
    return { ok: false, skus: [] };
  }
  const skus = itens.map((l) => l.sku);
  // Atalho denormalizado p/ o filtro "triados sem etiqueta" (best-effort; a
  // verdade das vias continua em `eventos`).
  await supabase.from("itens").update({ etiqueta_impressa: true }).in("sku", skus);
  return { ok: true, skus };
}

// Para uma lista de SKUs, retorna { [sku]: { vias, ultima } } a partir do
// histórico de impressões. Itens nunca impressos ficam ausentes do mapa.
export async function buscarViasImpressao(skus) {
  const list = [...new Set((skus || []).filter(Boolean))];
  if (!list.length) return {};
  const { data, error } = await supabase
    .from("eventos")
    .select("sku, ts")
    .eq("acao", ACAO_IMPRESSAO)
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
