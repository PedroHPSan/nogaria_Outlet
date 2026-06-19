import React, { useEffect, useMemo, useState } from "react";
import { X, Printer, FileDown, Loader2, AlertTriangle } from "lucide-react";
import { MEDIA_PRESETS, DEFAULT_MEDIA_ID, getPreset, attachQrCodes } from "../../lib/labels";
import { generateLabelsPdf } from "../../lib/labelPdf";
import { printLabels } from "../../lib/labelPrint";
import { registrarImpressao, buscarViasImpressao, aplicarViasLocal } from "../../lib/printLog";
import LabelCard from "./LabelCard";

const STORAGE_KEY = "nogaria_label_preset";

const fmtData = (iso) => {
  try {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "";
  }
};

// Modal de impressão de etiquetas. Recebe etiquetas já montadas (sem QR);
// gera os QRs, deixa escolher o rolo DK e imprime (navegador) ou baixa PDF.
// Registra cada impressão no histórico (controle de vias) e avisa quando
// algum item já foi impresso antes.
export default function LabelPrint({ labels, user, onPrinted, onClose }) {
  const [presetId, setPresetId] = useState(
    () => localStorage.getItem(STORAGE_KEY) || DEFAULT_MEDIA_ID
  );
  const [withQr, setWithQr] = useState(null);
  const [vias, setVias] = useState({}); // sku -> { vias, ultima }

  const preset = useMemo(() => getPreset(presetId), [presetId]);

  // SKUs de itens reais (etiquetas de produto/quarentena; caixa/mala não contam).
  const itemSkus = useMemo(
    () =>
      (withQr || [])
        .filter((l) => l.sku && l.tipo !== "CAIXA" && l.tipo !== "MALA")
        .map((l) => l.sku),
    [withQr]
  );

  // Gera os QRs uma vez (não dependem do rolo).
  useEffect(() => {
    let alive = true;
    attachQrCodes(labels).then((res) => alive && setWithQr(res));
    return () => {
      alive = false;
    };
  }, [labels]);

  // Carrega o nº de vias já impressas dos itens (aviso de reimpressão).
  useEffect(() => {
    if (!itemSkus.length) return;
    let alive = true;
    buscarViasImpressao(itemSkus).then((m) => alive && setVias(m));
    return () => {
      alive = false;
    };
  }, [itemSkus]);

  // Lembra o último rolo escolhido.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, presetId);
  }, [presetId]);

  const ready = withQr != null;
  const count = labels?.length || 0;

  // Itens que já têm pelo menos uma via impressa.
  const jaImpressos = itemSkus.filter((s) => vias[s]?.vias > 0);
  const totalVias = jaImpressos.reduce((a, s) => a + (vias[s]?.vias || 0), 0);
  const ultima = jaImpressos
    .map((s) => vias[s]?.ultima)
    .filter(Boolean)
    .sort()
    .pop();

  // Imprime via iframe isolado (robusto no macOS/Safari e no Windows) e
  // registra a(s) via(s) no histórico (marcação automática ao imprimir).
  const imprimir = async () => {
    if (!withQr) return;
    printLabels(withQr, preset);
    const { skus } = await registrarImpressao(withQr, user, preset);
    if (skus.length) {
      setVias((prev) => aplicarViasLocal(prev, skus));
      onPrinted?.(skus);
    }
  };
  const baixarPdf = () => withQr && generateLabelsPdf(withQr, preset);

  return (
    <div className="fixed inset-0 z-[70] bg-gray-100 flex flex-col">
      {/* Barra superior — não imprime */}
      <div className="bg-gray-900 text-white px-4 py-3 flex items-center justify-between shadow-md print:hidden">
        <div className="flex items-center gap-2">
          <Printer className="w-5 h-5 text-orange-400" />
          <span className="font-bold">Etiquetas</span>
          <span className="text-xs text-gray-300">({count})</span>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg bg-gray-800" aria-label="Fechar">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Controles — não imprime */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 space-y-2 print:hidden">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Rolo / tamanho da etiqueta
          </span>
          <select
            value={presetId}
            onChange={(e) => setPresetId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
          >
            {MEDIA_PRESETS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-400">{preset.note}</span>
        </label>
        {jaImpressos.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 leading-snug">
              <b>
                {jaImpressos.length === 1
                  ? "1 item já foi impresso"
                  : `${jaImpressos.length} de ${itemSkus.length} itens já foram impressos`}
              </b>{" "}
              ({totalVias} {totalVias === 1 ? "via" : "vias"} no total
              {ultima ? ` · última ${fmtData(ultima)}` : ""}). Imprimir novamente
              gera uma nova via.
            </p>
          </div>
        )}
        <div className="flex gap-2">
          <button
            onClick={imprimir}
            disabled={!ready || !count}
            className="flex-1 rounded-xl py-3 font-bold bg-gray-900 text-white disabled:bg-gray-300 flex items-center justify-center gap-2"
          >
            <Printer className="w-4 h-4" /> Imprimir
          </button>
          <button
            onClick={baixarPdf}
            disabled={!ready || !count}
            className="flex-1 rounded-xl py-3 font-semibold border border-gray-300 text-gray-700 bg-white disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <FileDown className="w-4 h-4" /> Baixar PDF
          </button>
        </div>
        <p className="text-[11px] text-gray-400 leading-snug">
          Na impressão, selecione a <b>Brother QL-800</b> e confirme a largura da mídia. O
          driver corta entre as etiquetas. Conteúdo em preto (sem cores).
        </p>
      </div>

      {/* Pré-visualização / área de impressão */}
      <div className="flex-1 overflow-auto p-4">
        {!ready ? (
          <div className="py-16 text-center text-gray-400">
            <Loader2 className="w-7 h-7 animate-spin mx-auto" />
            <p className="text-sm mt-2">Gerando QR codes…</p>
          </div>
        ) : (
          <div className="print-root flex flex-wrap gap-4 justify-center">
            {withQr.map((label, i) => (
              <LabelCard key={`${label.sku}-${i}`} label={label} preset={preset} preview />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
