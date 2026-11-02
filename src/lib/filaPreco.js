// Fila de preço do catálogo (C2): peças em Foto OK ou além que ainda não são elegíveis, com o motivo.
// A regra vem do banco (catalogo_elegibilidade); aqui só junta o nome da peça para a tela.
import { supabase } from "./supabase.js";
import { MOTIVO_ROTULO } from "./catalogoElegibilidade.js";

export const MOTIVOS_FILA = ["sem_preco", "sem_categoria", "sem_estado", "sem_foto"];
export { MOTIVO_ROTULO };
export const TAMANHOS_LOTE = [50, 200, 1000];

const em = async (tabela, colunas, chave, valores, tam = 150) => {
  const partes = [];
  for (let i = 0; i < valores.length; i += tam) partes.push(valores.slice(i, i + tam));
  const rs = await Promise.all(partes.map((p) => supabase.from(tabela).select(colunas).in(chave, p)));
  return rs.flatMap((r) => { if (r.error) throw r.error; return r.data || []; });
};

// Incompletas em Foto OK+ (ignora etapa anterior, vendido e reservado — não são pendência de cadastro).
export async function listarIncompletas() {
  const { data, error } = await supabase.rpc("catalogo_elegibilidade", { p_sku: null });
  if (error) throw error;
  const pend = (data || []).filter((r) => !r.elegivel && !r.motivos.includes("etapa") && !r.motivos.includes("vendido")
    && r.motivos.some((m) => MOTIVOS_FILA.includes(m)));
  const itens = await em("itens", "sku,produto,grupo,estado,lote,preco_sugerido", "sku", pend.map((r) => r.sku));
  const porSku = new Map(itens.map((i) => [i.sku, i]));
  return pend.map((r) => ({ ...porSku.get(r.sku), sku: r.sku, motivos: r.motivos })).sort((a, b) => a.sku.localeCompare(b.sku));
}

// Itens completos (select *) para o motor de preço analisar um lote.
export const carregarItens = (skus) => em("itens", "*", "sku", skus);
