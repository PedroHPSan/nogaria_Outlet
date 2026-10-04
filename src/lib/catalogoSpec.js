// Especificação declarativa do catálogo (PURO, serializável em jsonb).
// O mesmo CatalogoSpec alimenta a prévia e o arquivo final. Valores fora do
// domínio caem no padrão (normalizarSpec nunca lança): predefinições antigas
// continuam abrindo mesmo depois que o schema evoluir.
import { EMPRESA } from "./empresa.js";

export const MODELOS = [
  { id: "catalogo", nome: "Catálogo (grade com fotos)" },
  { id: "lista", nome: "Lista de preços (compacta)" },
];

// Paleta do manual de marca (docs/Logos Nogaria/Paleta de Cores.png).
export const TEMAS = {
  noite: { nome: "Azul-noite", capa: "#0b162d", forte: "#02477e", acento: "#52ff7f", sobAcento: "#0b162d", tinta: "#0b162d" },
  azul: { nome: "Azul", capa: "#02477e", forte: "#02477e", acento: "#2ebdee", sobAcento: "#0b162d", tinta: "#0b162d" },
  claro: { nome: "Claro", capa: "#ffffff", forte: "#02477e", acento: "#4ccc6a", sobAcento: "#0b162d", tinta: "#0b162d" },
};

export const AGRUPAMENTOS = ["categoria", "marca", "tamanho", "lote"];
export const ORDENS = ["preco_desc", "preco_asc", "sku", "nome"];

const CAMPOS_PADRAO = {
  foto: true, preco: true, de: false, sku: true, qr: true, condicao: true, marcaModelo: true, qtd: true,
};

export const specPadrao = (modelo = "catalogo") => ({
  v: 1,
  modelo,
  tema: "noite",
  colunas: 2,
  capa: true,
  fechamento: true,
  campos: { ...CAMPOS_PADRAO, foto: modelo !== "lista" },
  titulo: "Catálogo Nogária Outlet",
  subtitulo: "",
  edicao: "",
  validade: "",
  mensagem: "",
  agrupar: "categoria",
  ordem: "preco_desc",
  contato: {
    nome: "",
    whatsapp: EMPRESA.whatsapp,
    whatsappLabel: EMPRESA.whatsappLabel,
    extras: [], // [{ rotulo, valor }] — Instagram, site, e-mail, endereço…
  },
});

const em = (v, dominio, padrao) => (dominio.includes(v) ? v : padrao);
const txt = (v, padrao = "", max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : padrao);

export function normalizarSpec(entrada = {}) {
  const modelo = MODELOS.some((m) => m.id === entrada.modelo) ? entrada.modelo : "catalogo";
  const base = specPadrao(modelo);
  const c = entrada.contato || {};
  const campos = {};
  for (const k of Object.keys(CAMPOS_PADRAO)) {
    campos[k] = typeof entrada.campos?.[k] === "boolean" ? entrada.campos[k] : base.campos[k];
  }
  const extras = (Array.isArray(c.extras) ? c.extras : [])
    .map((e) => ({ rotulo: txt(e?.rotulo, "", 30), valor: txt(e?.valor, "", 80) }))
    .filter((e) => e.rotulo && e.valor)
    .slice(0, 6);
  const digitos = String(c.whatsapp ?? base.contato.whatsapp).replace(/\D/g, "");
  return {
    v: 1,
    modelo,
    tema: em(entrada.tema, Object.keys(TEMAS), base.tema),
    colunas: [2, 3].includes(Number(entrada.colunas)) ? Number(entrada.colunas) : base.colunas,
    capa: entrada.capa !== false,
    fechamento: entrada.fechamento !== false,
    campos,
    titulo: txt(entrada.titulo, base.titulo, 80) || base.titulo,
    subtitulo: txt(entrada.subtitulo, "", 120),
    edicao: txt(entrada.edicao, "", 40),
    validade: txt(entrada.validade, "", 40),
    mensagem: txt(entrada.mensagem, "", 240),
    agrupar: em(entrada.agrupar, AGRUPAMENTOS, base.agrupar),
    ordem: em(entrada.ordem, ORDENS, base.ordem),
    contato: {
      nome: txt(c.nome, "", 60),
      // wa.me exige DDI+DDD+número: menos de 12 dígitos volta ao WhatsApp da empresa.
      whatsapp: digitos.length >= 12 ? digitos : base.contato.whatsapp,
      whatsappLabel: txt(c.whatsappLabel, "", 30) || (digitos.length >= 12 ? `+${digitos}` : base.contato.whatsappLabel),
      extras,
    },
  };
}
