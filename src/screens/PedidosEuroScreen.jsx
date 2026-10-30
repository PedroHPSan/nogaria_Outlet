// Pedidos em euros vindos da página pública: confere pelo código que o cliente envia no WhatsApp.
// Vencido (> 24 h) mostra o valor recalculado com a cotação de agora.
import React, { useCallback, useEffect, useState } from "react";
import { X, Loader2, AlertTriangle } from "lucide-react";
import { listarInteresses, marcarInteresse, vencido, eurAgora } from "../lib/interesses";
import { cotacaoEuro } from "../lib/cotacao";
import { fmtEUR, fmtDataCotacao, textoCotacao } from "../lib/precoEuro";
import { fmtBRL } from "../lib/model";

const BSB = { tz: "America/Sao_Paulo" };
const FILTROS = [["ABERTO", "Abertos"], ["ATENDIDO", "Atendidos"], ["", "Todos"]];

export default function PedidosEuroScreen({ onClose }) {
  const [lista, setLista] = useState(null);
  const [filtro, setFiltro] = useState("ABERTO");
  const [cot, setCot] = useState(null);
  const [erro, setErro] = useState(null);

  const carregar = useCallback(async () => {
    try { setErro(null); setLista(await listarInteresses()); } catch (e) { setErro(e.message || String(e)); setLista([]); }
  }, []);
  useEffect(() => { carregar(); cotacaoEuro().then(setCot).catch(() => setCot(false)); }, [carregar]);

  const mudar = async (id, status) => {
    try { await marcarInteresse(id, status); await carregar(); } catch (e) { alert("Falha: " + (e.message || e)); }
  };
  const visiveis = (lista || []).filter((p) => !filtro || p.status === filtro);

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 overflow-y-auto">
      <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <h2 className="font-extrabold text-gray-900">Pedidos em euros</h2>
        <button onClick={onClose} aria-label="Fechar"><X className="w-5 h-5" /></button>
      </div>
      <div className="p-4 space-y-3 max-w-xl mx-auto">
        {cot && <p className="text-xs text-gray-500">{textoCotacao(cot, "pt", BSB)}</p>}
        <div className="flex gap-2">
          {FILTROS.map(([k, rot]) => (
            <button key={k} onClick={() => setFiltro(k)} className={`px-3 py-1 rounded-full text-xs font-bold ${filtro === k ? "bg-orange-500 text-white" : "bg-white border border-gray-200 text-gray-600"}`}>{rot}</button>
          ))}
        </div>
        {erro && <p className="text-sm text-red-600">{erro}</p>}
        {lista === null && <Loader2 className="w-6 h-6 animate-spin text-orange-500" />}
        {lista && visiveis.length === 0 && <p className="text-sm text-gray-500">Nenhum pedido.</p>}
        {visiveis.map((p) => {
          const venc = p.status === "ABERTO" && vencido(p);
          const novo = venc && cot ? eurAgora(p, cot.taxa) : null;
          return (
            <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-mono font-extrabold text-gray-900">#{p.codigo}</span>
                <span className="text-xs text-gray-500">{p.sku} · {p.lang.toUpperCase()} · {fmtDataCotacao(p.criado_em, BSB)}</span>
              </div>
              <p className="text-xl font-extrabold text-[#02477e]">{fmtEUR(p.eur)}</p>
              <p className="text-xs text-gray-500">Base {fmtBRL(p.brl_base)} (+acréscimo) · 1 € = R$ {Number(p.taxa).toFixed(4).replace(".", ",")} ({fmtDataCotacao(p.taxa_em || p.criado_em, BSB)})</p>
              {venc && (
                <p className="text-xs text-amber-800 bg-amber-50 rounded p-2 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> Vencido (24 h).{novo ? ` Recalculado hoje: ${fmtEUR(novo)}` : " Recalcule com a cotação atual."}
                </p>
              )}
              {p.status === "ABERTO" && (
                <div className="flex gap-2 pt-1">
                  <button onClick={() => mudar(p.id, "ATENDIDO")} className="flex-1 rounded-lg bg-emerald-500 text-white text-sm font-bold py-2">Atendido</button>
                  <button onClick={() => mudar(p.id, "DESCARTADO")} className="rounded-lg border border-gray-300 text-sm text-gray-600 px-3">Descartar</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
