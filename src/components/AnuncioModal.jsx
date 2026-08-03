// Modal de prévia do orçamento (1..10 itens): renderiza o HTML A4 num iframe
// (srcDoc, sem o CSS do app) e oferece Copiar mensagem / WhatsApp / Salvar PDF.
import React, { useEffect, useRef, useState } from "react";
import { X, Loader2, Printer, Copy, MessageCircle, Check } from "lucide-react";
import { montarOrcamento, imprimirAnuncio } from "../lib/anuncio";

// A folha do PDF tem largura fixa de 210mm (≈794px a 96dpi); em tela estreita
// não dá para "esticar" o iframe — o conteúdo cortaria. A prévia então mantém
// o A4 no tamanho real e aplica um transform:scale para caber na largura.
const A4_W = 794;   // 210mm em px @96dpi
const A4_H = 1123;  // 297mm em px @96dpi

export default function AnuncioModal({ itens = [], onClose }) {
  const [loading, setLoading] = useState(true);
  const [dados, setDados] = useState(null);   // { html, mensagem, link, total, semPreco, semFoto }
  const [erro, setErro] = useState(null);
  const [progresso, setProgresso] = useState({ feitas: 0, total: itens.length });
  const [copiado, setCopiado] = useState(false);
  const areaRef = useRef(null);
  const [larguraArea, setLarguraArea] = useState(0);

  // Largura útil da área de prévia (já sem o padding) → fator de escala do A4.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    setLarguraArea(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setLarguraArea(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const escala = larguraArea ? Math.min(1, larguraArea / A4_W) : 1;

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      setErro(null);
      setDados(null);
      setProgresso({ feitas: 0, total: itens.length });
      try {
        const d = await montarOrcamento(itens, {
          onProgress: (feitas, total) => { if (!cancel) setProgresso({ feitas, total }); },
        });
        if (!cancel) setDados(d);
      } catch (e) {
        if (!cancel) setErro(e.message || "Falha ao gerar o orçamento.");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [itens]);

  const titulo = itens.length === 1 ? `Orçamento — ${itens[0].sku}` : `Orçamento — ${itens.length} itens`;

  const copiar = async () => {
    if (!dados) return;
    try {
      await navigator.clipboard.writeText(dados.mensagem);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch { /* clipboard indisponível */ }
  };
  const abrirWhats = () => { if (!dados) return; try { window.open(dados.link, "_blank"); } catch { /* noop */ } };

  return (
    <div className="fixed inset-0 z-[75] bg-gray-100 flex flex-col">
      <div className="bg-gray-900 text-white px-4 py-3 flex items-center justify-between shadow-md">
        <span className="font-bold">{titulo}</span>
        <button onClick={onClose} className="p-1.5 rounded-lg bg-gray-800" aria-label="Fechar">
          <X className="w-5 h-5" />
        </button>
      </div>

      {dados && (dados.semPreco.length > 0 || dados.semFoto.length > 0) && (
        <div className="px-4 py-2 text-xs bg-amber-50 text-amber-800 border-b border-amber-200 space-y-0.5">
          {dados.semPreco.length > 0 && (
            <div>⚠ {dados.semPreco.length} sem preço ideal — sai como "Sob consulta": {dados.semPreco.join(", ")}</div>
          )}
          {dados.semFoto.length > 0 && (
            <div>⚠ {dados.semFoto.length} sem foto — sai com placeholder: {dados.semFoto.join(", ")}</div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto p-3">
        <div ref={areaRef} className="w-full">
          {loading && (
            <div className="mt-10 flex flex-col items-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
              {progresso.total > 1 && <span>{progresso.feitas}/{progresso.total} produtos</span>}
            </div>
          )}
          {!loading && erro && <p className="mt-10 text-sm text-red-600 text-center">{erro}</p>}
          {!loading && dados && (
            // O wrapper reserva o tamanho JÁ escalado (transform não afeta layout).
            <div className="mx-auto bg-white shadow-lg"
              style={{ width: A4_W * escala, height: A4_H * itens.length * escala }}>
              <iframe title="Prévia do orçamento" srcDoc={dados.html} scrolling="no"
                style={{
                  width: A4_W, height: A4_H * itens.length, border: 0,
                  transform: `scale(${escala})`, transformOrigin: "0 0",
                }} />
            </div>
          )}
        </div>
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
