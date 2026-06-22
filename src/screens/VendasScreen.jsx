import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { fmtBRL, statusMeta, CLASSE_STYLE, LOTE_SEM } from "../lib/model";
import { carregarResultadoLotes, carregarVendasPorCanal, marcarEntregue } from "../lib/vendas";
import { Loader2, ChevronRight, Receipt, Truck, Check, TrendingUp, Package, Store } from "lucide-react";

const PAGE = 50;

// Data curta (dd/mm) de um timestamptz, ou "—".
const fmtData = (ts) => (ts ? new Date(ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "—");

export default function VendasScreen({ lotes = [], onOpen, user, refreshKey, onGoFiltered }) {
  const [resultado, setResultado] = useState(null); // linhas de vw_lote_resultado
  const [porCanal, setPorCanal] = useState(null); // vendas agregadas por método (canal_venda)
  const [itens, setItens] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [aba, setAba] = useState("entregar"); // "entregar" | "entregues"
  const [marcando, setMarcando] = useState(null); // sku em entrega

  const refLote = useCallback((lote) => {
    const l = lotes.find((x) => String(x.lote) === String(lote));
    return l?.referencia;
  }, [lotes]);

  // Resultado por lote (view) — recarrega a cada mudança em itens (realtime → refreshKey).
  useEffect(() => {
    let cancel = false;
    carregarResultadoLotes()
      .then((rows) => { if (!cancel) setResultado(rows.filter((r) => r.n_itens > 0)); })
      .catch(() => { if (!cancel) setResultado([]); });
    return () => { cancel = true; };
  }, [refreshKey]);

  // Vendas por método de venda (canal_venda) — agregação no cliente.
  useEffect(() => {
    let cancel = false;
    carregarVendasPorCanal()
      .then((rows) => { if (!cancel) setPorCanal(rows); })
      .catch(() => { if (!cancel) setPorCanal([]); });
    return () => { cancel = true; };
  }, [refreshKey]);

  // Lista de itens vendidos/entregues conforme a aba.
  const buscar = useCallback(async (reset) => {
    setLoading(true);
    const from = reset ? 0 : page * PAGE;
    let query = supabase.from("itens").select("*", { count: "exact" });
    if (aba === "entregar") query = query.eq("status", "VENDIDO").is("entregue_em", null);
    else query = query.eq("status", "ENTREGUE");
    query = query.order("vendido_em", { ascending: false, nullsFirst: false }).range(from, from + PAGE - 1);
    const { data, count: c } = await query;
    setCount(c || 0);
    setItens((prev) => (reset ? data || [] : [...prev, ...(data || [])]));
    setLoading(false);
  }, [aba, page]);

  useEffect(() => {
    setPage(0); buscar(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba, refreshKey]);
  useEffect(() => {
    if (page > 0) buscar(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const entregar = async (sku) => {
    setMarcando(sku);
    try {
      await marcarEntregue(sku, user);
      // some da lista "a entregar" na hora; o realtime de itens confirma via refreshKey.
      setItens((arr) => arr.filter((it) => it.sku !== sku));
      setCount((c) => Math.max(0, c - 1));
    } catch (e) {
      alert("Falha ao marcar como entregue: " + (e?.message || e));
    } finally {
      setMarcando(null);
    }
  };

  // Totais consolidados (todos os lotes) para o cabeçalho.
  const tot = (resultado || []).reduce(
    (a, r) => ({
      receita: a.receita + Number(r.receita_bruta || 0),
      lucro: a.lucro + Number(r.lucro_realizado || 0),
      custo: a.custo + Number(r.custo_total || 0),
    }),
    { receita: 0, lucro: 0, custo: 0 }
  );

  return (
    <div className="px-4 pt-4 pb-24 space-y-4">
      {/* Resumo consolidado */}
      <div className="bg-gray-900 rounded-2xl p-5 text-white">
        <p className="text-xs uppercase tracking-widest text-gray-400 font-semibold flex items-center gap-1.5">
          <Receipt className="w-3.5 h-3.5" /> Vendas realizadas
        </p>
        <div className="grid grid-cols-3 gap-3 mt-3 text-sm">
          <div className="bg-gray-800 rounded-xl p-3"><p className="text-gray-400 text-xs">Receita bruta</p><p className="font-bold text-emerald-400">{fmtBRL(tot.receita)}</p></div>
          <div className="bg-gray-800 rounded-xl p-3"><p className="text-gray-400 text-xs">Lucro realizado</p><p className={`font-bold ${tot.lucro < 0 ? "text-red-400" : "text-emerald-400"}`}>{fmtBRL(tot.lucro)}</p></div>
          <div className="bg-gray-800 rounded-xl p-3"><p className="text-gray-400 text-xs">Custo pago</p><p className="font-bold text-orange-400">{fmtBRL(tot.custo)}</p></div>
        </div>
      </div>

      {/* Resultado por lote (breakeven + lucro) */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3 flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5" /> Resultado por lote
        </h3>
        {resultado == null ? (
          <div className="py-6 text-center"><Loader2 className="w-6 h-6 animate-spin text-orange-500 mx-auto" /></div>
        ) : !resultado.length ? (
          <p className="text-sm text-gray-400 py-6 text-center">Sem lotes com itens ainda.</p>
        ) : (
          <div className="space-y-3">
            {resultado.map((r) => {
              const pct = Math.round(Number(r.pct_breakeven || 0) * 100);
              const cobriu = pct >= 100;
              return (
                <button key={String(r.lote)} onClick={() => onGoFiltered?.({ lote: r.lote == null ? LOTE_SEM : String(r.lote) })}
                  className="w-full text-left active:opacity-70">
                  <div className="flex justify-between items-baseline text-sm">
                    <span className="font-semibold text-gray-800">
                      {r.lote == null ? "Sem lote" : `Lote ${r.lote}`}
                      {refLote(r.lote) && <span className="text-gray-400 font-normal"> · {refLote(r.lote)}</span>}
                    </span>
                    <span className={`font-bold ${Number(r.lucro_realizado) < 0 ? "text-red-600" : "text-emerald-600"}`}>
                      {fmtBRL(r.lucro_realizado)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${cobriu ? "bg-emerald-500" : "bg-orange-400"}`}
                        style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                    <span className={`text-xs font-bold w-12 text-right ${cobriu ? "text-emerald-600" : "text-gray-500"}`}>{pct}%</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-400 mt-1">
                    <span>{fmtBRL(r.receita_bruta)} de {fmtBRL(r.custo_total)} pago</span>
                    <span>{r.n_vendidos}/{r.n_itens} vend. · {r.n_entregues} entreg.</span>
                  </div>
                  {Number(r.estoque_potencial) > 0 && (
                    <p className="text-[11px] text-gray-400 mt-0.5">Estoque a realizar: {fmtBRL(r.estoque_potencial)}</p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Por método de venda */}
      {porCanal && porCanal.length > 0 && (() => {
        const maxTotal = Math.max(...porCanal.map((c) => c.total), 1);
        return (
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3 flex items-center gap-1.5">
              <Store className="w-3.5 h-3.5" /> Por método de venda
            </h3>
            <div className="space-y-2.5">
              {porCanal.map((c) => (
                <div key={c.canal} className="w-full">
                  <div className="flex justify-between items-baseline text-sm">
                    <span className="font-semibold text-gray-800">{c.canal}</span>
                    <span className="text-gray-500">{fmtBRL(c.total)} · {c.n} venda{c.n === 1 ? "" : "s"}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full mt-1 overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.max(4, (c.total / maxTotal) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Vendas / a entregar */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
            <Truck className="w-3.5 h-3.5" /> Entregas
          </h3>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
            {[["entregar", "A entregar"], ["entregues", "Entregues"]].map(([id, t]) => (
              <button key={id} onClick={() => setAba(id)}
                className={`px-3 py-1 rounded-md text-xs font-semibold ${aba === id ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          {itens.map((it) => {
            const sm = statusMeta(it.status);
            return (
              <div key={it.sku} className="bg-white rounded-xl border border-gray-200 px-3 py-2.5 flex items-center gap-3">
                <button onClick={() => onOpen(it)} className="flex items-center gap-3 flex-1 min-w-0 text-left active:opacity-70">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${CLASSE_STYLE[it.classe] || "bg-gray-300 text-white"}`}>{it.classe}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-gray-900">{it.sku}</span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${sm.color}`}>{sm.short}</span>
                    </div>
                    <p className="text-sm text-gray-600 truncate">{it.produto}</p>
                    <div className="flex items-center gap-1.5 flex-wrap text-xs text-gray-400">
                      <span className="font-semibold text-emerald-600">{fmtBRL(it.valor_vendido)}</span>
                      {it.canal_venda && <span className="bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">{it.canal_venda}</span>}
                      <span>{aba === "entregues" ? `entregue ${fmtData(it.entregue_em)}` : `vendido ${fmtData(it.vendido_em)}`}</span>
                    </div>
                  </div>
                </button>
                {aba === "entregar" ? (
                  <button onClick={() => entregar(it.sku)} disabled={marcando === it.sku}
                    className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-bold text-white bg-teal-700 rounded-lg px-2.5 py-2 active:bg-teal-800 disabled:opacity-50"
                    title="Marcar como entregue">
                    {marcando === it.sku ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Entregue
                  </button>
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
                )}
              </div>
            );
          })}
          {loading && <div className="py-6 text-center"><Loader2 className="w-6 h-6 animate-spin text-orange-500 mx-auto" /></div>}
          {!loading && itens.length < count && (
            <button onClick={() => setPage((p) => p + 1)} className="w-full py-3 text-sm font-semibold text-orange-600">
              Carregar mais ({(count - itens.length).toLocaleString("pt-BR")} restantes)
            </button>
          )}
          {!loading && !itens.length && (
            <div className="text-center py-12 text-gray-400">
              <Package className="w-9 h-9 mx-auto mb-2 opacity-40" />
              <p className="text-sm">{aba === "entregar" ? "Nada pendente de entrega." : "Nenhuma entrega registrada."}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
