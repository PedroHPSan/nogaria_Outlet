// Planilha de produtos: catálogo de colunas + regras de leitura, edição,
// ordenação e exportação. Módulo PURO (sem supabase, sem React) para a tela
// `PlanilhaScreen` consumir e os testes rodarem no Node.
//
// Ideia: em vez de espalhar `it.campo` por outra tela, cada coluna se descreve
// (rótulo, grupo, tipo, largura no Excel, se é editável e como vira patch).
// A tela renderiza a partir daí, o export do .xlsx sai da MESMA definição — o
// que aparece na tela é exatamente o que vai para o Excel.
import {
  ALL_STATUS, statusMeta, ESTADOS, DESTINOS, EMBALAGENS,
  CANAIS_VENDA, VOLTAGENS, CONDICOES_ANUNCIO,
} from "./model.js";
import { CANAIS } from "./export.js";
import { ESTILO } from "./xlsx.js";

export const CLASSES = ["A+", "A", "B", "C", "D", "E"];
// Espelha MEDIDAS_FONTE de lib/medidas.js — replicado aqui porque aquele módulo
// importa o cliente supabase e este precisa continuar puro (testável no Node).
export const MEDIDAS_FONTE_OPCOES = [
  ["MEDIDO", "Medido"], ["ESTIMADO", "Estimado"], ["A_MEDIR", "A medir"],
];

// Helper: lista simples de strings → opções {v, label}.
const ops = (arr) => arr.map((v) => ({ v, label: v }));
const opsPares = (pares) => pares.map(([v, label]) => ({ v, label }));

// --- Conversões -------------------------------------------------------------

// Número digitado pelo operador: aceita "1.234,56" (pt-BR) e "1234.56".
export const parseNumero = (txt) => {
  if (txt === null || txt === undefined) return null;
  const s = String(txt).trim();
  if (!s) return null;
  // Com vírgula, o ponto é separador de milhar; sem vírgula, o ponto é decimal.
  const limpo = (s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s).replace(/[^\d.-]/g, "");
  if (!/\d/.test(limpo)) return null; // "abc" não é zero, é "não informado"
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
};

// "Sim"/"Não"/"" → true/false/null (o banco guarda booleano de 3 estados).
export const parseBool = (txt) => (txt === "true" ? true : txt === "false" ? false : null);
export const boolTexto = (v) => (v === true ? "Sim" : v === false ? "Não" : "");

// ISO → Date (para o Excel formatar como data de verdade, não como texto).
const paraData = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

const listaTexto = (v) => {
  if (!Array.isArray(v)) return v ? String(v) : "";
  return v
    .map((x) => (x && typeof x === "object" ? `${x.atributo ?? x.k ?? ""}: ${x.valor ?? x.val ?? ""}` : String(x)))
    .filter(Boolean)
    .join(" | ");
};

// --- Catálogo de colunas ----------------------------------------------------
//
// tipo: texto | texto_longo | inteiro | decimal | moeda | bool | select | data | lista
// fixa: sempre visível (SKU identifica a linha; Produto é o link para a ficha)
// editavel: dá para alterar direto na planilha
// opcoesDe: "grupos" → opções carregadas em runtime (categorias do motor de preço)

const COL = (c) => ({ tipo: "texto", editavel: false, largura: 18, get: (it) => it[c.key], ...c });

