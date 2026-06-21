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

// Medidas do item p/ a etiqueta grande (62×100): "45×30×20 cm · 2,5 kg".
// Devolve null se não houver nem dimensões nem peso (não ocupa espaço à toa).
function fmtMedidas(item) {
  const c = item?.comprimento_cm, l = item?.largura_cm, a = item?.altura_cm;
  const peso = item?.peso_real_kg ?? item?.peso_kg;
  const temDim = [c, l, a].some((v) => v != null);
  const dim = temDim ? `${c ?? "–"}×${l ?? "–"}×${a ?? "–"} cm` : null;
  const pesoTxt = peso != null ? `${String(peso).replace(".", ",")} kg` : null;
  return [dim, pesoTxt].filter(Boolean).join(" · ") || null;
}

// Ordem visual das classes (model.js). Usada p/ o resumo da caixa.
const CLASSE_ORDEM = ["A+", "A", "B", "C", "D", "E"];

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
    medidas: fmtMedidas(item),
    aviso: atencao ? "NÃO ANUNCIAR ANTES DE TESTAR" : null,
    checkboxes: CHECKBOXES,
    qrText: item?.sku || "",
    qrData: null, // preenchido depois por genQrDataUrl
  };
}

const norm = (s) => String(s || "").trim().toUpperCase();

// Etiqueta de CAIXA ou MALA. Recebe a linha da caixa (tabela `caixas`: codigo,
// tipo, destino, local_fisico) e os itens encaixotados. Destino/local vêm da
// própria caixa (uma caixa = um destino); lotes/SKUs são agregados dos itens.
export function buildBoxLabel(caixa, itens) {
  const lista = itens || [];
  const isMala = (caixa?.tipo
    ? norm(caixa.tipo) === "MALA"
    : norm(caixa?.codigo).startsWith("MALA"));
  const lotes = new Set();
  const classeCount = {}, loteCount = {};
  for (const it of lista) {
    if (it?.lote != null) { lotes.add(it.lote); loteCount[it.lote] = (loteCount[it.lote] || 0) + 1; }
    if (it?.classe) classeCount[it.classe] = (classeCount[it.classe] || 0) + 1;
  }
  // Resumos "A+×2 · B×3" e "L12×3 · L15×2" para a etiqueta grande (62×100).
  const classeResumo = Object.keys(classeCount)
    .sort((a, b) => {
      const ia = CLASSE_ORDEM.indexOf(a), ib = CLASSE_ORDEM.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })
    .map((k) => `${k}×${classeCount[k]}`)
    .join(" · ");
  const loteResumo = Object.keys(loteCount)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => `L${k}×${loteCount[k]}`)
    .join(" · ");
  return {
    tipo: isMala ? "MALA" : "CAIXA",
    titulo: isMala
      ? "NOGÁRIA OUTLET · ETIQUETA DE MALA"
      : "NOGÁRIA OUTLET · ETIQUETA DE CAIXA",
    sku: caixa?.codigo || "",
    qtd: lista.length,
    lotes: [...lotes].sort((a, b) => a - b),
    classeResumo,
    loteResumo,
    skus: lista.map((i) => i.sku),
    local_fisico: caixa?.local_fisico || "—",
    destino: caixa?.destino || "—",
    checkboxes: CHECKBOXES,
    qrText: caixa?.codigo || "",
    qrData: null,
  };
}

// Gera os QRs (em paralelo) para uma lista de etiquetas já montadas.
export async function attachQrCodes(labels) {
  return Promise.all(
    labels.map(async (l) => ({ ...l, qrData: await genQrDataUrl(l.qrText) }))
  );
}
