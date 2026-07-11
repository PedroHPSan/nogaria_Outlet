import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense } from "react";
import { supabase } from "../lib/supabase";
import { ALL_STATUS, statusMeta, CLASSE_STYLE, fmtBRL, LOTE_SEM, DESTINOS } from "../lib/model";
import { buildProductLabel, buildBoxLabel } from "../lib/labels";
import { primeirasFotos, enviarFoto, marcarFotoFeita } from "../lib/fotos";
import { buscarViasImpressao } from "../lib/printLog";
import { pendenteMedida } from "../lib/medidas";
import { listarCaixas, itensDaCaixa, CAIXA_TIPO, CAIXA_STATUS } from "../lib/caixas";
import { contarACatalogarPorLote } from "../lib/conferencia";
import { Search, Filter, ChevronRight, Box, Loader2, Printer, CheckSquare, Square, Boxes, X, Camera, Images, Ruler, Package, Sparkles, ShoppingCart, ClipboardList } from "lucide-react";
import FotoInputs from "../components/FotoInputs";

// Lazy: a tela de etiquetas só carrega (qrcode/jspdf) ao imprimir.
const LabelPrint = React.lazy(() => import("../components/labels/LabelPrint"));

const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base bg-white focus:outline-none focus:ring-2 focus:ring-orange-500";
const PAGE = 50;
const DESTINO_SEM = "__sem__"; // sentinela: itens sem destino definido (campo nulo)

