// Catálogo geral de produtos: busca os itens (com os mesmos filtros da aba
// Itens + filtro por caixa), deduplica produtos idênticos em um único card com
// quantidade e agrupa por categoria/tamanho/lote/marca. Alimenta tanto a galeria
// on-screen quanto o gerador de PDF de marca (catalogoTemplate.js).
import { supabase } from "./supabase";
import { LOTE_SEM } from "./model";
import { ordenarTamanhos, tamanhoLabel } from "./portfolio";

export const DESTINO_SEM = "__sem__"; // espelha o sentinela do ItemsScreen
export const CATALOGO_STATUS_PADRAO = ["PRECIFICADO", "PRONTO", "ANUNCIADO"];

// estado do item → selo do card. Itens com estado fora deste mapa (ou nulo) NÃO
// entram no catálogo (regra da spec: nunca publicar item sem condição definida).
export const CATALOGO_ESTADO_BADGE = {
  Novo: { txt: "Novo", cls: "novo" },
  "Embalagem aberta/avariada": { txt: "Caixa aberta", cls: "aberta" },
  Usado: { txt: "Seminovo", cls: "semi" },
};

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

  const PAGE = 1000;
  let data = [];
  for (let from = 0; ; from += PAGE) {
    let query = supabase.from("itens").select("*");

    if (lote === LOTE_SEM) query = query.is("lote", null);
    else if (lote) query = query.eq("lote", Number(lote));
    if (classe) query = query.eq("classe", classe);
    if (status) query = query.eq("status", status);
    else if (statusPadrao) query = query.in("status", CATALOGO_STATUS_PADRAO);
    if (grupo) query = query.eq("grupo", grupo);
    if (destino === DESTINO_SEM) query = query.is("destino", null);
    else if (destino) query = query.eq("destino", destino);
    if (caixaId) query = query.eq("caixa_id", caixaId);
    if (pendMedida) query = query.or("medidas_fonte.is.null,medidas_fonte.neq.MEDIDO");
    if (semCaixa) query = query.is("caixa_id", null);
    if (semEtiq) query = query.neq("status", "A_CATALOGAR").eq("etiqueta_impressa", false);
    if (semClasse) query = query.is("classe", null);
    if (semFoto) query = query.neq("status", "A_CATALOGAR").eq("foto_feita", false);
    if (soComPreco) query = query.gt("preco_sugerido", 0);
    if (q?.trim()) {
      const t = q.trim();
      query = query.or(`sku.ilike.%${t}%,produto.ilike.%${t}%,marca.ilike.%${t}%,modelo.ilike.%${t}%`);
    }

    const { data: chunk, error } = await query
      .order("preco_sugerido", { ascending: false, nullsFirst: false })
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

const norm = (v) => String(v ?? "").trim().toLowerCase();

// Deduplica produtos idênticos em um card com quantidade. Chave da spec:
// produto+marca+modelo+cor+tamanho+estado+preco_sugerido.
// Retorna [{ rep, qtd, skus }] ordenado por preço desc.
export function dedupCatalogo(itens) {
  const mapa = new Map();
  for (const it of itens || []) {
    const chave = [
      norm(it.produto), norm(it.marca), norm(it.modelo), norm(it.cor),
      norm(it.tamanho), norm(it.estado), Number(it.preco_sugerido) || 0,
    ].join("|");
    const atual = mapa.get(chave);
    if (atual) {
      atual.qtd += 1;
      atual.skus.push(it.sku);
    } else {
      mapa.set(chave, { rep: it, qtd: 1, skus: [it.sku] });
    }
  }
  return [...mapa.values()].sort(
    (a, b) => (Number(b.rep.preco_sugerido) || 0) - (Number(a.rep.preco_sugerido) || 0)
  );
}

const precoCard = (c) => (Number(c.rep.preco_sugerido) || 0) * c.qtd;

// Agrupa os cards deduplicados pela dimensão escolhida e ordena as seções por
// valor total (Σ preço×qtd) desc. Retorna [{ chave, titulo, grupoRaw, cards, valorTotal }].
// dimensao: "categoria" | "tamanho" | "lote" | "marca".
export function agruparCatalogo(cards, dimensao = "categoria") {
  const chaveDe = (c) => {
    if (dimensao === "tamanho") return tamanhoLabel(c.rep.tamanho);
    if (dimensao === "lote") return c.rep.lote != null ? String(c.rep.lote) : "Sem lote";
    if (dimensao === "marca") return (c.rep.marca || "").trim() || "Sem marca";
    return (c.rep.grupo || "").trim() || "Sem categoria";
  };
  const tituloDe = (chave) => (dimensao === "tamanho" ? `Nº ${chave}` : dimensao === "lote" && chave !== "Sem lote" ? `Lote ${chave}` : chave);

  const mapa = new Map();
  for (const c of cards || []) {
    const chave = chaveDe(c);
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push(c);
  }

  let chaves = [...mapa.keys()];
  // Tamanho usa a ordenação natural; as demais dimensões ordenam por valor total.
  if (dimensao === "tamanho") {
    chaves = ordenarTamanhos(chaves);
  } else {
    chaves.sort((a, b) => {
      const va = mapa.get(a).reduce((s, c) => s + precoCard(c), 0);
      const vb = mapa.get(b).reduce((s, c) => s + precoCard(c), 0);
      return vb - va;
    });
  }

  return chaves.map((chave) => {
    const grpCards = mapa.get(chave).sort(
      (a, b) => (Number(b.rep.preco_sugerido) || 0) - (Number(a.rep.preco_sugerido) || 0)
    );
    return {
      chave,
      titulo: tituloDe(chave),
      grupoRaw: dimensao === "categoria" ? chave : grpCards[0]?.rep.grupo || "",
      cards: grpCards,
      valorTotal: grpCards.reduce((s, c) => s + precoCard(c), 0),
    };
  });
}
