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
];
export const STATUS_DESCARTE = { id: "DESCARTE", label: "Descarte / Sucata", short: "Descarte", color: "bg-red-200 text-red-900" };
export const ALL_STATUS = [...STATUS_FLOW, STATUS_DESCARTE];
export const statusIdx = (id) => STATUS_FLOW.findIndex((s) => s.id === id);
export const statusMeta = (id) => ALL_STATUS.find((s) => s.id === id) || STATUS_FLOW[0];

export const CLASSE_STYLE = {
  "A+": "bg-purple-600 text-white",
  A: "bg-blue-600 text-white",
  B: "bg-teal-600 text-white",
  C: "bg-gray-400 text-white",
  D: "bg-amber-600 text-white",
  E: "bg-red-600 text-white",
};

export const ESTADOS = ["Novo", "Usado funcionando", "Usado sem teste", "Avariado", "Incompleto", "Sucata"];
export const DESTINOS = ["Belém", "SP storage", "Venda local SP", "A definir"];

export const fmtBRL = (v) =>
  v == null || v === "" || isNaN(v)
    ? "—"
    : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export const triBool = (v) => (v === true ? "Sim" : v === false ? "Não" : "—");
