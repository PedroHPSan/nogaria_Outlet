// Helpers de HTML puros (sem rede) — importáveis tanto no app (Vite) quanto em
// testes Node. Isolado de portfolio.js, que puxa o cliente supabase (import.meta.env)
// e por isso não pode ser importado em Node.
export const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
