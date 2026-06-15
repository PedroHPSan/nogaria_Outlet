import React, { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { supabase } from "../lib/supabase";
import { ALL_STATUS, statusMeta, CLASSE_STYLE, fmtBRL } from "../lib/model";
import { buildProductLabel, buildBoxLabel } from "../lib/labels";
import { Search, Filter, ChevronRight, Box, Loader2, Printer, CheckSquare, Square, Boxes, X } from "lucide-react";

// Lazy: a tela de etiquetas só carrega (qrcode/jspdf) ao imprimir.
const LabelPrint = React.lazy(() => import("../components/labels/LabelPrint"));

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

  // Seleção em massa + impressão de etiquetas
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [printLabels, setPrintLabels] = useState(null);
  const [boxPicker, setBoxPicker] = useState(false);

  const toggleSel = (sku) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(sku) ? n.delete(sku) : n.add(sku);
      return n;
    });
  const allOnPageSelected = itens.length > 0 && itens.every((i) => selected.has(i.sku));
  const toggleAllOnPage = () =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (allOnPageSelected) itens.forEach((i) => n.delete(i.sku));
      else itens.forEach((i) => n.add(i.sku));
      return n;
    });
  const sairSelecao = () => { setSelectMode(false); setSelected(new Set()); };

  const imprimirSelecionados = () => {
    const escolhidos = itens.filter((i) => selected.has(i.sku));
    if (!escolhidos.length) return;
    setPrintLabels(escolhidos.map(buildProductLabel));
  };

  const abrirItem = (it) => {
    if (selectMode) toggleSel(it.sku);
    else onOpen(it);
  };

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
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-gray-400">
            {count.toLocaleString("pt-BR")} itens
            {selectMode && ` · ${selected.size} selecionado(s)`}
          </p>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setBoxPicker(true)}
              className="flex items-center gap-1 text-xs font-semibold text-gray-600 bg-white border border-gray-300 rounded-lg px-2 py-1">
              <Boxes className="w-3.5 h-3.5" /> Caixa/Mala
            </button>
            {selectMode ? (
              <>
                <button onClick={toggleAllOnPage}
                  className="text-xs font-semibold text-gray-600 bg-white border border-gray-300 rounded-lg px-2 py-1">
                  {allOnPageSelected ? "Limpar" : "Todos"}
                </button>
                <button onClick={sairSelecao}
                  className="text-xs font-semibold text-gray-600 bg-white border border-gray-300 rounded-lg px-2 py-1">
                  Cancelar
                </button>
              </>
            ) : (
              <button onClick={() => setSelectMode(true)}
                className="flex items-center gap-1 text-xs font-semibold text-white bg-orange-500 rounded-lg px-2 py-1">
                <Printer className="w-3.5 h-3.5" /> Etiquetas
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="px-3 pt-2 space-y-1.5">
        {itens.map((it) => {
          const sm = statusMeta(it.status);
          const sel = selected.has(it.sku);
          return (
            <button key={it.sku} onClick={() => abrirItem(it)}
              className={`w-full text-left bg-white rounded-xl border px-3 py-2.5 flex items-center gap-3 active:bg-gray-100 ${sel ? "border-orange-500 ring-1 ring-orange-300" : "border-gray-200"}`}>
              {selectMode && (
                sel
                  ? <CheckSquare className="w-5 h-5 text-orange-500 flex-shrink-0" />
                  : <Square className="w-5 h-5 text-gray-300 flex-shrink-0" />
              )}
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

      {/* Barra de impressão em massa (acima da navegação inferior) */}
      {selectMode && selected.size > 0 && (
        <div className="fixed bottom-14 inset-x-0 z-30 px-3">
          <div className="max-w-lg mx-auto">
            <button onClick={imprimirSelecionados}
              className="w-full rounded-xl py-3.5 font-bold bg-gray-900 text-white shadow-lg flex items-center justify-center gap-2">
              <Printer className="w-4 h-4" /> Imprimir {selected.size} etiqueta(s)
            </button>
          </div>
        </div>
      )}

      {boxPicker && (
        <BoxPicker
          onClose={() => setBoxPicker(false)}
          onPick={(caixaNum, lista) => { setPrintLabels([buildBoxLabel(caixaNum, lista)]); setBoxPicker(false); }}
        />
      )}

      {printLabels && (
        <Suspense fallback={<div className="fixed inset-0 z-[70] bg-white flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>}>
          <LabelPrint labels={printLabels} onClose={() => setPrintLabels(null)} />
        </Suspense>
      )}
    </div>
  );
}

// Seletor de caixa/mala: agrupa os itens por caixa_num e gera a etiqueta externa.
function BoxPicker({ onClose, onPick }) {
  const [loading, setLoading] = useState(true);
  const [grupos, setGrupos] = useState([]); // [{ caixaNum, itens: [...] }]
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("itens")
        .select("sku, caixa_num, destino, local_fisico, preco_ideal, preco_sugerido, lote")
        .not("caixa_num", "is", null)
        .order("caixa_num");
      const map = new Map();
      for (const it of data || []) {
        const k = (it.caixa_num || "").trim();
        if (!k) continue;
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(it);
      }
      setGrupos([...map.entries()].map(([caixaNum, itens]) => ({ caixaNum, itens })));
      setLoading(false);
    })();
  }, []);

  const filtrados = q.trim()
    ? grupos.filter((g) => g.caixaNum.toLowerCase().includes(q.trim().toLowerCase()))
    : grupos;

  return (
    <div className="fixed inset-0 z-[65] bg-gray-100 flex flex-col">
      <div className="bg-gray-900 text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-2">
          <Boxes className="w-5 h-5 text-orange-400" />
          <span className="font-bold">Etiqueta de caixa / mala</span>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg bg-gray-800" aria-label="Fechar">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="px-4 py-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar caixa/mala (ex.: CX-SP-001)…"
          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-base bg-white focus:outline-none focus:ring-2 focus:ring-orange-500" />
      </div>
      <div className="flex-1 overflow-auto px-3 pb-6 space-y-1.5">
        {loading && <div className="py-10 text-center"><Loader2 className="w-6 h-6 animate-spin text-orange-500 mx-auto" /></div>}
        {!loading && !filtrados.length && (
          <p className="text-sm text-gray-400 text-center py-10">Nenhuma caixa/mala cadastrada (campo "Caixa nº" dos itens).</p>
        )}
        {filtrados.map((g) => (
          <button key={g.caixaNum} onClick={() => onPick(g.caixaNum, g.itens)}
            className="w-full text-left bg-white rounded-xl border border-gray-200 px-3 py-2.5 flex items-center gap-3 active:bg-gray-100">
            <Boxes className="w-5 h-5 text-gray-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-mono text-sm font-bold text-gray-900">{g.caixaNum}</span>
              <p className="text-xs text-gray-500">{g.itens.length} item(ns) · {g.itens[0]?.local_fisico || "—"}</p>
            </div>
            <Printer className="w-4 h-4 text-gray-300 flex-shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}
