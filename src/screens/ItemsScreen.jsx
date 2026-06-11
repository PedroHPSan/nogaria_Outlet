import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import { ALL_STATUS, statusMeta, CLASSE_STYLE, fmtBRL } from "../lib/model";
import { Search, Filter, ChevronRight, Box, Loader2 } from "lucide-react";

const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base bg-white focus:outline-none focus:ring-2 focus:ring-orange-500";
const PAGE = 50;

export default function ItemsScreen({ lotes, initialFilter, onOpen, refreshKey }) {
  const [q, setQ] = useState("");
  const [fLote, setFLote] = useState(initialFilter?.lote || "");
  const [fClasse, setFClasse] = useState(initialFilter?.classe || "");
  const [fStatus, setFStatus] = useState(initialFilter?.status || "");
  const [showFilters, setShowFilters] = useState(!!initialFilter);
  const [itens, setItens] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const debounce = useRef();

  const buscar = useCallback(async (reset) => {
    setLoading(true);
    const from = reset ? 0 : page * PAGE;
    let query = supabase.from("itens").select("*", { count: "exact" });
    if (fLote) query = query.eq("lote", Number(fLote));
    if (fClasse) query = query.eq("classe", fClasse);
    if (fStatus) query = query.eq("status", fStatus);
    if (q.trim()) query = query.or(`sku.ilike.%${q.trim()}%,produto.ilike.%${q.trim()}%`);
    query = query.order("sku").range(from, from + PAGE - 1);
    const { data, count: c } = await query;
    setCount(c || 0);
    setItens((prev) => (reset ? data || [] : [...prev, ...(data || [])]));
    setLoading(false);
  }, [q, fLote, fClasse, fStatus, page]);

  // busca com debounce ao mudar filtros/texto
  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { setPage(0); buscar(true); }, 250);
    return () => clearTimeout(debounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, fLote, fClasse, fStatus, refreshKey]);

  const carregarMais = () => { setPage((p) => p + 1); };
  useEffect(() => { if (page > 0) buscar(false); /* eslint-disable-next-line */ }, [page]);

  const nActive = [fLote, fClasse, fStatus].filter(Boolean).length;

  return (
    <div className="pb-24">
      <div className="sticky top-14 z-10 bg-gray-50 px-4 pt-3 pb-2 border-b border-gray-200">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar SKU ou produto…"
              className="w-full rounded-xl border border-gray-300 pl-9 pr-3 py-2.5 text-base bg-white focus:outline-none focus:ring-2 focus:ring-orange-500" />
          </div>
          <button onClick={() => setShowFilters(!showFilters)}
            className={`px-3 rounded-xl border flex items-center gap-1 text-sm font-semibold ${nActive ? "bg-orange-500 text-white border-orange-500" : "bg-white border-gray-300 text-gray-600"}`}>
            <Filter className="w-4 h-4" />{nActive || ""}
          </button>
        </div>
        {showFilters && (
          <div className="mt-2 space-y-2">
            <select value={fLote} onChange={(e) => setFLote(e.target.value)} className={inputCls}>
              <option value="">Todos os lotes</option>
              {lotes.map((l) => <option key={l.lote} value={String(l.lote)}>Lote {l.lote} — {l.referencia || ""}</option>)}
            </select>
            <div className="flex gap-2">
              <select value={fClasse} onChange={(e) => setFClasse(e.target.value)} className={inputCls}>
                <option value="">Todas as classes</option>
                {["A+", "A", "B", "C", "D", "E"].map((c) => <option key={c} value={c}>Classe {c}</option>)}
              </select>
              <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={inputCls}>
                <option value="">Todos os status</option>
                {ALL_STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
          </div>
        )}
        <p className="text-xs text-gray-400 mt-2">{count.toLocaleString("pt-BR")} itens</p>
      </div>

      <div className="px-3 pt-2 space-y-1.5">
        {itens.map((it) => {
          const sm = statusMeta(it.status);
          return (
            <button key={it.sku} onClick={() => onOpen(it)}
              className="w-full text-left bg-white rounded-xl border border-gray-200 px-3 py-2.5 flex items-center gap-3 active:bg-gray-100">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${CLASSE_STYLE[it.classe] || "bg-gray-300 text-white"}`}>{it.classe}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-gray-900">{it.sku}</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${sm.color}`}>{sm.short}</span>
                </div>
                <p className="text-sm text-gray-600 truncate">{it.produto}</p>
                <p className="text-xs text-gray-400">Lote {it.lote} · {fmtBRL(it.preco_ideal || it.preco_sugerido)} · {it.destino}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
            </button>
          );
        })}
        {loading && <div className="py-6 text-center"><Loader2 className="w-6 h-6 animate-spin text-orange-500 mx-auto" /></div>}
        {!loading && itens.length < count && (
          <button onClick={carregarMais} className="w-full py-3 text-sm font-semibold text-orange-600">
            Carregar mais ({(count - itens.length).toLocaleString("pt-BR")} restantes)
          </button>
        )}
        {!loading && !itens.length && (
          <div className="text-center py-16 text-gray-400">
            <Box className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Nenhum item com esses filtros.</p>
          </div>
        )}
      </div>
    </div>
  );
}
