import React, { useState, useEffect, useRef } from "react";
import { X, Loader2, Wand2, Save, AlertTriangle } from "lucide-react";

const FUNDOS = [
  { id: "branco", label: "Branco", cor: "#ffffff" },
  { id: "cinza", label: "Cinza claro", cor: "#f1f1f1" },
  { id: "transparente", label: "Transparente (PNG)", cor: null },
];

// Compõe o recorte (PNG com alfa) sobre a cor de fundo escolhida. Retorna Blob.
async function compor(recorte, cor) {
  const bmp = await createImageBitmap(recorte);
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext("2d");
  if (cor) { ctx.fillStyle = cor; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.drawImage(bmp, 0, 0);
  return new Promise((res) => c.toBlob(res, cor ? "image/jpeg" : "image/png", 0.92));
}

// Editor de foto: remove o fundo no próprio navegador (@imgly/background-removal,
// open source — modelo ONNX/WASM; a 1ª execução baixa ~40 MB e fica em cache) e
// salva o resultado como NOVA foto do item (a original é preservada).
export default function EditorFotoModal({ url, sku, onSalvar, onClose }) {
  const [original, setOriginal] = useState(null); // Blob
  const [recorte, setRecorte] = useState(null);   // Blob PNG com alfa
  const [fundo, setFundo] = useState("branco");
  const [previa, setPrevia] = useState(url);
  const [proc, setProc] = useState(false);
  const [progresso, setProgresso] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const urlsRef = useRef([]);

  const novaUrl = (blob) => { const u = URL.createObjectURL(blob); urlsRef.current.push(u); return u; };
  useEffect(() => () => urlsRef.current.forEach(URL.revokeObjectURL), []);

  useEffect(() => {
    fetch(url).then((r) => r.blob()).then(setOriginal).catch(() => setErro("Não foi possível carregar a foto."));
  }, [url]);

  const removerFundo = async () => {
    if (!original) return;
    setProc(true); setErro(""); setProgresso("Carregando modelo…");
    try {
      const { removeBackground } = await import("@imgly/background-removal");
      const png = await removeBackground(original, {
        model: "isnet_fp16",
        output: { format: "image/png" },
        progress: (key, cur, tot) => {
          if (tot) setProgresso(`${key.startsWith("fetch") ? "Baixando modelo" : "Processando"} ${Math.round((cur / tot) * 100)}%`);
        },
      });
      setRecorte(png);
    } catch (e) {
      setErro(`Falha ao remover o fundo: ${e?.message || e}`);
    } finally { setProc(false); setProgresso(""); }
  };

  // Atualiza a prévia quando muda o recorte ou o fundo.
  useEffect(() => {
    if (!recorte) return;
    let vivo = true;
    compor(recorte, FUNDOS.find((f) => f.id === fundo).cor).then((b) => vivo && setPrevia(novaUrl(b)));
    return () => { vivo = false; };
  }, [recorte, fundo]);

  const salvar = async () => {
    setSalvando(true);
    try {
      const cor = FUNDOS.find((f) => f.id === fundo).cor;
      const blob = await compor(recorte, cor);
      const file = new File([blob], `${sku}-sem-fundo.${cor ? "jpg" : "png"}`, { type: blob.type });
      await onSalvar(file);
      onClose();
    } catch {
      setErro("Falha ao salvar a foto.");
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[95] bg-black/70 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-2xl max-h-[94vh] rounded-t-2xl sm:rounded-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="font-bold text-gray-800">Editar foto</h3>
          <button onClick={onClose} aria-label="Fechar" className="p-1.5 rounded-lg active:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          <div className="relative rounded-xl bg-[conic-gradient(#e5e7eb_25%,#fff_0_50%,#e5e7eb_0_75%,#fff_0)] bg-[length:16px_16px]">
            <img src={previa} alt="" className="w-full max-h-[55vh] object-contain" />
            {proc && (
              <div className="absolute inset-0 bg-white/70 flex flex-col items-center justify-center gap-2 text-sm text-gray-700">
                <Loader2 className="w-6 h-6 animate-spin" /> {progresso}
              </div>
            )}
          </div>
          {erro && <div className="mt-3 flex gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5"><AlertTriangle className="w-4 h-4 shrink-0" />{erro}</div>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={removerFundo} disabled={!original || proc}
              className="inline-flex items-center gap-1.5 bg-violet-600 text-white rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50">
              <Wand2 className="w-4 h-4" /> {recorte ? "Refazer" : "Remover fundo"}
            </button>
            {recorte && FUNDOS.map((f) => (
              <button key={f.id} onClick={() => setFundo(f.id)}
                className={`px-2.5 py-1.5 rounded-lg border text-xs ${fundo === f.id ? "border-violet-500 bg-violet-50 text-violet-700 font-semibold" : "border-gray-300 text-gray-600"}`}>
                {f.label}
              </button>
            ))}
          </div>
          {!recorte && <p className="text-xs text-gray-400 mt-2">Roda no seu aparelho (nada é enviado a terceiros). Na 1ª vez baixa o modelo (~40 MB).</p>}
        </div>
        <div className="px-4 py-3 border-t border-gray-200 flex justify-end">
          <button onClick={salvar} disabled={!recorte || salvando}
            className="inline-flex items-center gap-1.5 bg-orange-500 text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar como nova foto
          </button>
        </div>
      </div>
    </div>
  );
}
