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

// Grupos que carregam tamanho (calçado = numeração; vestuário = P/M/G, 38, 42…).
export const ehVestuario = (it) => /vestu[aá]rio/i.test(it?.grupo || "");
export const temTamanho = (it) => ehCalcado(it) || ehVestuario(it);

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

// --- Vestuário → padrão europeu (EU) ----------------------------------------------
// Não existe regra única BR→EU para roupa: a numeração depende de gênero e modelagem
// (calça masculina 40 ≠ blusa feminina 40) e varia por marca. Por isso só convertemos o
// que dá para afirmar com segurança e, no resto, mostramos o tamanho marcado como BR:
//   • Letras: grade internacional (P=S, G=L, GG=XL, EG/XG=XXL…).
//   • Número feminino (gênero inferido pelo nome do produto): tabela abaixo (EU = BR − 2,
//     referência de mercado; ex.: BR 40 = EU 38).
//   • Número masculino/indefinido, meias, plus size (G1, G2…), infantil: sem conversão → "BR 40".
// Para corrigir uma equivalência, ajuste só estas tabelas.
const LETRAS_EU = { pp: "XS", p: "S", m: "M", g: "L", gg: "XL", xg: "XXL", eg: "XXL", xgg: "3XL", egg: "3XL" };
export const VEST_FEM_BR_EU = { 34: 32, 36: 34, 38: 36, 40: 38, 42: 40, 44: 42, 46: 44, 48: 46, 50: 48, 52: 50, 54: 52 };

const semAcento = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const RE_MASC = /\b(masculin[oa]s?|homem|homens|unissex|unisex|cuecas?)\b/;
const RE_FEM = /\b(feminin[oa]s?|mulher|mulheres|vestidos?|saias?|blusas?|blusinhas?|sutias?|biquinis?|leggings?|calcinhas?|camisolas?|maios?|croppeds?|lingeries?|gestante)\b/;
const RE_MEIA = /\b(meias?|soquetes?)\b/; // meia usa numeração de calçado (35-44)

// "f" | "m" | null, a partir do nome do produto. Masculino/unissex tem precedência.
export function generoVestuario(it) {
  const s = semAcento(it?.produto);
  if (RE_MASC.test(s)) return "m";
  return RE_FEM.test(s) ? "f" : null;
}

const RE_NUM_FAIXA = /^\d+(?:[.,]\d+)?(?:\s*[/-]\s*\d+(?:[.,]\d+)?)*$/;

// "G" → "EU L"; "40" + feminino → "EU 38"; "38/40" + feminino → "EU 36/38". Null quando não dá
// para afirmar (número sem gênero feminino, meia, plus size, texto livre, já em EU/US/UK).
export function tamanhoEUVestuario(t, it = null) {
  const s = String(t ?? "").trim().toLowerCase().replace(/\s*br$/, "");
  if (!s || /(^|[^a-z])(eu|us|usa|eua|uk)([^a-z]|$)/.test(s)) return null;
  if (LETRAS_EU[s]) return `EU ${LETRAS_EU[s]}`;
  if (!RE_NUM_FAIXA.test(s) || RE_MEIA.test(semAcento(it?.produto)) || generoVestuario(it) !== "f") return null;
  const eu = s.match(/\d+(?:[.,]\d+)?/g).map((n) => VEST_FEM_BR_EU[n]);
  if (eu.some((v) => v == null)) return null;
  return `EU ${eu.join(s.includes("-") ? "-" : "/")}`;
}

// Número de vestuário não convertido → "BR 40" (deixa claro que é grade brasileira).
const marcaBR = (bruto) => (RE_NUM_FAIXA.test(bruto.replace(/\s*br$/i, "")) ? `BR ${bruto.replace(/\s*br$/i, "")}` : null);

// Etiqueta: "EU 40 · BR 38" (confere o par com a numeração original). Só quando a origem é BR.
export function tamanhoEtiqueta(it) {
  const eu = tamanhoExibicao(it);
  const bruto = String(it?.tamanho ?? "").trim();
  const origemBR = ehVestuario(it) ? /^([\d\s.,/-]+|[a-z]{1,3})(\s*br)?$/i : /^[\d\s.,/-]+(br)?$/i;
  if (!eu.startsWith("EU ") || eu === bruto || !origemBR.test(bruto)) return eu;
  return `${eu} · BR ${bruto.replace(/\s*br$/i, "").toUpperCase()}`;
}

// Tamanho para exibir: calçado → EU; vestuário → EU quando seguro, senão "BR n"; demais → original.
export function tamanhoExibicao(it) {
  const bruto = String(it?.tamanho ?? "").trim();
  if (!bruto) return "";
  if (ehCalcado(it)) return tamanhoEU(bruto) || bruto;
  if (ehVestuario(it)) return tamanhoEUVestuario(bruto, it) || marcaBR(bruto) || bruto;
  return bruto;
}
