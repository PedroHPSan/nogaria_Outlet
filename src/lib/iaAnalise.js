// Lógica pura do assistente de IA (sem Supabase, testável no Node). Constrói as
// sugestões campo-a-campo do retorno da edge function enriquecer-produto, separa o
// que pode ser preenchido automaticamente (campos vazios) do que já tem valor humano
// (sugestão manual) e monta o snapshot durável `ia_analise`.
import { fmtBRL } from "./model.js";

// Espelha MEDIDAS_FONTE.ESTIMADO sem importar medidas.js (que puxa supabase e
// quebraria os testes puros no Node).
const FONTE_ESTIMADO = "ESTIMADO";

export const campoVazio = (v) =>
  v == null || v === "" || (Array.isArray(v) && v.length === 0);

// k → colunas do item que representam o campo (para decidir se está "vazio").
export const ALVO = {
  titulo_anuncio: ["titulo_anuncio"],
  descricao_anuncio: ["descricao_anuncio"],
  marca: ["marca"],
  modelo: ["modelo"],
  grupo: ["grupo"],
  ncm: ["ncm"],
  voltagem: ["voltagem"],
  cor: ["cor"],
  dimensoes: ["comprimento_cm", "largura_cm", "altura_cm", "peso_real_kg"],
  preco: ["preco_ref_novo", "preco_ref_usado"],
  preco_ideal: ["preco_ideal"],
  bullet_points: ["bullet_points"],
  palavras_chave: ["palavras_chave"],
  ficha_tecnica: ["ficha_tecnica"],
};

// Constrói as sugestões aplicáveis a partir do retorno da IA (campo a campo).
export function construirSugestoes(iaData, item) {
  if (!iaData) return [];
  const d = iaData.dimensoes_estimadas || {};
  const temDim = [d.comprimento_cm, d.largura_cm, d.altura_cm, d.peso_kg].some((v) => v != null);
  const lista = [
    { k: "titulo_anuncio", label: "Título", val: iaData.titulo_anuncio, patch: { titulo_anuncio: iaData.titulo_anuncio } },
    { k: "descricao_anuncio", label: "Descrição", val: iaData.descricao_anuncio, patch: { descricao_anuncio: iaData.descricao_anuncio } },
    { k: "marca", label: "Marca", val: iaData.marca, patch: { marca: iaData.marca } },
    { k: "modelo", label: "Modelo", val: iaData.modelo, patch: { modelo: iaData.modelo } },
    { k: "grupo", label: "Categoria", val: iaData.grupo, patch: { grupo: iaData.grupo } },
    { k: "ncm", label: "NCM", val: iaData.ncm, patch: { ncm: iaData.ncm } },
    { k: "voltagem", label: "Voltagem", val: iaData.voltagem, patch: { voltagem: iaData.voltagem } },
    { k: "cor", label: "Cor", val: iaData.cor, patch: { cor: iaData.cor } },
    temDim && {
      k: "dimensoes", label: "Dimensões (C×L×A, peso)",
      val: `${d.comprimento_cm ?? "–"}×${d.largura_cm ?? "–"}×${d.altura_cm ?? "–"} cm · ${d.peso_kg ?? "–"} kg`,
      patch: {
        comprimento_cm: d.comprimento_cm ?? item.comprimento_cm, largura_cm: d.largura_cm ?? item.largura_cm,
        altura_cm: d.altura_cm ?? item.altura_cm, peso_real_kg: d.peso_kg ?? item.peso_real_kg,
        medidas_fonte: FONTE_ESTIMADO,
      },
    },
    (iaData.preco_ref_novo != null || iaData.preco_ref_usado != null) && {
      k: "preco", label: `Preço ref. (IA · ${iaData.preco_ref_confianca || "—"})`,
      val: `Novo ${fmtBRL(iaData.preco_ref_novo)} · Usado ${fmtBRL(iaData.preco_ref_usado)}`,
      patch: {
        preco_ref_novo: iaData.preco_ref_novo, preco_ref_usado: iaData.preco_ref_usado,
        preco_ref_confianca: iaData.preco_ref_confianca, preco_ref_fonte: "IA:claude",
      },
    },
    Array.isArray(iaData.pontos) && iaData.pontos.length > 0 && {
      k: "bullet_points", label: "Bullets (anúncio)", val: iaData.pontos.join(" · "),
      patch: { bullet_points: iaData.pontos },
    },
    iaData.palavras_chave && {
      k: "palavras_chave", label: "Palavras-chave", val: iaData.palavras_chave,
      patch: { palavras_chave: iaData.palavras_chave },
    },
    Array.isArray(iaData.ficha_tecnica) && iaData.ficha_tecnica.length > 0 && {
      k: "ficha_tecnica", label: "Ficha técnica",
      val: iaData.ficha_tecnica.map((f) => `${f.atributo}: ${f.valor}`).join(" · "),
      patch: { ficha_tecnica: iaData.ficha_tecnica },
    },
  ];
  return lista.filter((s) => s && s.val != null && s.val !== "");
}

// Uma sugestão é "vazia" (auto-aplicável) se TODAS as colunas-alvo estão vazias no item.
export function sugestaoVazia(sug, item) {
  const cols = ALVO[sug.k] || [sug.k];
  return cols.every((c) => campoVazio(item[c]));
}

// Separa as sugestões em vazias (auto) e preenchidas (já têm valor humano → manual).
export function separarSugestoes(sugestoes, item) {
  const vazias = [], preenchidas = [];
  for (const s of sugestoes) (sugestaoVazia(s, item) ? vazias : preenchidas).push(s);
  return { vazias, preenchidas };
}

// Mescla os patches das sugestões passadas num único patch.
export function patchVazios(vazias) {
  return Object.assign({}, ...vazias.map((s) => s.patch));
}

// Monta o snapshot durável ia_analise. `sugestoes` guarda {k,label,val,patch} para
// permitir aplicar as pendentes mesmo após recarregar.
export function montarAnalise(iaData, sugestoes, aplicados, { em, por }) {
  return {
    em, por,
    usou_foto: !!iaData.usou_foto,
    confianca: iaData.preco_ref_confianca || null,
    observacoes: iaData.observacoes || null,
    campos_faltantes: Array.isArray(iaData.campos_faltantes) ? iaData.campos_faltantes : [],
    sugestoes: sugestoes.map((s) => ({ k: s.k, label: s.label, val: s.val, patch: s.patch })),
    aplicados: [...aplicados],
  };
}