export default function ItemsScreen({ lotes, initialFilter, onOpen, refreshKey, params, user }) {
  const [q, setQ] = useState("");
  const [fLote, setFLote] = useState(initialFilter?.lote || "");
  const [fClasse, setFClasse] = useState(initialFilter?.classe || "");
  const [fStatus, setFStatus] = useState(initialFilter?.status || "");
  const [fGrupo, setFGrupo] = useState(initialFilter?.grupo || "");
  const [fDestino, setFDestino] = useState(initialFilter?.destino || "");
  const [fPendMedida, setFPendMedida] = useState(!!initialFilter?.pendMedida);
  const [fSemCaixa, setFSemCaixa] = useState(!!initialFilter?.semCaixa);
  const [fSemEtiq, setFSemEtiq] = useState(!!initialFilter?.semEtiqueta);
  const [fSemClasse, setFSemClasse] = useState(!!initialFilter?.semClasse);
  const [fSemFoto, setFSemFoto] = useState(!!initialFilter?.semFoto);
  const [fIaPreco, setFIaPreco] = useState(!!initialFilter?.iaPreco); // precificados pela IA (preco_ref_fonte=IA:claude)
  const [fAptoAmazon, setFAptoAmazon] = useState(!!initialFilter?.aptoAmazon); // aptos a publicar na Amazon (checks bloqueantes do preflight)
  const [showFilters, setShowFilters] = useState(!!initialFilter);
  const [itens, setItens] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [viab, setViab] = useState({}); // sku -> viavel (de vw_precificacao); opcional, não bloqueia
  const [viasMap, setViasMap] = useState({}); // sku -> { vias, ultima } (controle de impressão)
  const [fotos, setFotos] = useState({}); // sku -> url da 1ª foto (miniatura)
  const debounce = useRef();
  const fotoRef = useRef();
  const [escolherFonte, setEscolherFonte] = useState(false);
  const captureSku = useRef(null);
  const [savingFoto, setSavingFoto] = useState(null);

  const catList = useMemo(
    () => Object.keys(params?.grupos || {}).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [params]
  );

  // Seleção em massa + impressão de etiquetas
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [printLabels, setPrintLabels] = useState(null);
  const [boxPicker, setBoxPicker] = useState(false);
  const [catalogarPicker, setCatalogarPicker] = useState(false);
  const [fCaixa, setFCaixa] = useState(initialFilter?.caixa || "");
  const [caixasList, setCaixasList] = useState([]);
  useEffect(() => { listarCaixas().then(setCaixasList).catch(() => {}); }, []);

  // Aplica o filtro status=A_CATALOGAR + lote escolhido no picker de catalogação.
  const escolherCatalogar = (loteValue) => {
    setFStatus("A_CATALOGAR");
    setFLote(loteValue);
    setShowFilters(true);
    setCatalogarPicker(false);
  };

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

  // Foto rápida direto da lista (sem abrir o item).
  const iniciarFoto = (sku) => { captureSku.current = sku; setEscolherFonte(true); };
  const aoSelecionarFoto = async (fileList) => {
    const files = Array.from(fileList || []);
    const sku = captureSku.current;
    if (!files.length || !sku) return;
    setSavingFoto(sku);
    try {
      let primeira = null;
      const base = Date.now();
      for (let i = 0; i < files.length; i++) {
        const nova = await enviarFoto(sku, files[i], base + i);
        if (!primeira) primeira = nova.url;
      }
      await marcarFotoFeita(sku);
      setFotos((prev) => (prev[sku] ? prev : { ...prev, [sku]: primeira }));
      setItens((arr) => arr.map((it) => (it.sku === sku ? { ...it, foto_feita: true } : it)));
    } catch (err) {
      alert("Falha ao enviar a foto. Tente novamente.");
    } finally {
      setSavingFoto(null);
    }
  };

  const buscar = useCallback(async (reset) => {
    setLoading(true);
    const from = reset ? 0 : page * PAGE;
    let query = supabase.from("itens").select("*", { count: "exact" });
    if (fLote === LOTE_SEM) query = query.is("lote", null);
    else if (fLote) query = query.eq("lote", Number(fLote));
    if (fClasse) query = query.eq("classe", fClasse);
    if (fStatus) query = query.eq("status", fStatus);
    if (fGrupo) query = query.eq("grupo", fGrupo);
    if (fDestino === DESTINO_SEM) query = query.is("destino", null);
    else if (fDestino) query = query.eq("destino", fDestino);
    // Pendente de medição = nunca confirmado fisicamente (null ou ≠ MEDIDO).
    if (fPendMedida) query = query.or("medidas_fonte.is.null,medidas_fonte.neq.MEDIDO");
    if (fSemCaixa) query = query.is("caixa_id", null);
    if (fCaixa) query = query.eq("caixa_id", fCaixa);
    // Triados (já passaram da catalogação) cuja etiqueta ainda não foi impressa.
    if (fSemEtiq) query = query.neq("status", "A_CATALOGAR").eq("etiqueta_impressa", false);
    if (fSemClasse) query = query.is("classe", null);
    // Triados (já catalogados) que ainda não têm foto.
    if (fSemFoto) query = query.neq("status", "A_CATALOGAR").eq("foto_feita", false);
    // Precificados pela IA (lote enriquecer_precos.mjs grava preco_ref_fonte=IA:claude).
    if (fIaPreco) query = query.eq("preco_ref_fonte", "IA:claude");
    // Aptos a publicar na Amazon: espelha os checks BLOQUEANTES do preflight (preco + GTIN),
    // + foto exigida. A banda de sanidade de preço fica para o publish (PublishPanel).
    // GTIN válido = EAN-13 / UPC-12 / GTIN-14 ou ASIN (10 alfanuméricos com ≥1 letra),
    // via regex POSIX no Postgres (imatch ~*), idêntico a gtinValido() em preflight.js.
    if (fAptoAmazon) {
      query = query
        .gt("preco_ideal", 0)
        .eq("foto_feita", true)
        .filter("gtin", "imatch", "^(\\d{12}|\\d{13}|\\d{14}|(?=[a-z0-9]*[a-z])[a-z0-9]{10})$");
    }
    if (q.trim()) {
      const t = q.trim();
      query = query.or(`sku.ilike.%${t}%,produto.ilike.%${t}%,marca.ilike.%${t}%,modelo.ilike.%${t}%`);
    }
    query = query.order("sku").range(from, from + PAGE - 1);
    const { data, count: c } = await query;
    setCount(c || 0);
    setItens((prev) => (reset ? data || [] : [...prev, ...(data || [])]));
    setLoading(false);
  }, [q, fLote, fClasse, fStatus, fGrupo, fDestino, fPendMedida, fSemCaixa, fSemEtiq, fSemClasse, fSemFoto, fIaPreco, fAptoAmazon, fCaixa, page]);

  // busca com debounce ao mudar filtros/texto
  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { setPage(0); buscar(true); }, 250);
    return () => clearTimeout(debounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, fLote, fClasse, fStatus, fGrupo, fDestino, fPendMedida, fSemCaixa, fSemEtiq, fSemClasse, fSemFoto, fIaPreco, fAptoAmazon, fCaixa, refreshKey]);

  const carregarMais = () => { setPage((p) => p + 1); };
  useEffect(() => { if (page > 0) buscar(false); /* eslint-disable-next-line */ }, [page]);

  // viabilidade por item (vw_precificacao) — só um ponto indicativo. Silencioso se a view não existir.
  useEffect(() => {
    const skus = itens.map((i) => i.sku);
    if (!skus.length) return;
    let cancel = false;
    (async () => {
      const { data, error } = await supabase
        .from("vw_precificacao")
        .select("sku, viavel")
        .in("sku", skus);
      if (cancel || error || !data) return;
      setViab((prev) => {
        const n = { ...prev };
        data.forEach((r) => (n[r.sku] = r.viavel));
        return n;
      });
    })();
    return () => { cancel = true; };
  }, [itens]);

  // vias de etiqueta já impressas por item (selo "já impresso"). Silencioso em erro.
  useEffect(() => {
    const skus = itens.map((i) => i.sku);
    if (!skus.length) return;
    let cancel = false;
    buscarViasImpressao(skus).then((m) => {
      if (!cancel) setViasMap((prev) => ({ ...prev, ...m }));
    });
    return () => { cancel = true; };
  }, [itens]);

  const atualizarVias = (skus) => {
    if (!skus?.length) return;
    buscarViasImpressao(skus).then((m) => setViasMap((prev) => ({ ...prev, ...m })));
  };

  // miniaturas (1ª foto) dos itens carregados; só busca os SKUs ainda sem URL.
  useEffect(() => {
    const faltando = itens.map((i) => i.sku).filter((s) => !(s in fotos));
    if (!faltando.length) return;
    let cancel = false;
    (async () => {
      const map = await primeirasFotos(faltando);
      if (!cancel && Object.keys(map).length) setFotos((prev) => ({ ...prev, ...map }));
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens]);

  const nActive = [fLote, fClasse, fStatus, fGrupo, fDestino, fPendMedida, fSemCaixa, fSemEtiq, fSemClasse, fSemFoto, fIaPreco, fAptoAmazon, fCaixa].filter(Boolean).length;

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
              <option value={LOTE_SEM}>Sem lote</option>
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
            {catList.length > 0 && (
              <select value={fGrupo} onChange={(e) => setFGrupo(e.target.value)} className={inputCls}>
                <option value="">Todas as categorias</option>
                {catList.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            )}
            <select value={fDestino} onChange={(e) => setFDestino(e.target.value)} className={inputCls}>
              <option value="">Todos os destinos</option>
              {DESTINOS.map((d) => <option key={d} value={d}>{d}</option>)}
              <option value={DESTINO_SEM}>Sem destino definido</option>
            </select>
            <select value={fCaixa} onChange={(e) => setFCaixa(e.target.value)} className={inputCls}>
              <option value="">Todas as caixas</option>
              {caixasList.map((c) => (
                <option key={c.codigo} value={c.codigo}>
                  {c.codigo}{c.local_fisico ? ` · ${c.local_fisico}` : c.destino ? ` — ${c.destino}` : ""}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 pt-0.5">
              <input type="checkbox" checked={fPendMedida} onChange={(e) => setFPendMedida(e.target.checked)}
                className="w-4 h-4 rounded accent-orange-500" />
              Só medidas pendentes (não pesados/medidos)
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input type="checkbox" checked={fSemCaixa} onChange={(e) => setFSemCaixa(e.target.checked)}
                className="w-4 h-4 rounded accent-orange-500" />
              Só sem caixa (a encaixotar)
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input type="checkbox" checked={fSemEtiq} onChange={(e) => setFSemEtiq(e.target.checked)}
                className="w-4 h-4 rounded accent-orange-500" />
              Triados sem etiqueta (imprimir)
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input type="checkbox" checked={fSemFoto} onChange={(e) => setFSemFoto(e.target.checked)}
                className="w-4 h-4 rounded accent-orange-500" />
              Triados sem foto (fotografar)
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input type="checkbox" checked={fSemClasse} onChange={(e) => setFSemClasse(e.target.checked)}
                className="w-4 h-4 rounded accent-orange-500" />
              Só sem classe (classificar)
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input type="checkbox" checked={fIaPreco} onChange={(e) => setFIaPreco(e.target.checked)}
                className="w-4 h-4 rounded accent-violet-500" />
              <span className="inline-flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-violet-500" /> Só precificados pela IA
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input type="checkbox" checked={fAptoAmazon} onChange={(e) => setFAptoAmazon(e.target.checked)}
                className="w-4 h-4 rounded accent-amber-500" />
              <span className="inline-flex items-center gap-1">
                <ShoppingCart className="w-3.5 h-3.5 text-amber-500" /> Só aptos p/ Amazon (preço + GTIN + foto)
              </span>
            </label>
          </div>
        )}
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-gray-400">
            {count.toLocaleString("pt-BR")} itens
            {selectMode && ` · ${selected.size} selecionado(s)`}
          </p>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setCatalogarPicker(true)}
              className="flex items-center gap-1 text-xs font-semibold text-gray-600 bg-white border border-gray-300 rounded-lg px-2 py-1">
              <ClipboardList className="w-3.5 h-3.5" /> Catalogar
            </button>
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

      <FotoInputs ref={fotoRef} onFiles={aoSelecionarFoto} />
      {escolherFonte && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-end" onClick={() => setEscolherFonte(false)}>
          <div className="w-full bg-white rounded-t-2xl p-4 space-y-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-bold text-gray-800">Adicionar foto</span>
              <button onClick={() => setEscolherFonte(false)} aria-label="Fechar"><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <button onClick={() => { setEscolherFonte(false); fotoRef.current?.abrirCamera(); }}
              className="w-full flex items-center gap-3 bg-orange-500 text-white rounded-xl py-3.5 px-4 font-bold active:bg-orange-600">
              <Camera className="w-5 h-5" /> Câmera
            </button>
            <button onClick={() => { setEscolherFonte(false); fotoRef.current?.abrirGaleria(); }}
              className="w-full flex items-center gap-3 bg-gray-800 text-white rounded-xl py-3.5 px-4 font-bold active:bg-gray-900">
              <Images className="w-5 h-5" /> Escolher da galeria
            </button>
          </div>
        </div>
      )}

      <div className="px-3 pt-2 space-y-1.5">
        {itens.map((it) => {
          const sm = statusMeta(it.status);
          const sel = selected.has(it.sku);
          return (
            <div key={it.sku}
              className={`bg-white rounded-xl border px-3 py-2.5 flex items-center gap-3 ${sel ? "border-orange-500 ring-1 ring-orange-300" : "border-gray-200"}`}>
              <button onClick={() => abrirItem(it)} className="flex items-center gap-3 flex-1 min-w-0 text-left active:opacity-70">
                {selectMode && (
                  sel
                    ? <CheckSquare className="w-5 h-5 text-orange-500 flex-shrink-0" />
                    : <Square className="w-5 h-5 text-gray-300 flex-shrink-0" />
                )}
                <div className="w-11 h-11 rounded-lg overflow-hidden flex-shrink-0 relative bg-gray-100">
                  {fotos[it.sku] ? (
                    <img src={fotos[it.sku]} alt="" loading="lazy" className="w-full h-full object-cover" />
                  ) : (
                    <div className={`w-full h-full flex items-center justify-center text-xs font-bold ${CLASSE_STYLE[it.classe] || "bg-gray-300 text-white"}`}>{it.classe}</div>
                  )}
                  {fotos[it.sku] && it.classe && (
                    <span className={`absolute bottom-0 left-0 px-1 text-[9px] font-bold leading-tight ${CLASSE_STYLE[it.classe] || "bg-gray-500 text-white"}`}>{it.classe}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {it.sku in viab && (
                      <span
                        title={viab[it.sku] ? "Preço viável" : "Rever preço/custo"}
                        className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${viab[it.sku] ? "bg-emerald-500" : "bg-red-500"}`}
                      />
                    )}
                    <span className="font-mono text-xs font-bold text-gray-900">{it.sku}</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${sm.color}`}>{sm.short}</span>
                    {viasMap[it.sku]?.vias > 0 && (
                      <span title={`Etiqueta já impressa · ${viasMap[it.sku].vias} via(s)`}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 flex-shrink-0">
                        <Printer className="w-3 h-3" />{viasMap[it.sku].vias}
                      </span>
                    )}
                    {pendenteMedida(it) && (
                      <span title="Medidas/peso pendentes de medição"
                        className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-gray-200 text-gray-600 flex-shrink-0">
                        <Ruler className="w-3 h-3" />
                      </span>
                    )}
                    {it.preco_ref_fonte === "IA:claude" && (
                      <span title="Precificado e enriquecido pela IA"
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-violet-100 text-violet-700 flex-shrink-0">
                        <Sparkles className="w-3 h-3" />IA
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 truncate">{it.produto}</p>
                  <div className="flex items-center gap-1.5 flex-wrap text-xs text-gray-400">
                    {it.grupo && <span className="bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">{it.grupo}</span>}
                    {(it.marca || it.modelo) && <span className="truncate">{[it.marca, it.modelo].filter(Boolean).join(" ")}</span>}
                    <span>{it.lote ? `Lote ${it.lote}` : "Sem lote"} · {fmtBRL(it.preco_ideal || it.preco_sugerido)}</span>
                    {it.caixa_id && (
                      <span className="inline-flex items-center gap-0.5 bg-indigo-50 text-indigo-700 rounded px-1.5 py-0.5">
                        <Package className="w-3 h-3" />{it.caixa_id}{it.local_fisico ? ` · ${it.local_fisico}` : ""}
                      </span>
                    )}
                  </div>
                </div>
              </button>
              {!selectMode && (
                <button onClick={() => iniciarFoto(it.sku)} disabled={savingFoto === it.sku}
                  className="flex-shrink-0 w-9 h-9 rounded-lg border border-gray-200 text-gray-500 flex items-center justify-center active:bg-gray-100 disabled:opacity-50"
                  title="Tirar/enviar foto" aria-label="Foto">
                  {savingFoto === it.sku ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                </button>
              )}
              <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
            </div>
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

      {catalogarPicker && (
        <CatalogarPorLote
          lotes={lotes}
          onClose={() => setCatalogarPicker(false)}
          onPick={escolherCatalogar}
        />
      )}

      {boxPicker && (
        <BoxPicker
          params={params}
          onClose={() => setBoxPicker(false)}
          onPick={(label) => { setPrintLabels([label]); setBoxPicker(false); }}
        />
      )}

      {printLabels && (
        <Suspense fallback={<div className="fixed inset-0 z-[70] bg-white flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>}>
          <LabelPrint
            labels={printLabels}
            user={user}
            onPrinted={atualizarVias}
            onClose={() => setPrintLabels(null)}
          />
        </Suspense>
      )}
    </div>
  );
}

// Seletor de caixa/mala (tabela `caixas`): escolhe uma caixa e gera a etiqueta
// externa (buildBoxLabel) com o conteúdo atual. Devolve a etiqueta pronta via onPick.
function BoxPicker({ onClose, onPick, params }) {
  const [loading, setLoading] = useState(true);
  const [caixas, setCaixas] = useState([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(null); // codigo em geração

  useEffect(() => {
    (async () => {
      setCaixas(await listarCaixas());
      setLoading(false);
    })();
  }, []);

  const escolher = async (c) => {
    setBusy(c.codigo);
    try {
      const itens = await itensDaCaixa(c.codigo);
      onPick(buildBoxLabel(c, itens, params));
    } finally {
      setBusy(null);
    }
  };

  const filtrados = q.trim()
    ? caixas.filter((c) => c.codigo.toLowerCase().includes(q.trim().toLowerCase()))
    : caixas;

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
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar caixa/mala (ex.: CX-001)…"
          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-base bg-white focus:outline-none focus:ring-2 focus:ring-orange-500" />
      </div>
      <div className="flex-1 overflow-auto px-3 pb-6 space-y-1.5">
        {loading && <div className="py-10 text-center"><Loader2 className="w-6 h-6 animate-spin text-orange-500 mx-auto" /></div>}
        {!loading && !filtrados.length && (
          <p className="text-sm text-gray-400 text-center py-10">Nenhuma caixa cadastrada. Crie em Conferir → Encaixotar.</p>
        )}
        {filtrados.map((c) => (
          <button key={c.codigo} onClick={() => escolher(c)} disabled={busy === c.codigo}
            className="w-full text-left bg-white rounded-xl border border-gray-200 px-3 py-2.5 flex items-center gap-3 active:bg-gray-100 disabled:opacity-50">
            <span className="w-5 flex-shrink-0 flex justify-center">
              {c.tipo === CAIXA_TIPO.MALA ? <Boxes className="w-5 h-5 text-gray-400" /> : <Package className="w-5 h-5 text-gray-400" />}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold text-gray-900">{c.codigo}</span>
                {c.status === CAIXA_STATUS.FECHADA && <span className="text-[10px] font-bold uppercase bg-gray-200 text-gray-600 rounded px-1.5 py-0.5">Fechada</span>}
              </div>
              <p className="text-xs text-gray-500">{c.destino || "—"}{c.local_fisico ? ` · ${c.local_fisico}` : ""}</p>
            </div>
            {busy === c.codigo ? <Loader2 className="w-4 h-4 animate-spin text-gray-400 flex-shrink-0" /> : <Printer className="w-4 h-4 text-gray-300 flex-shrink-0" />}
          </button>
        ))}
      </div>
    </div>
  );
}

// Atalho "A catalogar por lote": conta itens A_CATALOGAR por lote (contarACatalogarPorLote)
// e, ao escolher, aplica status=A_CATALOGAR + lote na tela de itens. Espelha o BoxPicker.
function CatalogarPorLote({ lotes, onClose, onPick }) {
  const [loading, setLoading] = useState(true);
  const [linhas, setLinhas] = useState([]);
  const refDe = (lote) => lotes.find((l) => l.lote === lote)?.referencia || "";

  useEffect(() => {
    (async () => {
      try { setLinhas(await contarACatalogarPorLote()); }
      finally { setLoading(false); }
    })();
  }, []);

  const total = linhas.reduce((s, r) => s + r.count, 0);

  return (
    <div className="fixed inset-0 z-[65] bg-gray-100 flex flex-col">
      <div className="bg-gray-900 text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-orange-400" />
          <span className="font-bold">A catalogar por lote</span>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg bg-gray-800" aria-label="Fechar">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 overflow-auto px-3 py-3 space-y-1.5">
        {loading ? (
          <div className="py-10 text-center"><Loader2 className="w-6 h-6 animate-spin text-orange-500 mx-auto" /></div>
        ) : !linhas.length ? (
          <p className="text-sm text-gray-400 text-center py-10">Nada a catalogar. 🎉</p>
        ) : (
          <>
            <p className="text-xs text-gray-500 px-1 pb-1">
              {total.toLocaleString("pt-BR")} itens a catalogar em {linhas.length} lote(s)
            </p>
            {linhas.map((r) => {
              const value = r.lote == null ? LOTE_SEM : String(r.lote);
              const titulo = r.lote == null ? "Sem lote" : `Lote ${r.lote}`;
              const ref = r.lote == null ? "" : refDe(r.lote);
              return (
                <button key={value} onClick={() => onPick(value)}
                  className="w-full text-left bg-white rounded-xl border border-gray-200 px-3 py-2.5 flex items-center gap-3 active:bg-gray-100">
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-sm text-gray-900">{titulo}</span>
                    {ref && <span className="text-xs text-gray-500"> — {ref}</span>}
                  </div>
                  <span className="text-sm font-bold text-orange-600">{r.count}</span>
                  <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
                </button>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
