// Gerador de arquivo Excel (.xlsx) sem dependências.
//
// Por que escrever à mão em vez de usar uma lib (SheetJS & cia.): o app roda 100%
// no navegador e o bundle já carrega jsPDF/qrcode/zxing. Uma planilha é só um ZIP
// com uns poucos XMLs (OOXML/SpreadsheetML) — dá para montar em ~200 linhas e sai
// um .xlsx de verdade (abre no Excel, Google Sheets e LibreOffice), com cabeçalho
// congelado, filtro automático, largura de coluna e formato de moeda/data.
//
// Os arquivos entram no ZIP SEM compressão (método "store"): o Excel aceita, e
// evita depender de zlib/CompressionStream (que não existe em todo navegador).
// A saída é determinística (data fixa no header ZIP), então dá para testá-la.

// --- ZIP (store) ------------------------------------------------------------

const CRC_TABELA = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

const crc32 = (bytes) => {
  let c = -1;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABELA[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

// Buffer de escrita incremental (little-endian, como o ZIP exige).
const criarBuffer = () => {
  const partes = [];
  let n = 0;
  const push = (b) => { partes.push(b); n += b.length; };
  return {
    bytes: (b) => push(b),
    u16: (v) => push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff])),
    u32: (v) => push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff])),
    get tamanho() { return n; },
    final() {
      const out = new Uint8Array(n);
      let off = 0;
      for (const p of partes) { out.set(p, off); off += p.length; }
      return out;
    },
  };
};

const texto = (s) => new TextEncoder().encode(s);
// Data/hora fixa no header (1980-01-01): saída byte a byte determinística.
const DOS_HORA = 0;
const DOS_DATA = (1 << 5) | 1;

// Monta o ZIP a partir de [{ nome, dados: Uint8Array }].
export const zipar = (arquivos) => {
  const buf = criarBuffer();
  const centrais = [];
  for (const arq of arquivos) {
    const nome = texto(arq.nome);
    const crc = crc32(arq.dados);
    const offset = buf.tamanho;
    buf.bytes(texto("PK\x03\x04"));
    buf.u16(20); buf.u16(0x0800); buf.u16(0); // versão, flag UTF-8, método store
    buf.u16(DOS_HORA); buf.u16(DOS_DATA);
    buf.u32(crc); buf.u32(arq.dados.length); buf.u32(arq.dados.length);
    buf.u16(nome.length); buf.u16(0);
    buf.bytes(nome);
    buf.bytes(arq.dados);
    centrais.push({ nome, crc, tam: arq.dados.length, offset });
  }
  const inicioCentral = buf.tamanho;
  for (const c of centrais) {
    buf.bytes(texto("PK\x01\x02"));
    buf.u16(20); buf.u16(20); buf.u16(0x0800); buf.u16(0);
    buf.u16(DOS_HORA); buf.u16(DOS_DATA);
    buf.u32(c.crc); buf.u32(c.tam); buf.u32(c.tam);
    buf.u16(c.nome.length); buf.u16(0); buf.u16(0); // nome, extra, comentário
    buf.u16(0); buf.u16(0); buf.u32(0);             // disco, attr interno, attr externo
    buf.u32(c.offset);
    buf.bytes(c.nome);
  }
  const tamCentral = buf.tamanho - inicioCentral;
  buf.bytes(texto("PK\x05\x06"));
  buf.u16(0); buf.u16(0);
  buf.u16(centrais.length); buf.u16(centrais.length);
  buf.u32(tamCentral); buf.u32(inicioCentral); buf.u16(0);
  return buf.final();
};

// --- XML --------------------------------------------------------------------

