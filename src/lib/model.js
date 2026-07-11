// Constantes e helpers de domínio do NOGÁRIA OUTLET

export const STATUS_FLOW = [
  { id: "A_CATALOGAR", label: "A catalogar", short: "Catalogar", color: "bg-gray-200 text-gray-700" },
  { id: "TRIADO", label: "Triado", short: "Triado", color: "bg-slate-300 text-slate-800" },
  { id: "TESTADO", label: "Testado", short: "Testado", color: "bg-sky-200 text-sky-900" },
  { id: "FOTOGRAFADO", label: "Fotografado", short: "Foto OK", color: "bg-indigo-200 text-indigo-900" },
  { id: "PRECIFICADO", label: "Precificado", short: "Preço OK", color: "bg-amber-200 text-amber-900" },
  { id: "PRONTO", label: "Pronto p/ anúncio", short: "Pronto", color: "bg-orange-300 text-orange-900" },
  { id: "ANUNCIADO", label: "Anunciado", short: "Anunciado", color: "bg-emerald-200 text-emerald-900" },
  { id: "VENDIDO", label: "Vendido", short: "Vendido", color: "bg-emerald-600 text-white" },
  { id: "ENTREGUE", label: "Entregue", short: "Entregue", color: "bg-teal-700 text-white" },
];
export const STATUS_DESCARTE = { id: "DESCARTE", label: "Descarte / Sucata", short: "Descarte", color: "bg-red-200 text-red-900" };
export const ALL_STATUS = [...STATUS_FLOW, STATUS_DESCARTE];
export const statusIdx = (id) => STATUS_FLOW.findIndex((s) => s.id === id);
export const statusMeta = (id) => ALL_STATUS.find((s) => s.id === id) || STATUS_FLOW[0];

// Status que NÃO são estoque ativo: VENDIDO/ENTREGUE já foram para o cliente,
// DESCARTE saiu por sucata. Fonte única — catálogo, portfólio, listagem geral,
// conferência e conteúdo de caixas derivam daqui (evita listas duplicadas).
export const STATUS_FORA_ESTOQUE = ["VENDIDO", "ENTREGUE", "DESCARTE"];
export const foraDoEstoque = (status) => STATUS_FORA_ESTOQUE.includes(status);
// Pronto para o filtro `in` do PostgREST: query.not("status", "in", <isto>).
export const STATUS_FORA_ESTOQUE_IN = `(${STATUS_FORA_ESTOQUE.join(",")})`;

export const CLASSE_STYLE = {
  "A+": "bg-purple-600 text-white",
  A: "bg-blue-600 text-white",
  B: "bg-teal-600 text-white",
  C: "bg-gray-400 text-white",
  D: "bg-amber-600 text-white",
  E: "bg-red-600 text-white",
};

export const ESTADOS = ["Novo", "Embalagem aberta/avariada", "Usado", "Avariado", "Usado sem teste"];
export const DESTINOS = ["Belém", "SP storage", "Venda local SP", "A definir"];

// Condição da EMBALAGEM (eixo independente do Estado do produto). Pares [código, label]:
// itens.cond_embalagem guarda o CÓDIGO (a view casa pricing_factor_embalagem.codigo).
export const EMBALAGENS = [
  ["PERFEITA", "Perfeita"],
  ["LEVE", "Levemente avariada"],
  ["MEDIA", "Média"],
  ["FORTE", "Forte"],
  ["SEM_CAIXA", "Sem caixa"],
];
export const embalagemLabel = (cod) => (EMBALAGENS.find(([c]) => c === cod) || [])[1] || cod || "Perfeita";

// Canais REAIS de venda (≠ CANAIS de export.js, que dirige o diagnóstico de anúncio).
export const CANAIS_VENDA = [
  "Mercado Livre", "Amazon", "TikTok Shop", "Hiper",
  "Parceiro", "B2C / Venda direta", "Grupo WhatsApp",
];

// SKU = NOG-<lote3|SL>-<seq3>. Itens criados sem lote usam o prefixo SL (lote=null);
// ao definir o lote depois, o SKU é regenerado para NOG-<lote3>-<seq3>.
export const PREFIXO_SL = "SL";
export const pad3 = (n) => String(n).padStart(3, "0");
export const buildSku = (lote, seq) =>
  `NOG-${lote == null || lote === "" ? PREFIXO_SL : pad3(lote)}-${pad3(seq)}`;
// Valor sentinela usado nos selects/filtros para representar "itens sem lote".
export const LOTE_SEM = "__sem__";

// Campos para integrações (Amazon / Mercado Livre / TikTok Shop / Hiper ERP)
export const VOLTAGENS = ["110V", "220V", "Bivolt", "N/A"];
export const CONDICOES_ANUNCIO = ["Novo", "Usado", "Recondicionado"];

// Valida dígito verificador de EAN-13 / EAN-8 / UPC-A(12) / GTIN-14.
export const validarEAN = (code) => {
  const s = String(code ?? "").trim();
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(s)) return false;
  const d = s.split("").map(Number);
  const check = d.pop();
  const sum = d.reverse().reduce((acc, n, i) => acc + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
};

export const fmtBRL = (v) =>
  v == null || v === "" || isNaN(v)
    ? "—"
    : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export const fmtKg = (v) =>
  v == null || v === "" || isNaN(v)
    ? "—"
    : `${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`;

export const triBool = (v) => (v === true ? "Sim" : v === false ? "Não" : "—");
