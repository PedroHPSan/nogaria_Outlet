import React, { useState, Suspense } from "react";
import { buscarCaixa, itensDaCaixa } from "../lib/caixas";
import { estimarValorCaixa, estimarValorVenda, estimarPesoCaixa } from "../lib/classificacao";
import { CLASSE_STYLE, fmtBRL, fmtKg } from "../lib/model";
import { X, Loader2, ScanLine, ArrowRight, AlertTriangle, Boxes, Package, ChevronRight } from "lucide-react";

// Leitor de QR só carrega a lib (@zxing) quando a tela abre.
const BarcodeScanner = React.lazy(() => import("./BarcodeScanner"));

// Scanner dedicado de CAIXA/MALA: escaneia o QR da etiqueta (que codifica o código
// da caixa, ex.: CX-001), abre o conteúdo e o valor estimado para avaliar a caixa
// sem precisar listar os SKUs na etiqueta. Cada item leva à ficha.
export default function CaixaQrScreen({ onClose, onOpenItem, params }) {
  const [fase, setFase] = useState("scan"); // "scan" | "buscando" | "caixa"
  const [caixa, setCaixa] = useState(null);
  const [itens, setItens] = useState([]);
  const [erro, setErro] = useState(null);
  const [manual, setManual] = useState("");

  const buscar = async (texto) => {
    const cod = String(texto || "").trim();
    if (!cod) return;
    setFase("buscando");
    setErro(null);
    try {
      const c = await buscarCaixa(cod);
      if (!c) {
        setErro(`Nenhuma caixa/mala com o código “${cod}”. Escaneie o QR da etiqueta de caixa.`);
        setFase("scan");
        return;
      }
      setCaixa(c);
      setItens(await itensDaCaixa(c.codigo));
      setFase("caixa");
    } catch (e) {
      setErro("Falha ao buscar: " + (e.message || String(e)));
      setFase("scan");
    }
  };

  const escanearProxima = () => { setCaixa(null); setItens([]); setErro(null); setManual(""); setFase("scan"); };

  // ---- Fase: caixa encontrada (avaliar conteúdo) ----
  if (fase === "caixa" && caixa) {
    const isMala = caixa.tipo === "MALA";
    const { total, semPreco } = estimarValorCaixa(itens, params);
    const { pesoKg, semPeso } = estimarPesoCaixa(itens, params);
    return (
      <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col">
        <div className="bg-gray-900 text-white px-4 pt-4 pb-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sm flex items-center gap-1.5">
              {isMala ? <Boxes className="w-4 h-4" /> : <Package className="w-4 h-4" />} Conteúdo da {isMala ? "mala" : "caixa"}
            </span>
            <button onClick={onClose} aria-label="Fechar"><X className="w-6 h-6 text-gray-300" /></button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="font-mono text-lg font-bold text-orange-400">{caixa.codigo}</span>
            {caixa.status === "FECHADA" && <span className="text-[10px] font-bold uppercase bg-gray-700 rounded px-1.5 py-0.5">Fechada</span>}
          </div>
          <p className="text-xs text-gray-400 mt-1">{caixa.destino || "sem destino"}{caixa.local_fisico ? ` · ${caixa.local_fisico}` : ""}</p>
          <div className="flex items-end justify-between mt-2">
            <p className="text-3xl font-bold">{itens.length} <span className="text-base text-gray-400">item(ns)</span></p>
            <div className="flex items-end gap-4">
              <div className="text-right">
                <p className="text-xs text-gray-400 leading-none">peso estimado</p>
                <p className="text-xl font-bold text-sky-400">{pesoKg > 0 ? `~${fmtKg(pesoKg)}` : "—"}</p>
                {semPeso > 0 && <p className="text-[10px] text-gray-500 leading-none">{semPeso} sem medida</p>}
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-400 leading-none">valor estimado</p>
                <p className="text-xl font-bold text-emerald-400">~{fmtBRL(total)}</p>
                {semPreco > 0 && <p className="text-[10px] text-gray-500 leading-none">{semPreco} sem preço</p>}
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {erro && <p className="text-sm text-red-600 mb-3 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {erro}</p>}
          {!itens.length ? (
            <p className="text-sm text-gray-400 text-center py-10">Caixa vazia.</p>
          ) : (
            <div className="space-y-1.5">
              {itens.map((it) => {
                const v = estimarValorVenda(it, params);
                return (
                  <button key={it.sku} onClick={() => onOpenItem?.(it)}
                    className="w-full text-left bg-white rounded-xl border border-gray-200 px-3 py-2.5 flex items-center gap-3 active:bg-gray-100">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-gray-900">{it.sku}</span>
                        {it.classe && <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${CLASSE_STYLE[it.classe] || "bg-gray-400 text-white"}`}>{it.classe}</span>}
                        {v != null && <span className="ml-auto text-xs font-semibold text-emerald-600">~{fmtBRL(v)}</span>}
                      </div>
                      <p className="text-sm text-gray-600 truncate">{it.produto}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white border-t border-gray-200 px-4 py-3 space-y-2">
          <button onClick={escanearProxima}
            className="w-full flex items-center justify-center gap-2 bg-gray-900 text-white rounded-xl py-3.5 font-bold active:bg-gray-800">
            <ScanLine className="w-5 h-5" /> Escanear próxima caixa
          </button>
          <button onClick={onClose}
            className="w-full border border-gray-300 text-gray-700 rounded-xl py-3 text-sm font-semibold">
            Fechar
          </button>
        </div>
      </div>
    );
  }

  // ---- Fase: buscando ----
  if (fase === "buscando") {
    return (
      <div className="fixed inset-0 z-50 bg-gray-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  // ---- Fase: escanear ----
  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>}>
        <BarcodeScanner qr onClose={onClose} onDetected={buscar}
          title="Caixa por QR — escaneie a etiqueta" hint="Aponte para o QR da etiqueta de caixa/mala." />
      </Suspense>
      {/* Fallback manual (desktop ou se a câmera falhar) — sobreposto ao scanner. */}
      <div className="absolute bottom-0 inset-x-0 bg-black/80 px-4 py-3">
        {erro && <p className="text-amber-300 text-xs mb-2 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {erro}</p>}
        <form onSubmit={(e) => { e.preventDefault(); buscar(manual); }} className="flex gap-2">
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="ou digite o código (ex.: CX-001)"
            autoCapitalize="characters" autoComplete="off"
            className="flex-1 rounded-lg border border-gray-600 bg-gray-900 text-white px-3 py-2.5 text-sm font-mono placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500" />
          <button type="submit" className="px-4 rounded-lg bg-orange-500 text-white font-semibold flex items-center gap-1 text-sm">
            Abrir <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
