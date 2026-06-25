// Helpers puros de tamanho/numeração (sem dependências de rede). Vivem aqui para
// poderem ser importados por módulos puros e testáveis (catalogoCore) sem puxar a
// cadeia do supabase. portfolio.js reexporta para manter sua API.

// Rótulo de tamanho normalizado (vazio vira "Sem tamanho").
export const tamanhoLabel = (t) => {
  const s = String(t ?? "").trim();
  return s || "Sem tamanho";
};

// Ordena tamanhos de forma natural: numéricos crescentes primeiro, depois texto
// (ex.: "M", "G"), e "Sem tamanho" sempre por último.
export function ordenarTamanhos(tams) {
  const num = (t) => {
    const m = String(t).match(/\d+([.,]\d+)?/);
    return m ? parseFloat(m[0].replace(",", ".")) : null;
  };
  return [...tams].sort((a, b) => {
    if (a === "Sem tamanho") return 1;
    if (b === "Sem tamanho") return -1;
    const na = num(a), nb = num(b);
    if (na != null && nb != null) return na - nb || String(a).localeCompare(String(b));
    if (na != null) return -1;
    if (nb != null) return 1;
    return String(a).localeCompare(String(b), "pt-BR");
  });
}