export const COLUNAS_PLANILHA = [
  // Identificação
  COL({ key: "sku", header: "SKU", grupo: "Identificação", largura: 16, fixa: true }),
  COL({ key: "produto", header: "Produto", grupo: "Identificação", largura: 42, fixa: true, editavel: true }),
  COL({ key: "marca", header: "Marca", grupo: "Identificação", largura: 18, editavel: true }),
  COL({ key: "modelo", header: "Modelo", grupo: "Identificação", largura: 20, editavel: true }),
  COL({ key: "gtin", header: "GTIN/EAN", grupo: "Identificação", largura: 16, editavel: true }),
  COL({ key: "ncm", header: "NCM", grupo: "Identificação", largura: 12, editavel: true }),
  COL({ key: "num_serie", header: "Nº de série", grupo: "Identificação", largura: 18, editavel: true }),
  COL({ key: "lote", header: "Lote", grupo: "Identificação", tipo: "inteiro", largura: 8 }),
  COL({ key: "quantidade", header: "Estoque", grupo: "Identificação", tipo: "inteiro", largura: 9, editavel: true }),

  // Classificação
  COL({ key: "grupo", header: "Categoria", grupo: "Classificação", largura: 24, editavel: true, opcoesDe: "grupos" }),
  COL({ key: "classe", header: "Classe", grupo: "Classificação", tipo: "select", largura: 9, editavel: true, opcoes: ops(CLASSES) }),
  COL({ key: "estado", header: "Estado", grupo: "Classificação", tipo: "select", largura: 22, editavel: true, opcoes: ops(ESTADOS) }),
  COL({ key: "cond_embalagem", header: "Embalagem", grupo: "Classificação", tipo: "select", largura: 18, editavel: true, opcoes: opsPares(EMBALAGENS) }),
  COL({ key: "condicao_anuncio", header: "Condição do anúncio", grupo: "Classificação", tipo: "select", largura: 18, editavel: true, opcoes: ops(CONDICOES_ANUNCIO) }),
  COL({ key: "testado", header: "Testado", grupo: "Classificação", tipo: "bool", largura: 10, editavel: true }),
  COL({ key: "funciona", header: "Funciona", grupo: "Classificação", tipo: "bool", largura: 10, editavel: true }),
  COL({ key: "avaria", header: "Avaria", grupo: "Classificação", tipo: "texto_longo", largura: 30, editavel: true }),
  COL({ key: "acessorios_ok", header: "Acessórios completos", grupo: "Classificação", tipo: "bool", largura: 12, editavel: true }),
  COL({ key: "caixa_original", header: "Caixa original", grupo: "Classificação", tipo: "bool", largura: 12, editavel: true }),

  // Atributos
  COL({ key: "cor", header: "Cor", grupo: "Atributos", largura: 14, editavel: true }),
  COL({ key: "tamanho", header: "Tamanho", grupo: "Atributos", largura: 12, editavel: true }),
  COL({ key: "voltagem", header: "Voltagem", grupo: "Atributos", tipo: "select", largura: 12, editavel: true, opcoes: ops(VOLTAGENS) }),

  // Anúncio
  COL({ key: "titulo_anuncio", header: "Título do anúncio", grupo: "Anúncio", largura: 44, editavel: true }),
  COL({ key: "descricao_anuncio", header: "Descrição do anúncio", grupo: "Anúncio", tipo: "texto_longo", largura: 50, editavel: true }),
  COL({ key: "palavras_chave", header: "Palavras-chave", grupo: "Anúncio", tipo: "texto_longo", largura: 34, editavel: true }),
  COL({ key: "bullet_points", header: "Bullet points", grupo: "Anúncio", tipo: "lista", largura: 50 }),
  COL({ key: "ficha_tecnica", header: "Ficha técnica", grupo: "Anúncio", tipo: "lista", largura: 50 }),
  COL({ key: "canal_principal", header: "Canal sugerido", grupo: "Anúncio", tipo: "select", largura: 18, editavel: true, opcoes: ops(CANAIS) }),
  COL({ key: "foto_feita", header: "Tem foto", grupo: "Anúncio", tipo: "bool", largura: 10 }),
  COL({ key: "anuncio_feito", header: "Anunciado", grupo: "Anúncio", tipo: "bool", largura: 10 }),

  // Preço
  COL({ key: "preco_ideal", header: "Preço de venda", grupo: "Preço", tipo: "moeda", largura: 15, editavel: true }),
  COL({ key: "preco_min", header: "Preço mínimo", grupo: "Preço", tipo: "moeda", largura: 15, editavel: true }),
  COL({ key: "preco_sugerido", header: "Preço sugerido", grupo: "Preço", tipo: "moeda", largura: 15 }),
  COL({ key: "preco_ref_novo", header: "Ref. novo", grupo: "Preço", tipo: "moeda", largura: 14 }),
  COL({ key: "preco_ref_usado", header: "Ref. usado", grupo: "Preço", tipo: "moeda", largura: 14 }),
  COL({ key: "preco_ref_fonte", header: "Fonte da referência", grupo: "Preço", largura: 16 }),
  COL({ key: "preco_ref_confianca", header: "Confiança da referência", grupo: "Preço", largura: 14 }),

  // Venda
  COL({ key: "valor_vendido", header: "Valor vendido", grupo: "Venda", tipo: "moeda", largura: 15, editavel: true }),
  COL({ key: "canal_venda", header: "Canal da venda", grupo: "Venda", tipo: "select", largura: 18, editavel: true, opcoes: ops(CANAIS_VENDA) }),
  COL({ key: "taxa_venda", header: "Taxa do canal", grupo: "Venda", tipo: "moeda", largura: 14, editavel: true }),
  COL({ key: "frete_pago", header: "Frete pago", grupo: "Venda", tipo: "moeda", largura: 14, editavel: true }),
  COL({ key: "comprador", header: "Comprador", grupo: "Venda", largura: 22, editavel: true }),
  COL({ key: "pedido_ref", header: "Nº do pedido", grupo: "Venda", largura: 18, editavel: true }),
  COL({ key: "vendido_em", header: "Vendido em", grupo: "Venda", tipo: "data", largura: 18 }),
  COL({ key: "entregue_em", header: "Entregue em", grupo: "Venda", tipo: "data", largura: 18 }),

  // Medidas
  COL({ key: "comprimento_cm", header: "Comprimento (cm)", grupo: "Medidas", tipo: "decimal", largura: 13, editavel: true }),
  COL({ key: "largura_cm", header: "Largura (cm)", grupo: "Medidas", tipo: "decimal", largura: 13, editavel: true }),
  COL({ key: "altura_cm", header: "Altura (cm)", grupo: "Medidas", tipo: "decimal", largura: 13, editavel: true }),
  COL({
    key: "peso_real_kg", header: "Peso (kg)", grupo: "Medidas", tipo: "decimal", largura: 12, editavel: true,
    // peso_kg é o valor legado da planilha-mãe; peso_real_kg é o pesado na bancada.
    get: (it) => it.peso_real_kg ?? it.peso_kg,
  }),
  COL({ key: "medidas_fonte", header: "Origem da medida", grupo: "Medidas", tipo: "select", largura: 15, editavel: true, opcoes: opsPares(MEDIDAS_FONTE_OPCOES) }),

  // Fluxo & logística
  COL({ key: "status", header: "Status", grupo: "Fluxo", tipo: "select", largura: 18, editavel: true, opcoes: ALL_STATUS.map((s) => ({ v: s.id, label: s.label })) }),
  COL({ key: "destino", header: "Destino", grupo: "Fluxo", tipo: "select", largura: 18, editavel: true, opcoes: ops(DESTINOS) }),
  COL({ key: "sala_id", header: "Sala", grupo: "Fluxo", largura: 12 }),
  COL({ key: "caixa_id", header: "Caixa", grupo: "Fluxo", largura: 14 }),
  COL({ key: "caixa_num", header: "Caixa (texto legado)", grupo: "Fluxo", largura: 16, editavel: true }),
  COL({ key: "local_fisico", header: "Local físico", grupo: "Fluxo", largura: 20, editavel: true }),
  COL({ key: "etiqueta_impressa", header: "Etiqueta impressa", grupo: "Fluxo", tipo: "bool", largura: 12 }),
  COL({ key: "conferido_em", header: "Conferido em", grupo: "Fluxo", tipo: "data", largura: 18 }),

  // Observações & auditoria
  COL({ key: "obs", header: "Observações", grupo: "Auditoria", tipo: "texto_longo", largura: 40, editavel: true }),
  COL({ key: "upd_by", header: "Alterado por", grupo: "Auditoria", largura: 22 }),
];

