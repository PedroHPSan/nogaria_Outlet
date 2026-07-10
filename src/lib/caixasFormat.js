// Helpers puros de caixas (sem dependência do Supabase, testáveis no Node).

// Formata data para dd/mm/aaaa. Aceita "YYYY-MM-DD" (do <input type=date>) sem
// escorregar de fuso, e ISO com hora como fallback. Vazio/null → "".
export function formatDataBR(v) {
  if (!v) return "";
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  return isNaN(d) ? "" : d.toLocaleDateString("pt-BR");
}

// Detalhe do evento de chegada: "Belém · dd/mm/aaaa · <local>", omitindo partes vazias.
export function chegadaDetalhe(chegouEm, local) {
  return ["Belém", formatDataBR(chegouEm), String(local || "").trim()]
    .filter(Boolean)
    .join(" · ");
}
