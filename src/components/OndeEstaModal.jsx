import React, { useState, Suspense } from "react";
import { localizarItem, CAIXA_STATUS } from "../lib/caixas";
import { X, Loader2, ScanLine, Search, Package, CheckCircle2, AlertTriangle, MapPin } from "lucide-react";

const BarcodeScanner = React.lazy(() => import("../screens/BarcodeScanner"));

// "Onde está?": lê/digita SKU ou GTIN e diz na hora se o produto está numa caixa
// (qual, com apelido e status) ou solto. Segue pronto para a próxima leitura.
export default function OndeEstaModal({ onClose, onOpenItem }) {
  const [texto, setTexto] = useState("");
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null); // { codigo } | { item, caixa } | { naoAchou }

  const buscar = async (cod) => {
    const c = String(cod || "").trim();
    if (!c) return;
    setScan(false); setBusy(true); setTexto("");
    try {
      const r = await localizarItem(c);
      setRes(r || { naoAchou: c });
    } catch (e) {
      setRes({ erro: e.message || String(e) });
    } finally { setBusy(false); }
  };

  const { item, caixa } = res || {};
  const aberta = caixa && caixa.status !== CAIXA_STATUS.FECHADA;

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col">
      <div className="bg-gray-900 text-white px-4 pt-4 pb-3 flex items-center justify-between">
        <span className="font-semibold text-sm flex items-center gap-1.5"><MapPin className="w-4 h-4" /> Onde está o produto?</span>
        <button onClick={onClose} aria-label="Fechar"><X className="w-6 h-6 text-gray-300" /></button>
      </div>
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex gap-2">
        <button onClick={() => setScan(true)}
          className="flex items-center justify-center gap-2 bg-gray-900 text-white rounded-xl px-4 py-2.5 text-sm font-bold active:bg-gray-800">
          <ScanLine className="w-4 h-4" /> Escanear
        </button>
        <form onSubmit={(e) => { e.preventDefault(); buscar(texto); }} className="flex-1 flex gap-2">
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="SKU ou GTIN" autoFocus
            autoCapitalize="characters" autoComplete="off"
            className="flex-1 min-w-0 rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-500" />
          <button type="submit" aria-label="Buscar" className="px-3 rounded-lg bg-orange-500 text-white"><Search className="w-4 h-4" /></button>
        </form>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {busy && <Loader2 className="w-6 h-6 animate-spin text-orange-500 mx-auto mt-8" />}
        {!busy && !res && <p className="text-sm text-gray-400 text-center py-10">Escaneie o QR da etiqueta ou digite o SKU/GTIN.</p>}
        {!busy && res?.erro && <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {res.erro}</p>}
        {!busy && res?.naoAchou && <p className="text-sm text-amber-700 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> "{res.naoAchou}" não encontrado.</p>}
        {!busy && item && (
          <div className={`rounded-2xl border-2 p-4 ${caixa ? (aberta ? "border-emerald-400 bg-emerald-50" : "border-gray-300 bg-white") : "border-amber-400 bg-amber-50"}`}>
            <p className="font-mono text-sm font-bold text-gray-900">{item.sku}</p>
            <p className="text-sm text-gray-600 mb-3">{item.produto}</p>
            {caixa ? (
              <>
                <p className="text-xs font-bold uppercase text-gray-500 flex items-center gap-1.5"><Package className="w-3.5 h-3.5" /> Está na caixa</p>
                <p className="text-2xl font-bold font-mono text-gray-900">{caixa.codigo}</p>
                {caixa.apelido && <p className="text-lg font-semibold text-gray-800">{caixa.apelido}</p>}
                <div className="flex gap-2 mt-2 flex-wrap">
                  <span className={`text-[10px] font-bold uppercase rounded px-1.5 py-0.5 ${aberta ? "bg-emerald-600 text-white" : "bg-gray-200 text-gray-600"}`}>{aberta ? "Aberta" : "Fechada"}</span>
                  <span className="text-xs text-gray-500">{caixa.destino || "sem destino"}{item.sala_id ? ` · ${item.sala_id}` : ""}</span>
                </div>
              </>
            ) : (
              <p className="text-lg font-bold text-amber-700 flex items-center gap-2"><CheckCircle2 className="w-5 h-5" /> Não está em nenhuma caixa{item.sala_id ? ` · sala ${item.sala_id}` : ""}</p>
            )}
            {onOpenItem && <button onClick={() => onOpenItem(item)} className="mt-3 text-sm font-semibold text-orange-600 underline">Abrir item</button>}
          </div>
        )}
      </div>

      {scan && (
        <Suspense fallback={null}>
          <BarcodeScanner qr onClose={() => setScan(false)} onDetected={buscar}
            title="Onde está? — escaneie o item" hint="Aponte para o QR da etiqueta do produto." />
        </Suspense>
      )}
    </div>
  );
}
