import React, { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { ALL_STATUS, CLASSE_STYLE, fmtBRL, statusIdx, LOTE_SEM } from "../lib/model";
import { pendenteMedida } from "../lib/medidas";
import { Loader2, Ruler, ChevronRight } from "lucide-react";

export default function Dashboard({ lotes, onGoFiltered, refreshKey }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    (async () => {
      // Busca todos os itens (colunas leves) para agregar no cliente.
      // O PostgREST limita cada resposta a 1.000 linhas, então paginamos
      // com .range() até trazer tudo (senão o total trava em 1.000).
      const PAGE = 1000;
      let data = [];
      for (let from = 0; ; from += PAGE) {
        const { data: chunk, error } = await supabase
          .from("itens").select("lote,classe,status,preco_sugerido,valor_vendido,medidas_fonte")
          .order("sku").range(from, from + PAGE - 1);
        if (error || !chunk) break;
        data = data.concat(chunk);
        if (chunk.length < PAGE) break;
      }
      if (!data.length) return;
      const byStatus = {}, byClasse = {}, byLote = {};
      let valSug = 0, valVendido = 0, pendMedida = 0;
      for (const it of data) {
        byStatus[it.status] = (byStatus[it.status] || 0) + 1;
        if (pendenteMedida(it)) pendMedida++;
        const c = (byClasse[it.classe] = byClasse[it.classe] || { n: 0, val: 0, done: 0 });
        c.n++; c.val += Number(it.preco_sugerido) || 0;
        const done = statusIdx(it.status) >= 1 || it.status === "DESCARTE";
        if (done) c.done++;
        const l = (byLote[it.lote] = byLote[it.lote] || { n: 0, done: 0, val: 0 });
        l.n++; l.val += Number(it.preco_sugerido) || 0; if (done) l.done++;
        valSug += Number(it.preco_sugerido) || 0;
        if (it.status === "VENDIDO") valVendido += Number(it.valor_vendido) || 0;
      }
      setStats({ byStatus, byClasse, byLote, valSug, valVendido, pendMedida, total: data.length });
    })();
  }, [refreshKey]);

  if (!stats) return <div className="py-20 text-center"><Loader2 className="w-7 h-7 animate-spin text-orange-500 mx-auto" /></div>;

  const catalogados = stats.total - (stats.byStatus["A_CATALOGAR"] || 0);
  const pct = stats.total ? Math.round((catalogados / stats.total) * 100) : 0;
  const loteList = lotes
    .map((l) => ({ ...l, ...(stats.byLote[l.lote] || { n: 0, done: 0, val: 0 }) }))
    .sort((a, b) => b.val - a.val);
  // Itens sem lote (lote=null): vira a chave "null" no agregador.
  const semLote = stats.byLote["null"];
  if (semLote) loteList.unshift({ lote: LOTE_SEM, referencia: "Sem lote", ...semLote });

  return (
    <div className="px-4 pt-4 pb-24 space-y-4">
      <div className="bg-gray-900 rounded-2xl p-5 text-white">
        <p className="text-xs uppercase tracking-widest text-gray-400 font-semibold">Progresso da catalogação</p>
        <div className="flex items-end gap-3 mt-1">
          <span className="text-4xl font-bold">{pct}%</span>
          <span className="text-sm text-gray-300 pb-1">{catalogados.toLocaleString("pt-BR")} de {stats.total.toLocaleString("pt-BR")} itens</span>
        </div>
        <div className="h-2.5 bg-gray-700 rounded-full mt-3 overflow-hidden">
          <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
          <div className="bg-gray-800 rounded-xl p-3"><p className="text-gray-400 text-xs">Venda sugerida (catálogo)</p><p className="font-bold text-orange-400">{fmtBRL(stats.valSug)}</p></div>
          <div className="bg-gray-800 rounded-xl p-3"><p className="text-gray-400 text-xs">Já vendido</p><p className="font-bold text-emerald-400">{fmtBRL(stats.valVendido)}</p></div>
        </div>
      </div>

      {stats.pendMedida > 0 && (
        <button onClick={() => onGoFiltered({ pendMedida: true })}
          className="w-full bg-white rounded-2xl border border-gray-200 p-4 flex items-center gap-3 text-left active:bg-gray-50">
          <span className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0"><Ruler className="w-4.5 h-4.5" /></span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800">{stats.pendMedida.toLocaleString("pt-BR")} itens p/ medir</p>
            <p className="text-xs text-gray-400">Pendentes de medição/pesagem (estimados ou não medidos)</p>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
        </button>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">Funil de status</h3>
        <div className="space-y-1.5">
          {ALL_STATUS.map((s) => {
            const n = stats.byStatus[s.id] || 0;
            const w = stats.total ? Math.max(2, (n / stats.total) * 100) : 0;
            return (
              <button key={s.id} onClick={() => onGoFiltered({ status: s.id })} className="w-full flex items-center gap-2">
                <span className="text-xs text-gray-600 w-28 text-left truncate">{s.label}</span>
                <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
                  <div className={`h-full rounded ${s.id === "DESCARTE" ? "bg-red-300" : s.id === "VENDIDO" ? "bg-emerald-500" : "bg-orange-400"}`} style={{ width: `${w}%`, opacity: n ? 1 : 0.2 }} />
                </div>
                <span className="text-xs font-bold text-gray-700 w-12 text-right">{n.toLocaleString("pt-BR")}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">Onde está o dinheiro (por classe)</h3>
        <div className="space-y-2">
          {["A+", "A", "B", "C", "D", "E"].map((c) => {
            const d = stats.byClasse[c]; if (!d) return null;
            return (
              <button key={c} onClick={() => onGoFiltered({ classe: c })} className="w-full flex items-center gap-3">
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${CLASSE_STYLE[c]}`}>{c}</span>
                <div className="flex-1 text-left">
                  <p className="text-sm font-semibold text-gray-800">{fmtBRL(d.val)}</p>
                  <p className="text-xs text-gray-400">{d.n} itens · {d.done} processados</p>
                </div>
                <span className="text-xs font-bold text-gray-500">{d.n ? Math.round((d.done / d.n) * 100) : 0}%</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">Lotes (por valor sugerido)</h3>
        <div className="space-y-2.5">
          {loteList.map((l) => {
            const p = l.n ? Math.round((l.done / l.n) * 100) : 0;
            return (
              <button key={l.lote} onClick={() => onGoFiltered({ lote: String(l.lote) })} className="w-full text-left">
                <div className="flex justify-between text-sm">
                  <span className="font-semibold text-gray-800">{l.lote === LOTE_SEM ? "Sem lote" : `Lote ${l.lote}`}</span>
                  <span className="text-gray-500">{fmtBRL(l.val)} · {l.done}/{l.n}</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full mt-1 overflow-hidden"><div className="h-full bg-gray-800 rounded-full" style={{ width: `${p}%` }} /></div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
