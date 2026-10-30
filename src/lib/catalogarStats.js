// Helpers puros de catalogação (sem Supabase, testáveis no Node).

// Agrupa linhas [{lote}] por lote e conta. lote nulo/indefinido vira null
// ("sem lote"). Retorna [{lote, count}] ordenado por count desc; empatando,
// lote asc com null por último.
export function tallyPorLote(rows) {
  const mapa = new Map();
  for (const r of rows || []) {
    const k = r.lote ?? null;
    mapa.set(k, (mapa.get(k) || 0) + 1);
  }
  return [...mapa.entries()]
    .map(([lote, count]) => ({ lote, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (a.lote === null) return 1;
      if (b.lote === null) return -1;
      return a.lote - b.lote;
    });
}

// Avisos da substituição de "A CATALOGAR": aplicou menos do que o pedido e/ou fotos não copiadas.
export function avisosSubstituicao({ pedido, aplicados, semFoto = [] }) {
  const avisos = [];
  if (aplicados < pedido) avisos.push(`Só ${aplicados} de ${pedido} itens "A CATALOGAR" estavam disponíveis no lote — aplicado em ${aplicados}.`);
  if (semFoto.length) avisos.push(`Fotos não copiadas em: ${semFoto.join(", ")}.`);
  return avisos;
}
