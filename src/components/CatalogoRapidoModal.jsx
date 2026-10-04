// Catálogo rápido: gera o PDF de catálogo a partir de uma seleção (skus) ou de
// uma sala (salaId), sem passar pelos filtros da aba Catálogo. Só entram itens
// com preço de venda, condição mapeada e em estoque (regra do catálogo).
import React, { useEffect, useRef, useState } from "react";
import { X, Loader2, Printer, AlertTriangle } from "lucide-react";
import { listarItensCatalogo, resumoSelecao } from "../lib/catalogo";
import { gerarCatalogoDeItens } from "../lib/catalogoGerar";
import { imprimirPortfolio } from "../lib/portfolio";

const edicaoAtual = () =>
  new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

export default function CatalogoRapidoModal({ skus, salaId, titulo: tituloInicial = "Catálogo de Produtos", onClose }) {
  const [itens, setItens] = useState(null);
  const [resumo, setResumo] = useState(null);
  const [erro, setErro] = useState(null);
  const [titulo, setTitulo] = useState(tituloInicial);
  const [comFoto, setComFoto] = useState(true);
  const [mostrarPreco, setMostrarPreco] = useState(true);
  const [comQr, setComQr] = useState(true);
  const [gerando, setGerando] = useState(false);
  const [progresso, setProgresso] = useState(null);
  const abortRef = useRef(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const lista = await listarItensCatalogo(salaId ? { salaId } : { skus });
        if (cancel) return;
        setItens(lista);
        if (skus) setResumo(resumoSelecao(skus, lista));
      } catch (e) {
        if (!cancel) setErro(e.message || "Falha ao carregar os itens.");
      }
    })();
    return () => { cancel = true; };
  }, [skus, salaId]);

  const gerar = async () => {
    if (!itens?.length) return;
    setGerando(true);
    setErro(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const html = await gerarCatalogoDeItens(itens, {
        titulo, edicao: edicaoAtual(), comFoto, mostrarPreco, comQr,
        signal: ctrl.signal, onProgress: setProgresso,
      });
      await imprimirPortfolio(html);
    } catch (e) {
      if (e?.message !== "cancelado") setErro(e.message || "Falha ao gerar o catálogo.");
    } finally {
      abortRef.current = null;
      setProgresso(null);
      setGerando(false);
    }
  };

  const fechar = () => { abortRef.current?.abort(); onClose(); };

  const Opcao = ({ valor, onChange, children }) => (
    <label className="flex items-center gap-2 text-sm text-gray-700">
      <input type="checkbox" checked={valor} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 accent-orange-500" />
      {children}
    </label>
  );

  return (
    <div className="fixed inset-0 z-[75] bg-black/50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl p-4 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Catálogo em PDF</h2>
          <button onClick={fechar} aria-label="Fechar"><X className="w-6 h-6 text-gray-400" /></button>
        </div>

        {!itens && !erro && (
          <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando itens…</p>
        )}

        {itens && (
          <>
            <p className="text-sm text-gray-700">
              <b>{itens.length}</b> {itens.length === 1 ? "item entra" : "itens entram"} no catálogo.
            </p>
            {resumo?.fora.length > 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 flex gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{resumo.fora.length} ficou de fora (sem preço de venda, sem condição ou fora de estoque): {resumo.fora.slice(0, 8).join(", ")}{resumo.fora.length > 8 ? "…" : ""}</span>
              </p>
            )}
            {itens.length === 0 && (
              <p className="text-sm text-gray-500">Nenhum item elegível. O catálogo exige preço de venda e condição definidos.</p>
            )}

            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título do catálogo"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            <div className="space-y-1.5">
              <Opcao valor={comFoto} onChange={setComFoto}>Incluir fotos</Opcao>
              <Opcao valor={mostrarPreco} onChange={setMostrarPreco}>Mostrar preço</Opcao>
              <Opcao valor={comQr} onChange={setComQr}>QR de WhatsApp em cada item</Opcao>
            </div>

            {progresso && <p className="text-xs text-gray-500">Comprimindo {progresso.feitas} de {progresso.total} fotos</p>}
            <button onClick={gerar} disabled={gerando || !itens.length}
              className="w-full rounded-xl py-3 font-bold bg-orange-500 text-white flex items-center justify-center gap-2 disabled:bg-gray-300 disabled:text-gray-500">
              {gerando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              {gerando ? "Gerando…" : "Gerar PDF"}
            </button>
          </>
        )}

        {erro && <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {erro}</p>}
      </div>
    </div>
  );
}
