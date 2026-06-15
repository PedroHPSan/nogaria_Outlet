import React, { useEffect, useMemo, useState } from "react";
import { X, Printer, FileDown, Loader2 } from "lucide-react";
import { MEDIA_PRESETS, DEFAULT_MEDIA_ID, getPreset, attachQrCodes } from "../../lib/labels";
import { generateLabelsPdf } from "../../lib/labelPdf";
import LabelCard from "./LabelCard";

const STORAGE_KEY = "nogaria_label_preset";

// Modal de impressão de etiquetas. Recebe etiquetas já montadas (sem QR);
// gera os QRs, deixa escolher o rolo DK e imprime (navegador) ou baixa PDF.
export default function LabelPrint({ labels, onClose }) {
  const [presetId, setPresetId] = useState(
    () => localStorage.getItem(STORAGE_KEY) || DEFAULT_MEDIA_ID
  );
  const [withQr, setWithQr] = useState(null);

  const preset = useMemo(() => getPreset(presetId), [presetId]);

  // Gera os QRs uma vez (não dependem do rolo).
  useEffect(() => {
    let alive = true;
    attachQrCodes(labels).then((res) => alive && setWithQr(res));
    return () => {
      alive = false;
    };
  }, [labels]);

  // Define o tamanho físico da página de impressão conforme o rolo.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, presetId);
    const id = "label-print-page-style";
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = `@media print { @page { size: ${preset.width}mm ${preset.height}mm; margin: 0; } }`;
    return () => {
      const node = document.getElementById(id);
      if (node) node.remove();
    };
  }, [presetId, preset.width, preset.height]);

  const ready = withQr != null;
  const count = labels?.length || 0;

  const imprimir = () => window.print();
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
