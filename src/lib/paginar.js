// O PostgREST corta cada resposta em 1.000 linhas: leituras completas precisam paginar por .range().
// `montar(de, ate)` devolve a query já ordenada e com .range(de, ate).
export async function lerTodas(montar, passo = 1000) {
  const out = [];
  for (let de = 0; ; de += passo) {
    const { data, error } = await montar(de, de + passo - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < passo) return out;
  }
}

// Busca sem acento/caixa; várias palavras = todas precisam aparecer.
export const normaliza = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const combina = (texto, busca) => { const t = normaliza(texto); return normaliza(busca).split(/\s+/).filter(Boolean).every((p) => t.includes(p)); };

export const TAM_PAGINA = 50;
export const paginar = (lista, pagina, tam = TAM_PAGINA) => lista.slice(pagina * tam, (pagina + 1) * tam);
export const totalPaginas = (n, tam = TAM_PAGINA) => Math.max(1, Math.ceil(n / tam));
