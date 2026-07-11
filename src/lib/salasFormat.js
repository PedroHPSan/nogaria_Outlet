// Funções puras de salas (sem UI, sem Supabase) — testadas em scripts/test_salas.mjs.

// Roteia um texto lido (QR ou digitado) para { tipo, codigo }. Tolera deep-links
// "?item=" / "?caixa=" / "?sala=". tipo ∈ 'SALA' | 'CAIXA' | 'ITEM' | null (vazio).
export function parseCodigoLido(texto) {
  const raw = String(texto || "").trim();
  const m = raw.match(/[?&](?:item|caixa|sala)=([^&]+)/i);
  const codigo = (m ? decodeURIComponent(m[1]) : raw).trim().toUpperCase();
  let tipo = null;
  if (/^SALA-/.test(codigo)) tipo = "SALA";
  else if (/^CX-/.test(codigo) || /^MALA-/.test(codigo)) tipo = "CAIXA";
  else if (codigo) tipo = "ITEM";
  return { tipo, codigo };
}

// Rótulo curto da sala para etiquetas e telas: "SALA-001 · Galpão A".
// Aceita a linha da sala (ou null). Sem código → "—".
export function salaLabelTexto(sala) {
  if (!sala || !sala.codigo) return "—";
  return sala.nome ? `${sala.codigo} · ${sala.nome}` : sala.codigo;
}
