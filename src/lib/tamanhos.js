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

// --- Numeração de calçados → padrão europeu (EU) ---------------------------------
// Número solto ou com "BR" é numeração brasileira. Regra de mercado: EU = BR + 2
// (BR 38 = EU 40). Marcas que fogem da regra: ajuste só este deslocamento (ou acrescente
// exceções por marca). Conferir com alguns pares físicos.
export const BR_PARA_EU = 2;
const DESLOC_EU = { br: BR_PARA_EU, eu: 0, uk: 34, us_m: 33, us_f: 31 };

export const ehCalcado = (it) => /cal[çc]ado/i.test(it?.grupo || "");

// "38 BR" → "EU 38"; "36/37" → "EU 36/37"; "US 9" → "EU 42"; "UK 8" → "EU 42"; "US 8 W" → "EU 39".
// Retorna null quando não dá para converter com segurança (texto, vazio, fora de 15–50).
export function tamanhoEU(t) {
  const s = String(t ?? "").trim().toLowerCase();
  const nums = s.match(/\d+(?:[.,]\d+)?/g);
  if (!nums) return null;
  const sis = /(^|[^a-z])(us|usa|eua)([^a-z]|$)/.test(s)
    ? (/(^|[^a-z])(w|f|fem|feminino|women)([^a-z]|$)/.test(s) ? "us_f" : "us_m")
    : /(^|[^a-z])uk([^a-z]|$)/.test(s) ? "uk"
    : /(^|[^a-z])eu([^a-z]|$)/.test(s) ? "eu" : "br";
  const conv = nums.map((n) => Math.round((parseFloat(n.replace(",", ".")) + DESLOC_EU[sis]) * 10) / 10);
  if (conv.some((v) => v < 15 || v > 50)) return null;
  const sep = s.includes("/") ? "/" : s.includes("-") ? "-" : "/";
  return `EU ${conv.map((v) => String(v).replace(".", ",")).join(sep)}`;
}

// Etiqueta interna: "EU 40 · BR 38" (confere o par com a numeração original). Só quando a origem é BR.
export function tamanhoEtiqueta(it) {
  const eu = tamanhoExibicao(it);
  const bruto = String(it?.tamanho ?? "").trim();
  if (!eu || eu === bruto || !/^[\d\s.,/-]+(br)?$/i.test(bruto)) return eu;
  return `${eu} · BR ${bruto.replace(/\s*br$/i, "")}`;
}

// Numeração para exibir: calçado → EU (quando convertível); demais → texto original.
export function tamanhoExibicao(it) {
  const bruto = String(it?.tamanho ?? "").trim();
  if (!bruto) return "";
  return (ehCalcado(it) && tamanhoEU(bruto)) || bruto;
}