export const GRUPOS_COLUNAS = [...new Set(COLUNAS_PLANILHA.map((c) => c.grupo))];
export const coluna = (key) => COLUNAS_PLANILHA.find((c) => c.key === key) || null;
export const COLUNAS_FIXAS = COLUNAS_PLANILHA.filter((c) => c.fixa).map((c) => c.key);

// Conjunto inicial: o que o operador olha no dia a dia (cabe numa rolagem curta).
// (na ordem do catálogo — é a ordem em que a grade e o Excel saem)
export const COLUNAS_PADRAO = [
  "sku", "produto", "marca", "modelo", "quantidade",
  "grupo", "classe", "estado", "preco_ideal",
  "status", "destino", "caixa_id",
];

// Mantém só chaves existentes, garante as fixas e devolve NA ORDEM DO CATÁLOGO
// (a planilha não muda de layout conforme a ordem em que o operador clicou).
export const normalizarVisiveis = (keys) => {
  const base = Array.isArray(keys) && keys.length ? keys : COLUNAS_PADRAO;
  const pedidas = new Set([...base, ...COLUNAS_FIXAS]);
  return COLUNAS_PLANILHA.filter((c) => pedidas.has(c.key)).map((c) => c.key);
};

export const colunasVisiveis = (keys) => normalizarVisiveis(keys).map(coluna);

