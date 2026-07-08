// Modal de prévia do anúncio/orçamento de um item: renderiza o HTML A4 num iframe
// (srcDoc, sem o CSS do app) e oferece Copiar mensagem / WhatsApp / Salvar PDF.
import React, { useEffect, useState } from "react";
import { X, Loader2, Printer, Copy, MessageCircle, Check } from "lucide-react";
import { montarAnuncio, imprimirAnuncio } from "../lib/anuncio";
import { precoVenda } from "../lib/export";

export default function AnuncioModal({ item, onClose }) {
  const [loading, setLoading] = useState(true);
  const [dados, setDados] = useState(null); // { html, mensagem, link }
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const d = await montarAnuncio(item);
        if (!cancel) setDados(d);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [item]);

  const semPreco = precoVenda(item) == null;
  const semFoto = !item.foto_feita;

  const copiar = async () => {
    if (!dados) return;
    try {
      await navigator.clipboard.writeText(dados.mensagem);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch { /* clipboard indisponível */ }
  };
  const abrirWhats = () => { try { window.open(dados.link, "_blank"); } catch { /* noop */ } };

  return (
    <div className="fixed inset-0 z-[75] bg-gray-100 flex flex-col">
      <div className="bg-gray-900 text-white px-4 py-3 flex items-center justify-between shadow-md">
        <span className="font-bold">Orçamento — {item.sku}</span>
        <button onClick={onClose} className="p-1.5 rounded-lg bg-gray-800" aria-label="Fechar">
          <X className="w-5 h-5" />
        </button>
      </div>

      {(semPreco || semFoto) && (
        <div className="px-4 py-2 text-xs bg-amber-50 text-amber-800 border-b border-amber-200 space-y-0.5">
          {semPreco && <div>⚠ Sem preço ideal — o anúncio sai como "Sob consulta". Defina o preço no item.</div>}
          {semFoto && <div>⚠ Sem foto — o anúncio sai com placeholder.</div>}
        </div>
      )}

      <div className="flex-1 overflow-auto p-3 flex items-start justify-center">
        {loading && <Loader2 className="w-8 h-8 animate-spin text-orange-500 mt-10" />}
        {!loading && dados && (
          <iframe title="Prévia do anúncio" srcDoc={dados.html}
            className="bg-white shadow-lg w-full max-w-[210mm]"
            style={{ aspectRatio: "210 / 297", border: 0 }} />
        )}
      </div>

      {!loading && dados && (
        <div className="p-3 border-t border-gray-200 bg-white flex gap-2 max-w-lg mx-auto w-full">
          <button onClick={copiar}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-semibold border border-gray-300 text-gray-700 bg-white">
            {copiado ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />} {copiado ? "Copiado" : "Copiar msg"}
          </button>
          <button onClick={abrirWhats}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-semibold border border-emerald-200 text-emerald-700 bg-emerald-50">
            <MessageCircle className="w-4 h-4" /> WhatsApp
          </button>
          <button onClick={() => imprimirAnuncio(dados.html)}
            className="flex-[1.4] flex items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-bold bg-gray-900 text-white">
            <Printer className="w-4 h-4" /> Salvar PDF
          </button>
        </div>
      )}
    </div>
  );
}
