// Núcleo PURO do catálogo (sem rede): dedup, agrupamento, selos de condição e
// status excluídos. Separado de catalogo.js (que faz a query no supabase) para ser
// importável em testes Node sem puxar a cadeia do cliente. catalogo.js reexporta.
import { precoVenda } from "./export.js";
import { ordenarTamanhos, tamanhoLabel } from "./tamanhos.js";

export const DESTINO_SEM = "__sem__"; // espelha o sentinela do ItemsScreen

// Status que tiram o item do estoque vendável: por padrão o catálogo os exclui
// (em vez de uma allowlist — os status mudam e o catálogo deve mostrar tudo que
// está pronto, não uma lista fixa). ENTREGUE = já saiu do estoque.
export const CATALOGO_STATUS_EXCLUIR = ["VENDIDO", "DESCARTE", "ENTREGUE"];

// estado do item → selo do card (rótulo de CLIENTE). Itens com estado fora deste
// mapa (ou nulo) NÃO entram no catálogo (nunca anunciar sem condição definida).
export const CATALOGO_ESTADO_BADGE = {
  Novo: { txt: "Novo", cls: "novo" },
  "Embalagem aberta/avariada": { txt: "Caixa aberta", cls: "aberta" },
  Usado: { txt: "Seminovo", cls: "semi" },
  "Usado funcionando": { txt: "Seminovo", cls: "semi" },
  "Usado sem teste": { txt: "Como está", cls: "asis" },
  Avariado: { txt: "Como está", cls: "asis" },
};

const norm = (v) => String(v ?? "").trim().toLowerCase();

// Preço de venda do card = preço real (preco_ideal) do item representante.
const precoRep = (c) => precoVenda(c.rep) || 0;

// Deduplica produtos idênticos em um card com quantidade. Chave:
// produto+marca+modelo+cor+tamanho+estado+preço de venda.
// Retorna [{ rep, qtd, skus }] ordenado por preço desc.
export function dedupCatalogo(itens) {
  const mapa = new Map();
  for (const it of itens || []) {
    const chave = [
      norm(it.produto), norm(it.marca), norm(it.modelo), norm(it.cor),
      norm(it.tamanho), norm(it.estado), precoVenda(it) || 0,
    ].join("|");
    const atual = mapa.get(chave);
    if (atual) {
      atual.qtd += 1;
      atual.skus.push(it.sku);
    } else {
      mapa.set(chave, { rep: it, qtd: 1, skus: [it.sku] });
    }
  }
  return [...mapa.values()].sort((a, b) => precoRep(b) - precoRep(a));
}

const precoCard = (c) => precoRep(c) * c.qtd;

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
    const grpCards = mapa.get(chave).sort((a, b) => precoRep(b) - precoRep(a));
    return {
      chave,
      titulo: tituloDe(chave),
      grupoRaw: dimensao === "categoria" ? chave : grpCards[0]?.rep.grupo || "",
      cards: grpCards,
      valorTotal: grpCards.reduce((s, c) => s + precoCard(c), 0),
    };
  });
}
