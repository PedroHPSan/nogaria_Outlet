import React, { useEffect, useRef } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { X } from "lucide-react";

// Leitor por câmera. Por padrão para na primeira leitura válida e devolve o
// texto via onDetected. Com continuous=true fica lendo em sequência (para
// conferir vários itens), disparando onDetected a cada código novo com um
// debounce de ~1,5s para não repetir a mesma leitura. Modo padrão lê código de
// barras (GTIN); com qr=true também lê o QR Code das etiquetas (que codifica o
// SKU). Sempre há um fallback manual no fluxo chamador — se a câmera falhar,
// nada trava. onDetected é guardado num ref para a câmera não reiniciar a cada
// re-render do chamador (essencial no modo contínuo).
export default function BarcodeScanner({ onDetected, onClose, qr = false, continuous = false, title, hint }) {
  const videoRef = useRef(null);
  const doneRef = useRef(false);
  const erroRef = useRef(null);
  const onDetectedRef = useRef(onDetected);
  const ultimaRef = useRef({ texto: null, em: 0 });
  useEffect(() => { onDetectedRef.current = onDetected; }, [onDetected]);

  useEffect(() => {
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, qr
      ? [BarcodeFormat.QR_CODE, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.CODE_128]
      : [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128]);
    const reader = new BrowserMultiFormatReader(hints);
    let controls;

    reader
      .decodeFromVideoDevice(undefined, videoRef.current, (result, _err, ctrl) => {
        if (!result) return;
        const texto = result.getText();
        if (continuous) {
          const agora = Date.now();
          const ult = ultimaRef.current;
          if (texto === ult.texto && agora - ult.em < 1500) return; // debounce da mesma leitura
          ultimaRef.current = { texto, em: agora };
          onDetectedRef.current(texto);
        } else if (!doneRef.current) {
          doneRef.current = true;
          ctrl.stop();
          onDetectedRef.current(texto);
        }
      })
      .then((c) => { controls = c; })
      .catch(() => {
        if (erroRef.current) erroRef.current.textContent =
          "Não foi possível acessar a câmera. Verifique a permissão da câmera no navegador.";
      });

    return () => { try { controls?.stop(); } catch { /* noop */ } };
  }, [qr, continuous]);

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col">
      <div className="flex justify-between items-center px-4 py-3 text-white">
        <span className="font-semibold">{title || (qr ? "Escanear QR do produto" : "Escanear código de barras")}</span>
        <button onClick={onClose} aria-label="Fechar"><X className="w-6 h-6" /></button>
      </div>
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
        {qr
          ? <div className="absolute w-56 h-56 border-2 border-orange-500 rounded-lg pointer-events-none" />
          : <div className="absolute inset-x-10 h-28 border-2 border-orange-500 rounded-lg pointer-events-none" />}
      </div>
      <p ref={erroRef} className="text-gray-300 text-sm text-center px-4 py-3">
        {hint || (qr ? "Aponte a câmera para o QR da etiqueta do produto." : "Aponte a câmera para o código de barras do produto.")}
      </p>
    </div>
  );
}
