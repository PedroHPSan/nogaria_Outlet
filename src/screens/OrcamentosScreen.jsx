// Orçamentos (venda assistida): lista por status e ações (enviar, reservar 48 h,
// confirmar venda, cancelar). Transições validadas em orcamentosCore.
import React, { useCallback, useEffect, useState } from "react";
import { X, Loader2, Search, Copy, Check, AlertTriangle } from "lucide-react";
import {
  listarOrcamentos, marcarEnviado, reservarOrcamento, cancelarOrcamento, confirmarVenda, linkOrcamento,
} from "../lib/orcamentos";
import { STATUS_ORC, statusEfetivo, totais, mensagemCliente, podeTransitar } from "../lib/orcamentosCore";
import { fmtBRL } from "../lib/model";

const COR = {
  RASCUNHO: "bg-gray-100 text-gray-700", ENVIADO: "bg-sky-100 text-sky-700", RESERVADO: "bg-amber-100 text-amber-700",
  VENDIDO: "bg-emerald-100 text-emerald-700", CANCELADO: "bg-red-100 text-red-700", EXPIRADO: "bg-gray-200 text-gray-500",
};

export default function OrcamentosScreen({ user, onClose, onMudou }) {
  const [lista, setLista] = useState(null);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [erro, setErro] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const [copiado, setCopiado] = useState(null);

  const carregar = useCallback(async () => {
    try { setErro(null); setLista(await listarOrcamentos({ status, q })); }
    catch (e) { setErro(e.message || String(e)); setLista([]); }
  }, [status, q]);
  useEffect(() => { const t = setTimeout(carregar, 250); return () => clearTimeout(t); }, [carregar]);

  const agir = async (orc, fn) => {
    setOcupado(orc.id); setErro(null);
    try { await fn(); await carregar(); onMudou?.(); }
    catch (e) { setErro(e.message || String(e)); }
    finally { setOcupado(null); }
  };

  const copiar = async (orc) => {
    const msg = mensagemCliente(orc, linkOrcamento(orc.slug));
    try { await navigator.clipboard.writeText(msg); setCopiado(orc.id); setTimeout(() => setCopiado(null), 1800); } catch { /* sem clipboard */ }
    if (orc.status === "RASCUNHO") await agir(orc, () => marcarEnviado(orc));
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col">
      <div className="bg-gray-900 text-white px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-lg">Orçamentos</h2>
          <button onClick={onClose} aria-label="Fechar"><X className="w-6 h-6 text-gray-300" /></button>
        </div>
        <div className="mt-2 relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por código ou cliente"
            className="w-full rounded-lg bg-gray-800 text-sm pl-9 pr-3 py-2 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>
        <div className="mt-2 flex gap-1.5 overflow-x-auto">
          {["", ...STATUS_ORC].map((s) => (
            <button key={s || "todos"} onClick={() => setStatus(s)}
              className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${status === s ? "bg-orange-500 text-white" : "bg-gray-800 text-gray-300"}`}>
              {s ? s[0] + s.slice(1).toLowerCase() : "Todos"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {erro && <p className="text-sm text-red-600 flex items-start gap-1.5"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {erro}</p>}
        {!lista && <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</p>}
        {lista?.length === 0 && !erro && <p className="text-sm text-gray-500 text-center mt-10">Nenhum orçamento. Salve um pela seleção de itens (botão Orçamento → Salvar).</p>}
        {lista?.map((orc) => {
          const ef = statusEfetivo(orc);
          const t = totais(orc.itens, orc.desconto_pct);
          const pode = (para) => ef === orc.status && podeTransitar(orc.status, para);
          return (
            <div key={orc.id} className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-gray-900">{orc.codigo}</span>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${COR[ef]}`}>{ef}</span>
                <span className="ml-auto font-bold text-gray-900">{fmtBRL(t.total)}</span>
              </div>
              <p className="text-xs text-gray-600">
                {orc.cliente_nome || "Sem cliente"} · {orc.itens.length} item(ns){t.pct ? ` · −${t.pct}%` : ""} · válido até {new Date(orc.validade).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </p>
              <p className="text-xs text-gray-400 truncate">{orc.itens.map((i) => i.sku).join(", ")}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                {ef !== "CANCELADO" && ef !== "VENDIDO" && (
                  <button disabled={ocupado === orc.id} onClick={() => copiar(orc)} className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-semibold flex items-center gap-1">
                    {copiado === orc.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />} {copiado === orc.id ? "Copiado" : "Copiar mensagem"}
                  </button>
                )}
                {pode("RESERVADO") && <button disabled={ocupado === orc.id} onClick={() => agir(orc, () => reservarOrcamento(orc, user))} className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-bold">Reservar 48 h</button>}
                {pode("VENDIDO") && <button disabled={ocupado === orc.id} onClick={() => window.confirm(`Confirmar venda de ${orc.itens.length} item(ns) por ${fmtBRL(t.total)}?`) && agir(orc, () => confirmarVenda(orc, user))} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold">Confirmar venda</button>}
                {pode("CANCELADO") && <button disabled={ocupado === orc.id} onClick={() => window.confirm("Cancelar o orçamento e liberar a reserva?") && agir(orc, () => cancelarOrcamento(orc))} className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs font-semibold">Cancelar</button>}
                {ocupado === orc.id && <Loader2 className="w-4 h-4 animate-spin text-orange-500 self-center" />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
