// Domínio de etiquetas térmicas (Brother QL-800) do NOGÁRIA OUTLET.
// Sem UI: monta o "modelo de dados de etiqueta" usado tanto pela renderização HTML
// (LabelCard / impressão via navegador) quanto pela geração de PDF (labelPdf.js).
import QRCode from "qrcode";

// Rolos DK compatíveis com a Brother QL-800. Dimensões em milímetros.
// width = largura visual da etiqueta; height = comprimento (sentido de avanço do papel).
// `compact` define o layout estreito (rolos de 29 mm) vs. completo (62 mm+).
export const MEDIA_PRESETS = [
  {
    id: "DK-11201",
    label: 'DK-11201 — 29 × 90 mm (endereço)',
    width: 29,
    height: 90,
    compact: true,
    continuous: false,
    note: "Rolo recortado que você tem em mãos. Layout compacto (vertical).",
  },
  {
    id: "DK-11202",
    label: "DK-11202 — 62 × 100 mm (envio)",
    width: 62,
    height: 100,
    compact: false,
    continuous: false,
    note: "Etiqueta de envio recortada. Layout completo.",
  },
  {
    id: "DK-22205",
    label: "DK-22205 — 62 mm contínuo (corte 50 mm)",
    width: 62,
    height: 50,
    compact: false,
    continuous: true,
    note: "Rolo contínuo de 62 mm; comprimento de corte ajustável. Layout completo.",
  },
  {
    id: "CUSTOM-100x50",
    label: "100 × 50 mm (recomendado no guia)",
    width: 100,
    height: 50,
    compact: false,
    continuous: true,
    note: "Tamanho do guia. A QL-800 imprime no máx. 62 mm de largura — confira sua mídia.",
  },
];

export const DEFAULT_MEDIA_ID = "DK-11201";

export const getPreset = (id) =>
  MEDIA_PRESETS.find((m) => m.id === id) || MEDIA_PRESETS[0];

// Mapeia o item para o código de estado da operação (cores do guia, impressas em preto).
// Prioridade: sucata > avaria > quarentena (sem teste) > novo > usado.
// Estados atuais (model.js): Novo · Embalagem aberta/avariada · Usado · Avariado ·
// Usado sem teste. Mantém também os legados (Usado funcionando · Incompleto · Sucata).
export function estadoEtiqueta(item) {
  const estado = item?.estado || "";
  const status = item?.status || "";
  if (status === "DESCARTE" || estado === "Sucata")
    return { codigo: "VERMELHO", texto: "VERMELHO · Sucata / peças" };
  if (estado === "Avariado" || estado === "Incompleto" || item?.avaria === true)
    return { codigo: "AMARELO", texto: "AMARELO · Avaria / falta item" };
  if (estado === "Usado sem teste")
    return { codigo: "QRT", texto: "QRT · Quarentena — testar" };
  if (estado === "Novo" || estado === "Embalagem aberta/avariada")
    return { codigo: "VERDE", texto: "VERDE · Novo / excelente" };
  if (estado === "Usado" || estado === "Usado funcionando")
    return { codigo: "AZUL", texto: "AZUL · Funcionando" };
  // Sem estado ainda (item não triado): a catalogar.
  if (!estado)
    return { codigo: "QRT", texto: "QRT · A catalogar" };
  // Estado já definido mas não reconhecido: trata como quarentena (testar),
  // nunca como "a catalogar" — o item já passou pela triagem.
  return { codigo: "QRT", texto: "QRT · Quarentena — testar" };
}

// Tipos que exigem atenção usam o modelo "Quarentena/Avaria".
const TIPO_ATENCAO = new Set(["QRT", "AMARELO", "VERMELHO"]);

const CHECKBOXES = ["TEST OK", "FOTO", "ANUNC", "VEND"];

// QR conteúdo: codifica o SKU (ou caixa_num) para reconciliar com a planilha
// e ser lido pelo scanner @zxing do próprio app.
export async function genQrDataUrl(text) {
  if (!text) return null;
  try {
    return await QRCode.toDataURL(String(text), {
      margin: 0,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
      width: 256,
    });
  } catch {
    return null;
  }
}

// Etiqueta de PRODUTO (ou Quarentena/Avaria, conforme o estado).
// Sem preços: a etiqueta só apoia triagem e anúncio; a precificação é outra fase.
export function buildProductLabel(item) {
  const estado = estadoEtiqueta(item);
  const atencao = TIPO_ATENCAO.has(estado.codigo);
  return {
    tipo: atencao ? "QRT" : "PRODUTO",
    titulo: atencao
      ? "NOGÁRIA OUTLET · QUARENTENA / AVARIA"
      : "NOGÁRIA OUTLET · ETIQUETA DE PRODUTO",
    sku: item?.sku || "",
    lote: item?.lote ?? "",
    classe: item?.classe || "",
    caixa_num: item?.caixa_num || "—",
    local_fisico: item?.local_fisico || "—",
    produto: [item?.produto, item?.marca, item?.modelo]
      .filter(Boolean)
      .join(" · "),
    estadoTexto: estado.texto,
    estadoCodigo: estado.codigo,
    destino: item?.destino || "—",
    aviso: atencao ? "NÃO ANUNCIAR ANTES DE TESTAR" : null,
    checkboxes: CHECKBOXES,
    qrText: item?.sku || "",
    qrData: null, // preenchido depois por genQrDataUrl
  };
}

const norm = (s) => String(s || "").trim().toUpperCase();

// Etiqueta de CAIXA ou MALA: agrega os itens de um mesmo caixa_num.
export function buildBoxLabel(caixaNum, itens) {
  const lista = itens || [];
  const isMala = norm(caixaNum).startsWith("MALA");
  // destino mais frequente entre os itens
  const cont = {};
  const lotes = new Set();
  for (const it of lista) {
    if (it?.destino) cont[it.destino] = (cont[it.destino] || 0) + 1;
    if (it?.lote != null) lotes.add(it.lote);
  }
  const destino =
    Object.entries(cont).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
  const localFisico = lista.find((i) => i?.local_fisico)?.local_fisico || "—";
  return {
    tipo: isMala ? "MALA" : "CAIXA",
    titulo: isMala
      ? "NOGÁRIA OUTLET · ETIQUETA DE MALA"
      : "NOGÁRIA OUTLET · ETIQUETA DE CAIXA",
    sku: caixaNum,
    qtd: lista.length,
    lotes: [...lotes].sort((a, b) => a - b),
    skus: lista.map((i) => i.sku),
    local_fisico: localFisico,
    destino,
    checkboxes: CHECKBOXES,
    qrText: caixaNum,
    qrData: null,
  };
}

// Gera os QRs (em paralelo) para uma lista de etiquetas já montadas.
export async function attachQrCodes(labels) {
  return Promise.all(
    labels.map(async (l) => ({ ...l, qrData: await genQrDataUrl(l.qrText) }))
  );
}
