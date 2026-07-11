import React, { useState, useRef, Suspense } from "react";
import { supabase } from "../lib/supabase";
import { enviarFoto, marcarFotoFeita } from "../lib/fotos";
import FotoInputs from "../components/FotoInputs";
import { Images } from "lucide-react";
import { CLASSE_STYLE } from "../lib/model";
import { X, Camera, Loader2, ScanLine, ArrowRight, CheckCircle2, AlertTriangle, FileText } from "lucide-react";

// Leitor de QR só carrega a lib (@zxing) quando a tela abre.
const BarcodeScanner = React.lazy(() => import("./BarcodeScanner"));

// Fluxo rápido (mobile): escaneia o QR da etiqueta (que codifica o SKU), abre o
// produto e adiciona fotos direto — sem precisar caçar o item na lista. Pensado
// para usar o computador para localizar o item e o celular para fotografar.
export default function FotoQrScreen({ onClose, onOpenItem }) {
  const [fase, setFase] = useState("scan"); // "scan" | "buscando" | "produto"
  const [item, setItem] = useState(null);
  const [erro, setErro] = useState(null);
  const [manual, setManual] = useState("");
  const [fotosSessao, setFotosSessao] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fotoRef = useRef();

  const buscarSku = async (texto) => {
    const sku = String(texto || "").trim();
    if (!sku) return;
    setFase("buscando");
    setErro(null);
    const { data, error } = await supabase.from("itens").select("*").eq("sku", sku).maybeSingle();
    if (error) { setErro("Falha ao buscar: " + error.message); setFase("scan"); return; }
    if (!data) {
      setErro(`Nenhum produto com o código “${sku}”. Pode ser etiqueta de caixa/mala — escaneie o QR do produto.`);
      setFase("scan");
      return;
    }
    setItem(data);
    setFotosSessao([]);
    setFase("produto");
  };

  const subirFotos = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length || !item) return;
    setUploading(true);
    setErro(null);
    try {
      const { count } = await supabase
        .from("fotos").select("*", { count: "exact", head: true }).eq("sku", item.sku);
      let ordem = count || 0;
      const novas = [];
      for (const f of files) {
        const nova = await enviarFoto(item.sku, f, ordem++);
        novas.push(nova);
      }
      await marcarFotoFeita(item.sku);
      setFotosSessao((p) => [...novas, ...p]);
    } catch {
      setErro("Falha ao enviar a foto. Tente de novo.");
    } finally {
      setUploading(false);
    }
  };

  const escanearProximo = () => { setItem(null); setFotosSessao([]); setErro(null); setManual(""); setFase("scan"); };

  // ---- Fase: produto encontrado (adicionar fotos) ----
  if (fase === "produto" && item) {
    return (
      <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col">
        <div className="bg-gray-900 text-white px-4 pt-4 pb-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sm flex items-center gap-1.5"><Camera className="w-4 h-4" /> Foto por QR</span>
            <button onClick={onClose} aria-label="Fechar"><X className="w-6 h-6 text-gray-300" /></button>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-lg font-bold text-orange-400">{item.sku}</span>
            {item.classe && <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${CLASSE_STYLE[item.classe] || "bg-gray-400 text-white"}`}>{item.classe}</span>}
          </div>
          <p className="text-sm text-gray-200 mt-1 leading-snug">{item.produto}</p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {erro && <p className="text-sm text-red-600 mb-3 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {erro}</p>}

          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => fotoRef.current?.abrirCamera()} disabled={uploading}
              className="flex items-center justify-center gap-2 bg-orange-500 text-white rounded-2xl py-5 text-base font-bold shadow-sm active:bg-orange-600 disabled:opacity-50">
              {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Camera className="w-6 h-6" />}
              Câmera
            </button>
            <button onClick={() => fotoRef.current?.abrirGaleria()} disabled={uploading}
              className="flex items-center justify-center gap-2 bg-gray-800 text-white rounded-2xl py-5 text-base font-bold shadow-sm active:bg-gray-900 disabled:opacity-50">
              {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Images className="w-6 h-6" />}
              Galeria
            </button>
          </div>
          <FotoInputs ref={fotoRef} onFiles={subirFotos} />

          {fotosSessao.length > 0 && (
            <div className="mt-4">
              <p className="text-sm text-emerald-700 font-semibold flex items-center gap-1.5 mb-2">
                <CheckCircle2 className="w-4 h-4" /> {fotosSessao.length} foto(s) adicionada(s) a este produto
              </p>
              <div className="flex gap-2 flex-wrap">
                {fotosSessao.map((f) => (
                  <div key={f.id} className="w-20 h-20 rounded-lg overflow-hidden bg-gray-100">
                    {f.url && <img src={f.url} alt="" className="w-full h-full object-cover" />}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="bg-white border-t border-gray-200 px-4 py-3 space-y-2">
          <button onClick={escanearProximo}
            className="w-full flex items-center justify-center gap-2 bg-gray-900 text-white rounded-xl py-3.5 font-bold active:bg-gray-800">
            <ScanLine className="w-5 h-5" /> Escanear próximo produto
          </button>
          <div className="flex gap-2">
            {onOpenItem && (
              <button onClick={() => onOpenItem(item)}
                className="flex-1 flex items-center justify-center gap-1.5 border border-gray-300 text-gray-700 rounded-xl py-3 text-sm font-semibold">
                <FileText className="w-4 h-4" /> Abrir ficha
              </button>
            )}
            <button onClick={onClose}
              className="flex-1 border border-gray-300 text-gray-700 rounded-xl py-3 text-sm font-semibold">
              Fechar
            </button>
          </div>
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
        <BarcodeScanner qr onClose={onClose} onDetected={buscarSku}
          title="Foto por QR — escaneie a etiqueta" hint="Aponte para o QR da etiqueta do produto." />
      </Suspense>
      {/* Fallback manual (útil no desktop ou se a câmera falhar) — sobreposto ao scanner. */}
      <div className="absolute bottom-0 inset-x-0 bg-black/80 px-4 py-3">
        {erro && <p className="text-amber-300 text-xs mb-2 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {erro}</p>}
        <form onSubmit={(e) => { e.preventDefault(); buscarSku(manual); }} className="flex gap-2">
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="ou digite o SKU (ex.: NOG-126-001)"
            className="flex-1 rounded-lg border border-gray-600 bg-gray-900 text-white px-3 py-2.5 text-sm font-mono placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500" />
          <button type="submit" className="px-4 rounded-lg bg-orange-500 text-white font-semibold flex items-center gap-1 text-sm">
            Buscar <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
