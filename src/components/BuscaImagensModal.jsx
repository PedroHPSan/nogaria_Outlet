import React, { useState, useEffect, useCallback } from "react";
import { Search, X, Loader2, Check, ExternalLink, Download, AlertTriangle } from "lucide-react";
import { montarQuery, urlGoogleImagens, buscarImagens, baixarImagem } from "../lib/imagensWeb";

// Busca imagens no Google pelo produto (+ marca/modelo opcionais) e devolve as
// escolhidas como File[] via onAnexar. Também aceita colar (Ctrl+V) uma imagem
// copiada do Google Imagens, que funciona mesmo sem a busca configurada.
export default function BuscaImagensModal({ item, onAnexar, onClose }) {
  const [usaMarca, setUsaMarca] = useState(true);
  const [usaModelo, setUsaModelo] = useState(true);
  const [q, setQ] = useState(() => montarQuery(item));
  const [editado, setEditado] = useState(false);
  const [resultados, setResultados] = useState([]);
  const [sel, setSel] = useState([]); // urls selecionadas
  const [loading, setLoading] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState("");

  // Enquanto o usuário não editou o texto, os chips marca/modelo reescrevem a query.
  useEffect(() => {
    if (!editado) setQ(montarQuery(item, { marca: usaMarca, modelo: usaModelo }));
  }, [usaMarca, usaModelo, editado, item]);

  const buscar = async () => {
    if (!q.trim()) return;
    setLoading(true); setErro(""); setSel([]);
    try {
      setResultados(await buscarImagens(q.trim()));
    } catch (e) {
      setResultados([]);
      setErro(e.message === "google_nao_configurado"
        ? "Busca integrada ainda não configurada (chave do Google). Use “Abrir no Google”, copie a imagem e cole aqui com Ctrl+V."
        : `Falha na busca: ${e.message}`);
    } finally { setLoading(false); }
  };

  const anexar = useCallback(async (files) => {
    if (files.length) { await onAnexar(files); onClose(); }
  }, [onAnexar, onClose]);

  // Colar imagem da área de transferência.
  useEffect(() => {
    const onPaste = (e) => {
      const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith("image/"));
      if (files.length) { e.preventDefault(); anexar(files); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [anexar]);

  const confirmar = async () => {
    setBaixando(true); setErro("");
    const files = [];
    const falhas = [];
    for (const url of sel) {
      try { files.push(await baixarImagem(url, item.sku || "web")); }
      catch { falhas.push(url); }
    }
    setBaixando(false);
    if (falhas.length) setErro(`${falhas.length} imagem(ns) não puderam ser baixadas (site bloqueou). ${files.length ? "As demais foram anexadas." : "Tente outra."}`);
    if (files.length) await anexar(files);
  };

  const toggle = (url) => setSel((s) => (s.includes(url) ? s.filter((x) => x !== url) : [...s, url]));

  return (
    <div className="fixed inset-0 z-[90] bg-black/60 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-3xl max-h-[92vh] rounded-t-2xl sm:rounded-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="font-bold text-gray-800">Buscar fotos na internet</h3>
          <button onClick={onClose} aria-label="Fechar" className="p-1.5 rounded-lg active:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-4 py-3 space-y-2 border-b border-gray-100">
          <form onSubmit={(e) => { e.preventDefault(); buscar(); }} className="flex gap-2">
            <input value={q} onChange={(e) => { setQ(e.target.value); setEditado(true); }}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Produto, marca, modelo…" />
            <button type="submit" disabled={loading || !q.trim()}
              className="inline-flex items-center gap-1.5 bg-orange-500 text-white rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Buscar
            </button>
          </form>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {item.marca && (
              <button onClick={() => { setUsaMarca((v) => !v); setEditado(false); }}
                className={`px-2 py-1 rounded-full border ${usaMarca ? "bg-orange-50 border-orange-300 text-orange-700" : "border-gray-300 text-gray-500"}`}>
                {usaMarca ? "✓ " : ""}marca: {item.marca}
              </button>
            )}
            {item.modelo && (
              <button onClick={() => { setUsaModelo((v) => !v); setEditado(false); }}
                className={`px-2 py-1 rounded-full border ${usaModelo ? "bg-orange-50 border-orange-300 text-orange-700" : "border-gray-300 text-gray-500"}`}>
                {usaModelo ? "✓ " : ""}modelo: {item.modelo}
              </button>
            )}
            {["fundo branco", "frente", "caixa"].map((t) => (
              <button key={t} onClick={() => { setQ((v) => `${v} ${t}`.trim()); setEditado(true); }}
                className="px-2 py-1 rounded-full border border-gray-300 text-gray-600">+ {t}</button>
            ))}
            <a href={urlGoogleImagens(q)} target="_blank" rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-blue-600 font-semibold">
              <ExternalLink className="w-3.5 h-3.5" /> Abrir no Google
            </a>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {erro && (
            <div className="flex gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-3">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {erro}
            </div>
          )}
          {!resultados.length && !loading && !erro && (
            <p className="text-sm text-gray-400 text-center py-8">Busque pelo produto ou cole (Ctrl+V) uma imagem copiada do Google.</p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {resultados.map((r) => {
              const on = sel.includes(r.url);
              return (
                <button key={r.url} onClick={() => toggle(r.url)}
                  className={`relative rounded-lg overflow-hidden border-2 text-left ${on ? "border-orange-500" : "border-transparent"}`}>
                  <img src={r.thumb} alt={r.titulo} loading="lazy" referrerPolicy="no-referrer" className="w-full h-32 object-contain bg-gray-100" />
                  {on && <span className="absolute top-1 right-1 bg-orange-500 text-white rounded-full p-0.5"><Check className="w-3.5 h-3.5" /></span>}
                  <span className="block px-1.5 py-1 text-[10px] text-gray-500 truncate">{r.fonte}{r.w ? ` · ${r.w}×${r.h}` : ""}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
          <span className="text-xs text-gray-500">{sel.length} selecionada(s). Confira os direitos de uso da imagem.</span>
          <button onClick={confirmar} disabled={!sel.length || baixando}
            className="inline-flex items-center gap-1.5 bg-orange-500 text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
            {baixando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Anexar ao item
          </button>
        </div>
      </div>
    </div>
  );
}
