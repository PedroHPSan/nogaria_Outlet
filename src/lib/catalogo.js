// Catálogo geral de produtos: busca os itens (com os mesmos filtros da aba
// Itens + filtro por caixa). O dedup/agrupamento/selos são PUROS e vivem em
// catalogoCore.js (testáveis em Node); aqui fica só a query no supabase.
import { supabase } from "./supabase.js";
import { LOTE_SEM } from "./model.js";
import { DESTINO_SEM, CATALOGO_STATUS_EXCLUIR, CATALOGO_ESTADO_BADGE } from "./catalogoCore.js";

// Reexporta o núcleo puro para os consumidores antigos (PortfolioScreen, template).
export {
  DESTINO_SEM, CATALOGO_STATUS_EXCLUIR, CATALOGO_ESTADO_BADGE,
  dedupCatalogo, agruparCatalogo,
} from "./catalogoCore.js";

// Busca paginada (PostgREST corta em 1.000 linhas) replicando os operadores do
// ItemsScreen. `filtros` aceita: lote, classe, status, grupo, destino, caixaId,
// pendMedida, semCaixa, semEtiq, semClasse, semFoto, q, e os flags de regra
// soComPreco/statusPadrao/soComEstado (todos default true).
export async function listarItensCatalogo(filtros = {}) {
  const {
    lote, classe, status, grupo, destino, caixaId,
    pendMedida, semCaixa, semEtiq, semClasse, semFoto, q,
    soComPreco = true, statusPadrao = true, soComEstado = true,
  } = filtros;
  const excluirStatus = `(${CATALOGO_STATUS_EXCLUIR.join(",")})`;

  const PAGE = 1000;
  let data = [];
  for (let from = 0; ; from += PAGE) {
    let query = supabase.from("itens").select("*");

    if (lote === LOTE_SEM) query = query.is("lote", null);
    else if (lote) query = query.eq("lote", Number(lote));
    if (classe) query = query.eq("classe", classe);
    if (status) query = query.eq("status", status);
    else if (statusPadrao) query = query.not("status", "in", excluirStatus);
    if (grupo) query = query.eq("grupo", grupo);
    if (destino === DESTINO_SEM) query = query.is("destino", null);
    else if (destino) query = query.eq("destino", destino);
    if (caixaId) query = query.eq("caixa_id", caixaId);
    if (pendMedida) query = query.or("medidas_fonte.is.null,medidas_fonte.neq.MEDIDO");
    if (semCaixa) query = query.is("caixa_id", null);
    if (semEtiq) query = query.neq("status", "A_CATALOGAR").eq("etiqueta_impressa", false);
    if (semClasse) query = query.is("classe", null);
    if (semFoto) query = query.neq("status", "A_CATALOGAR").eq("foto_feita", false);
    // "Pronto para catálogo" = tem PREÇO DE VENDA REAL (preco_ideal). NUNCA usa
    // preco_sugerido (estimativa legada): é o campo que a tela/PDF/exportação usam.
    if (soComPreco) query = query.gt("preco_ideal", 0);
    if (q?.trim()) {
      const t = q.trim();
      query = query.or(`sku.ilike.%${t}%,produto.ilike.%${t}%,marca.ilike.%${t}%,modelo.ilike.%${t}%`);
    }

    const { data: chunk, error } = await query
      .order("preco_ideal", { ascending: false, nullsFirst: false })
      .order("sku")
      .range(from, from + PAGE - 1);
    if (error || !chunk) break;
    data = data.concat(chunk);
    if (chunk.length < PAGE) break;
  }

  // Exclui condições não mapeadas (ou nulas). Feito no cliente porque comparar
  // texto acentuado com IN no PostgREST é frágil.
  if (soComEstado) data = data.filter((it) => CATALOGO_ESTADO_BADGE[(it.estado || "").trim()]);
  return data;
}