// --- Leitura ----------------------------------------------------------------

// Valor bruto (para ordenar e para decidir o tipo no Excel).
export const valorBruto = (col, it) => {
  const v = col.get(it);
  return v === undefined ? null : v;
};

// Valor para a célula do Excel: número onde é número, Date onde é data, texto no resto.
export const valorExcel = (col, it) => {
  const v = valorBruto(col, it);
  if (v === null || v === "") return null;
  switch (col.tipo) {
    case "moeda":
    case "decimal":
    case "inteiro": {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    case "bool": return boolTexto(v) || null;
    case "data": return paraData(v);
    case "lista": return listaTexto(v) || null;
    case "select": return (col.opcoes.find((o) => o.v === v) || {}).label || String(v);
    default: return String(v);
  }
};

// Texto exibido na célula da tela ("—" quando vazio, para a grade não “sumir”).
export const valorTexto = (col, it) => {
  const v = valorBruto(col, it);
  if (v === null || v === "") return "—";
  switch (col.tipo) {
    case "moeda": {
      const n = Number(v);
      return Number.isFinite(n) ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";
    }
    case "decimal": {
      const n = Number(v);
      return Number.isFinite(n) ? n.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—";
    }
    case "bool": return boolTexto(v) || "—";
    case "data": {
      const d = paraData(v);
      return d ? d.toLocaleDateString("pt-BR") : "—";
    }
    case "lista": return listaTexto(v) || "—";
    case "select": return col.key === "status" ? statusMeta(v).label : (col.opcoes.find((o) => o.v === v) || {}).label || String(v);
    default: return String(v);
  }
};

// Valor que vai para o campo de edição (string no <input>/<select>).
export const valorEdicao = (col, it) => {
  const v = valorBruto(col, it);
  if (v === null || v === undefined) return "";
  if (col.tipo === "bool") return v === true ? "true" : v === false ? "false" : "";
  return String(v);
};

// Estilo da coluna no .xlsx a partir do tipo.
export const estiloExcel = (col) =>
  col.tipo === "moeda" ? ESTILO.MOEDA
    : col.tipo === "decimal" ? ESTILO.DECIMAL
      : col.tipo === "inteiro" ? ESTILO.INTEIRO
        : col.tipo === "data" ? ESTILO.DATA
          : ESTILO.GERAL;

// --- Edição -----------------------------------------------------------------

// Converte o texto do campo no patch a gravar em `itens`.
// Retorna { patch } ou { erro } — a tela mostra o erro e não grava.
export const montarPatch = (col, texto) => {
  if (!col.editavel) return { erro: "Coluna somente leitura." };
  const t = typeof texto === "string" ? texto.trim() : texto;

  if (col.tipo === "bool") return { patch: { [col.key]: parseBool(t) } };

  if (col.tipo === "inteiro" || col.tipo === "decimal" || col.tipo === "moeda") {
    if (t === "" || t === null) return { patch: { [col.key]: null } };
    const n = parseNumero(t);
    if (n === null) return { erro: "Valor numérico inválido." };
    if (n < 0) return { erro: "O valor não pode ser negativo." };
    return { patch: { [col.key]: col.tipo === "inteiro" ? Math.round(n) : n } };
  }

  if (col.tipo === "select") {
    if (t === "") return { patch: { [col.key]: null } };
    if (!col.opcoes.some((o) => o.v === t)) return { erro: "Opção inválida." };
    return { patch: { [col.key]: t } };
  }

  // Texto. `produto` é NOT NULL no banco: em branco mantém o nome atual.
  if (col.key === "produto" && !t) return { patch: {}, aviso: "O nome do produto não pode ficar vazio." };
  return { patch: { [col.key]: t || null } };
};

// --- Filtro, ordenação e export ---------------------------------------------

const CAMPOS_BUSCA = ["sku", "produto", "titulo_anuncio", "marca", "modelo", "gtin", "caixa_id", "num_serie"];

export const filtrarPorTexto = (itens, q) => {
  const t = String(q || "").trim().toLowerCase();
  if (!t) return itens;
  return itens.filter((it) => CAMPOS_BUSCA.some((k) => String(it[k] ?? "").toLowerCase().includes(t)));
};

// Ordena por coluna. Vazios sempre no fim (nos dois sentidos) — buraco no fim
// é mais útil que buraco no topo quando se está conferindo dados.
export const ordenarItens = (itens, col, dir = "asc") => {
  if (!col) return itens;
  const sinal = dir === "desc" ? -1 : 1;
  const num = ["moeda", "decimal", "inteiro"].includes(col.tipo);
  return [...itens].sort((a, b) => {
    const va = valorBruto(col, a), vb = valorBruto(col, b);
    const ea = va === null || va === undefined || va === "";
    const eb = vb === null || vb === undefined || vb === "";
    if (ea && eb) return 0;
    if (ea) return 1;
    if (eb) return -1;
    if (num) return (Number(va) - Number(vb)) * sinal;
    if (col.tipo === "data") return (new Date(va) - new Date(vb)) * sinal;
    if (col.tipo === "bool") return ((va === true ? 1 : 0) - (vb === true ? 1 : 0)) * sinal;
    return String(valorTexto(col, a)).localeCompare(String(valorTexto(col, b)), "pt-BR") * sinal;
  });
};

// Colunas + linhas prontas para gerarXlsx().
export const montarPlanilha = (itens, cols) => ({
  colunas: cols.map((c) => ({ header: c.header, largura: c.largura, estilo: estiloExcel(c) })),
  linhas: itens.map((it) => cols.map((c) => valorExcel(c, it))),
});

// nogaria-produtos-lote12-pronto-2026-09-02.xlsx
export const nomeArquivo = (filtros = {}, hoje = new Date()) => {
  const partes = ["nogaria-produtos"];
  if (filtros.lote) partes.push(`lote${filtros.lote}`);
  if (filtros.status) partes.push(String(filtros.status).toLowerCase());
  if (filtros.grupo) partes.push(String(filtros.grupo).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  partes.push(hoje.toISOString().slice(0, 10));
  return `${partes.join("-")}.xlsx`;
};
