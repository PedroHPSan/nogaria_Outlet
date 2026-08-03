// Seleção em massa da lista de itens (etiquetas / orçamento).
//
// A seleção guarda o ITEM INTEIRO, não só o SKU. Motivo: ela sobrevive à troca
// de filtro, busca e paginação, e nesses casos o item escolhido antes já não
// está mais na lista em tela. Guardando só o SKU, montar o lote com
// `itensNaTela.filter(i => sel.has(i.sku))` descarta silenciosamente tudo que
// saiu da tela — era o bug do orçamento que "só imprimia o que estava em tela".
//
// Mapa: Map<sku, item>. A ordem de leitura é sempre por SKU (mesma da lista),
// não a ordem de clique.

export function alternarSelecao(mapa, item) {
  const n = new Map(mapa);
  n.has(item.sku) ? n.delete(item.sku) : n.set(item.sku, item);
  return n;
}

export function marcarTodos(mapa, itens = []) {
  const n = new Map(mapa);
  itens.forEach((it) => n.set(it.sku, it));
  return n;
}

export function desmarcarTodos(mapa, itens = []) {
  const n = new Map(mapa);
  itens.forEach((it) => n.delete(it.sku));
  return n;
}

export const todosSelecionados = (mapa, itens = []) =>
  itens.length > 0 && itens.every((it) => mapa.has(it.sku));

// Itens escolhidos, ordenados por SKU. `itensNaTela` serve só para REFRESCAR a
// cópia guardada (foto recém-enviada, status alterado) — nunca para filtrar.
export function selecionados(mapa, itensNaTela = []) {
  const frescos = new Map((itensNaTela || []).map((it) => [it.sku, it]));
  return Array.from(mapa.values())
    .map((it) => frescos.get(it.sku) || it)
    .sort((a, b) => String(a.sku).localeCompare(String(b.sku), "pt-BR"));
}