// Escapa texto para XML e remove caracteres de controle (o Excel recusa o arquivo
// se um \x00..\x1F que não seja tab/quebra de linha aparecer no conteúdo).
export const escaparXml = (v) =>
  String(v ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// Índice 0 → "A", 25 → "Z", 26 → "AA".
export const colunaLetra = (i) => {
  let n = i + 1, s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

// Estilos declarados em styles.xml, na ordem de <cellXfs>.
export const ESTILO = { GERAL: 0, CABECALHO: 1, MOEDA: 2, DECIMAL: 3, INTEIRO: 4, DATA: 5 };

// Data → número de série do Excel (dias desde 1899-12-30), no fuso local.
const serieData = (d) => (d.getTime() - d.getTimezoneOffset() * 60000) / 86400000 + 25569;

// O Excel limita o nome da aba a 31 caracteres e proíbe [ ] : * ? / \.
const nomeAba = (s) => (String(s || "Planilha").replace(/[[\]:*?/\\]/g, " ").trim() || "Planilha").slice(0, 31);

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const CONTENT_TYPES = `${XML_DECL}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const RELS_RAIZ = `${XML_DECL}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const RELS_WORKBOOK = `${XML_DECL}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`;

// Moeda em R$, decimal com 2 casas e data curta pt-BR.
const STYLES = `${XML_DECL}
<styleSheet xmlns="${NS}"><numFmts count="3"><numFmt numFmtId="164" formatCode="&quot;R$&quot;\\ #,##0.00"/><numFmt numFmtId="165" formatCode="0.00"/><numFmt numFmtId="166" formatCode="dd/mm/yyyy\\ hh:mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F2937"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0"/></styleSheet>`;

// Uma célula. Texto vai como inlineStr (dispensa a tabela de strings compartilhadas).
const celula = (ref, valor, estilo) => {
  const s = estilo ? ` s="${estilo}"` : "";
  if (valor === null || valor === undefined || valor === "") return "";
  if (valor instanceof Date)
    return `<c r="${ref}" s="${estilo || ESTILO.DATA}"><v>${serieData(valor)}</v></c>`;
  if (typeof valor === "number" && Number.isFinite(valor))
    return `<c r="${ref}"${s}><v>${valor}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escaparXml(valor)}</t></is></c>`;
};

/**
 * Gera os bytes de um .xlsx de uma aba.
 * @param {object} p
 * @param {string} p.aba            nome da aba (máx. 31 caracteres)
 * @param {Array}  p.colunas        [{ header, largura?, estilo? }]
 * @param {Array}  p.linhas         matriz de valores (string | number | Date | null)
 * @returns {Uint8Array}
 */
export const gerarXlsx = ({ aba = "Produtos", colunas = [], linhas = [] }) => {
  const nCols = Math.max(colunas.length, 1);
  const ultimaCol = colunaLetra(nCols - 1);
  const ultimaLinha = linhas.length + 1;

  const cols = colunas
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.largura || 16}" customWidth="1"/>`)
    .join("");

  const cabecalho =
    `<row r="1" ht="22" customHeight="1">` +
    colunas.map((c, i) => celula(`${colunaLetra(i)}1`, c.header, ESTILO.CABECALHO)).join("") +
    `</row>`;

  const corpo = linhas
    .map((linha, li) => {
      const r = li + 2;
      const cels = colunas
        .map((c, ci) => celula(`${colunaLetra(ci)}${r}`, linha[ci], c.estilo || ESTILO.GERAL))
        .join("");
      return `<row r="${r}">${cels}</row>`;
    })
    .join("");

  const sheet = `${XML_DECL}
<worksheet xmlns="${NS}"><dimension ref="A1:${ultimaCol}${ultimaLinha}"/><sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${cabecalho}${corpo}</sheetData><autoFilter ref="A1:${ultimaCol}${ultimaLinha}"/></worksheet>`;

  const workbook = `${XML_DECL}
<workbook xmlns="${NS}" xmlns:r="${NS_REL}"><sheets><sheet name="${escaparXml(nomeAba(aba))}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  return zipar([
    { nome: "[Content_Types].xml", dados: texto(CONTENT_TYPES) },
    { nome: "_rels/.rels", dados: texto(RELS_RAIZ) },
    { nome: "xl/workbook.xml", dados: texto(workbook) },
    { nome: "xl/_rels/workbook.xml.rels", dados: texto(RELS_WORKBOOK) },
    { nome: "xl/styles.xml", dados: texto(STYLES) },
    { nome: "xl/worksheets/sheet1.xml", dados: texto(sheet) },
  ]);
};

export const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Dispara o download do .xlsx no navegador.
export const baixarXlsx = (nome, bytes) => {
  const url = URL.createObjectURL(new Blob([bytes], { type: MIME_XLSX }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome.endsWith(".xlsx") ? nome : `${nome}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
