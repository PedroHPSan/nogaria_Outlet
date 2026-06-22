import React, { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { supabase } from "../lib/supabase";
import { LOTE_SEM, ALL_STATUS, STATUS_FLOW, statusMeta, DESTINOS, fmtBRL, fmtKg, CLASSE_STYLE } from "../lib/model";
import { checarCompletude, toCSV, baixarArquivo, COLUNAS_CAIXA } from "../lib/export";
import { atribuirLote, garantirLote, marcarConferido, limparConferencia, definirCategoria, moverEtapa, contarSemClasse, classificarSemClasse } from "../lib/conferencia";
import { classeAutomatica, estimarValorCaixa, estimarValorVenda, estimarPesoCaixa } from "../lib/classificacao";
import {
  CAIXA_STATUS, CAIXA_TIPO, criarCaixa, adicionarItemCaixa, removerItemCaixa,
  fecharCaixa, listarCaixas, itensDaCaixa,
} from "../lib/caixas";
import { buildBoxLabel } from "../lib/labels";
import { buscarViasImpressaoCaixa } from "../lib/printLog";
import { primeirasFotos } from "../lib/fotos";
import { sugerirCategoria } from "../lib/categorizar";
import CategoriaPicker from "../components/CategoriaPicker";
import { DEFAULT_PARAMS } from "../lib/pricing";
import {
  Inbox, ScanLine, ClipboardList, Loader2, CheckCircle2, Circle, AlertTriangle,
  PackageCheck, RotateCcw, Camera, ChevronRight, ChevronDown, Tags, Sparkles, ArrowLeftRight,
  Package, Printer, FileDown, Lock, Plus, Trash2, ArrowLeft,
} from "lucide-react";

const LazyScanner = React.lazy(() => import("./BarcodeScanner"));
const LazyLabelPrint = React.lazy(() => import("../components/labels/LabelPrint"));
const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base bg-white focus:outline-none focus:ring-2 focus:ring-orange-500";

// Carrega todos os itens que batem com o filtro (PostgREST corta em 1.000 linhas).
async function fetchItens(applyFilter) {
  const PAGE = 1000;
  let data = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from("itens").select("*");
    q = applyFilter(q);
    const { data: chunk, error } = await q.order("sku").range(from, from + PAGE - 1);
    if (error || !chunk) break;
    data = data.concat(chunk);
    if (chunk.length < PAGE) break;
  }
  return data;
}

export default function ConferenciaScreen({ lotes, user, params = DEFAULT_PARAMS, onOpen, refreshKey, onChanged }) {
  const [secao, setSecao] = useState("definir");
  return (
    <div className="pb-24">
      <div className="sticky top-14 z-10 bg-gray-50 px-4 pt-3 pb-2 border-b border-gray-200">
        <div className="grid grid-cols-3 gap-1.5">
          {[
            { id: "definir", t: "Definir lote", icon: Inbox },
            { id: "categorizar", t: "Categorizar", icon: Tags },
            { id: "mover", t: "Mover etapa", icon: ArrowLeftRight },
            { id: "encaixotar", t: "Encaixotar", icon: Package },
            { id: "inventario", t: "Inventário", icon: ScanLine },
            { id: "pendencias", t: "Pendências", icon: ClipboardList },
          ].map((s) => (
            <button key={s.id} onClick={() => setSecao(s.id)}
              className={`py-2 rounded-lg text-[11px] font-semibold flex flex-col items-center gap-1 border ${secao === s.id ? "bg-orange-500 text-white border-orange-500" : "bg-white text-gray-600 border-gray-300"}`}>
              <s.icon className="w-4 h-4" /> {s.t}
            </button>
          ))}
        </div>
      </div>
      {secao === "definir" && <DefinirLote lotes={lotes} user={user} refreshKey={refreshKey} onChanged={onChanged} />}
      {secao === "mover" && <MoverEtapa lotes={lotes} user={user} refreshKey={refreshKey} onChanged={onChanged} />}
      {secao === "encaixotar" && <Encaixotar user={user} params={params} refreshKey={refreshKey} onChanged={onChanged} />}
      {secao === "categorizar" && <CategorizarMassa lotes={lotes} user={user} params={params} refreshKey={refreshKey} onChanged={onChanged} />}
      {secao === "inventario" && <Inventario lotes={lotes} user={user} refreshKey={refreshKey} onChanged={onChanged} />}
      {secao === "pendencias" && <Pendencias lotes={lotes} onOpen={onOpen} refreshKey={refreshKey} />}
    </div>
  );
}

// ───────────────────────── Definir lote (caixa de entrada) ─────────────────────────
function DefinirLote({ lotes, user, refreshKey, onChanged }) {
  const [itens, setItens] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [modo, setModo] = useState("existente"); // existente | novo
  const [loteSel, setLoteSel] = useState(lotes[0] ? String(lotes[0].lote) : "");
  const [loteNum, setLoteNum] = useState("");
  const [loteRef, setLoteRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");

  const load = useCallback(async () => {
    setItens(null);
    setSel(new Set());
    setItens(await fetchItens((q) => q.is("lote", null)));
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const toggle = (sku) => setSel((s) => {
    const n = new Set(s); n.has(sku) ? n.delete(sku) : n.add(sku); return n;
  });
  const todos = () => setSel((s) => (s.size === (itens?.length || 0) ? new Set() : new Set(itens.map((i) => i.sku))));

  const atribuir = async () => {
    setErro("");
    if (!sel.size) return setErro("Selecione ao menos um item.");
    if (modo === "novo" && !Number(loteNum)) return setErro("Informe o número do novo lote.");
    if (modo === "existente" && !loteSel) return setErro("Selecione um lote.");
    setBusy(true);
    try {
      const lote = modo === "novo" ? Number(loteNum) : Number(loteSel);
      if (modo === "novo") await garantirLote(lote, loteRef);
      for (const sku of sel) await atribuirLote(sku, lote, user);
      onChanged?.();
      await load();
    } catch (e) {
      setErro("Erro ao atribuir: " + (e.message || e));
    } finally {
      setBusy(false);
    }
  };

  if (itens === null) return <Carregando />;

  return (
    <div className="px-4 pt-4 space-y-4">
      <p className="text-sm text-gray-500">
        Itens criados <b>sem lote</b>. Selecione e atribua a um lote — o SKU é regerado (ex.: <span className="font-mono">NOG-SL-001 → NOG-126-001</span>).
      </p>

      {!itens.length ? (
        <Vazio icon={Inbox} texto="Nenhum item sem lote. Tudo certo por aqui." />
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-gray-200 p-3 space-y-2">
            <div className="flex gap-1.5">
              {[{ id: "existente", t: "Lote existente" }, { id: "novo", t: "Novo lote" }].map((m) => (
                <button key={m.id} onClick={() => setModo(m.id)}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-sm font-semibold border ${modo === m.id ? "bg-orange-500 text-white border-orange-500" : "bg-white text-gray-600 border-gray-300"}`}>
                  {m.t}
                </button>
              ))}
            </div>
            {modo === "existente" ? (
              <select value={loteSel} onChange={(e) => setLoteSel(e.target.value)} className={inputCls}>
                <option value="">Selecione…</option>
                {lotes.map((l) => <option key={l.lote} value={String(l.lote)}>Lote {l.lote} — {l.referencia || ""}</option>)}
              </select>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <input type="number" inputMode="numeric" className={inputCls} value={loteNum}
                  onChange={(e) => setLoteNum(e.target.value)} placeholder="Nº do lote" />
                <input className={inputCls} value={loteRef} onChange={(e) => setLoteRef(e.target.value)} placeholder="Referência" />
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <button onClick={todos} className="text-sm font-semibold text-orange-600">
              {sel.size === itens.length ? "Limpar seleção" : "Selecionar todos"}
            </button>
            <span className="text-xs text-gray-400">{itens.length} sem lote</span>
          </div>

          <div className="space-y-1.5">
            {itens.map((it) => (
              <button key={it.sku} onClick={() => toggle(it.sku)}
                className="w-full text-left bg-white rounded-xl border border-gray-200 px-3 py-2.5 flex items-center gap-3 active:bg-gray-100">
                {sel.has(it.sku) ? <CheckCircle2 className="w-5 h-5 text-orange-500 flex-shrink-0" /> : <Circle className="w-5 h-5 text-gray-300 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <span className="font-mono text-xs font-bold text-gray-900">{it.sku}</span>
                  <p className="text-sm text-gray-600 truncate">{it.produto}</p>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {erro && <p className="text-xs text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {erro}</p>}

      {!!itens.length && (
        <div className="sticky bottom-20 pt-1">
          <button disabled={busy || !sel.size} onClick={atribuir}
            className="w-full flex items-center justify-center gap-2 bg-orange-500 text-white rounded-2xl py-3.5 font-bold shadow-lg active:bg-orange-600 disabled:opacity-40">
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <PackageCheck className="w-5 h-5" />}
            Atribuir lote ({sel.size})
          </button>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Categorização em massa ─────────────────────────
function CategorizarMassa({ lotes, user, params, refreshKey, onChanged }) {
  const [fLote, setFLote] = useState("");
  const [soSemCat, setSoSemCat] = useState(true);
  const [itens, setItens] = useState(null);
  const [sugs, setSugs] = useState({});      // sku -> categoria sugerida
  const [escolhas, setEscolhas] = useState({}); // sku -> categoria escolhida
  const [sel, setSel] = useState(() => new Set());
  const [visiveis, setVisiveis] = useState(60);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [semClasse, setSemClasse] = useState(null); // contagem de itens sem classe
  const [bfBusy, setBfBusy] = useState(false);
  const [bfMsg, setBfMsg] = useState(null);

  const catList = useMemo(
    () => Object.keys(params?.grupos || {}).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [params]
  );

  const semCategoria = (it) => !it.grupo || it.grupo.startsWith("Diversos");

  const load = useCallback(async () => {
    setItens(null); setSel(new Set()); setMsg(null); setVisiveis(60);
    const data = await fetchItens((q) =>
      fLote === LOTE_SEM ? q.is("lote", null) : (fLote ? q.eq("lote", Number(fLote)) : q));
    const lista = (soSemCat ? data.filter(semCategoria) : data)
      .filter((it) => it.produto && !it.produto.startsWith("A CATALOGAR"));
    const sg = {}, esc = {}, s = new Set();
    for (const it of lista) {
      const sug = sugerirCategoria(it.produto, catList);
      sg[it.sku] = sug || null;
      if (sug) { esc[it.sku] = sug; s.add(it.sku); }
    }
    setSugs(sg); setEscolhas(esc); setSel(s); setItens(lista);
  }, [fLote, soSemCat, catList]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const recarregarSemClasse = useCallback(() => {
    contarSemClasse().then(setSemClasse).catch(() => setSemClasse(null));
  }, []);
  useEffect(() => { recarregarSemClasse(); }, [recarregarSemClasse, refreshKey]);

  const rodarBackfill = async () => {
    setBfBusy(true); setBfMsg(null);
    try {
      const { total, porClasse } = await classificarSemClasse(params, user);
      const detalhe = Object.entries(porClasse).map(([c, n]) => `${n} ${c}`).join(" · ");
      setBfMsg({ tipo: "ok", texto: total ? `${total} item(ns) classificado(s): ${detalhe}` : "Nenhum item sem classe." });
      recarregarSemClasse();
      onChanged?.();
    } catch (e) {
      setBfMsg({ tipo: "erro", texto: e.message || String(e) });
    } finally { setBfBusy(false); }
  };

  const setCat = (sku, g) => {
    setEscolhas((e) => ({ ...e, [sku]: g }));
    setSel((s) => { const n = new Set(s); g ? n.add(sku) : n.delete(sku); return n; });
  };
  const toggle = (sku) => setSel((s) => { const n = new Set(s); n.has(sku) ? n.delete(sku) : n.add(sku); return n; });

  const aplicarSugestoes = () => {
    setEscolhas((e) => {
      const n = { ...e };
      for (const it of itens) if (sugs[it.sku]) n[it.sku] = sugs[it.sku];
      return n;
    });
    setSel(new Set(itens.filter((it) => sugs[it.sku]).map((it) => it.sku)));
  };

  const comSugestao = itens ? itens.filter((it) => sugs[it.sku]).length : 0;

  const salvar = async () => {
    if (!sel.size) return;
    setBusy(true); setMsg(null);
    try {
      let n = 0;
      for (const it of itens) {
        if (!sel.has(it.sku)) continue;
        const g = escolhas[it.sku];
        if (!g) continue;
        const classe = it.classe ? undefined : classeAutomatica({ ...it, grupo: g }, params).classe;
        await definirCategoria(it.sku, g, user, classe);
        n++;
      }
      onChanged?.();
      setMsg({ tipo: "ok", texto: `${n} item(ns) categorizado(s).` });
      await load();
    } catch (e) {
      setMsg({ tipo: "erro", texto: e.message || String(e) });
    } finally { setBusy(false); }
  };

  if (itens === null) return <Carregando />;

  return (
    <div className="px-4 pt-4 space-y-3">
      <p className="text-sm text-gray-500">
        Sugere a categoria pelo nome do produto. Revise e <b>salve as marcadas</b>. Aceitar uma categoria nova preenche a classe quando estiver vazia.
      </p>

      {/* Backfill: dá classe a itens sem classe (ex.: parados em "A catalogar") */}
      {semClasse !== null && semClasse > 0 && (
        <div className="bg-white rounded-2xl border border-amber-200 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm min-w-0">
              <p className="font-semibold text-gray-800">{semClasse} item(ns) sem classe</p>
              <p className="text-xs text-gray-500">Atribui classe por categoria → valor → C.</p>
            </div>
            <button disabled={bfBusy} onClick={rodarBackfill}
              className="flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-bold text-white bg-gray-900 rounded-lg px-3 py-2 disabled:opacity-40">
              {bfBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Classificar
            </button>
          </div>
          {bfMsg && (
            <p className={`mt-2 text-sm flex items-center gap-1.5 ${bfMsg.tipo === "ok" ? "text-emerald-600" : "text-red-600"}`}>
              {bfMsg.tipo === "ok" ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />} {bfMsg.texto}
            </p>
          )}
        </div>
      )}
      {semClasse === 0 && bfMsg && (
        <p className={`text-sm flex items-center gap-1.5 ${bfMsg.tipo === "ok" ? "text-emerald-600" : "text-red-600"}`}>
          {bfMsg.tipo === "ok" ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />} {bfMsg.texto}
        </p>
      )}
      <select value={fLote} onChange={(e) => setFLote(e.target.value)} className={inputCls}>
        <option value="">Todos os lotes</option>
        <option value={LOTE_SEM}>Sem lote</option>
        {lotes.map((l) => <option key={l.lote} value={String(l.lote)}>Lote {l.lote} — {l.referencia || ""}</option>)}
      </select>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={soSemCat} onChange={(e) => setSoSemCat(e.target.checked)} className="w-4 h-4 accent-orange-500" />
        Mostrar só itens sem categoria
      </label>

      {!itens.length ? (
        <Vazio icon={Tags} texto="Nada para categorizar com esse filtro." />
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-gray-200 p-3 flex items-center justify-between gap-2">
            <div className="text-sm min-w-0">
              <p className="font-semibold text-gray-800">{itens.length} item(ns)</p>
              <p className="text-xs text-gray-500">{comSugestao} com sugestão · {sel.size} selecionado(s)</p>
            </div>
            <button onClick={aplicarSugestoes}
              className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-orange-600 bg-orange-50 border border-orange-200 rounded-lg px-2.5 py-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Sugerir todos
            </button>
          </div>

          {msg && (
            <p className={`text-sm flex items-center gap-1.5 ${msg.tipo === "ok" ? "text-emerald-600" : "text-red-600"}`}>
              {msg.tipo === "ok" ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />} {msg.texto}
            </p>
          )}

          <div className="space-y-1.5">
            {itens.slice(0, visiveis).map((it) => (
              <div key={it.sku} className={`bg-white rounded-xl border px-3 py-2.5 flex gap-3 ${sel.has(it.sku) ? "border-orange-300" : "border-gray-200"}`}>
                <button onClick={() => toggle(it.sku)} className="pt-0.5 flex-shrink-0">
                  {sel.has(it.sku) ? <CheckCircle2 className="w-5 h-5 text-orange-500" /> : <Circle className="w-5 h-5 text-gray-300" />}
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700 truncate">{it.produto}</p>
                  <p className="text-xs text-gray-400 mb-1.5">
                    <span className="font-mono">{it.sku}</span>{it.grupo ? ` · atual: ${it.grupo}` : ""}
                  </p>
                  <CategoriaPicker value={escolhas[it.sku] || ""} onChange={(g) => setCat(it.sku, g)}
                    grupos={catList} sugestao={sugs[it.sku]} />
                </div>
              </div>
            ))}
          </div>

          {itens.length > visiveis && (
            <button onClick={() => setVisiveis((v) => v + 60)} className="w-full py-3 text-sm font-semibold text-orange-600">
              Carregar mais ({itens.length - visiveis} restantes)
            </button>
          )}

          {!!sel.size && (
            <div className="sticky bottom-20 pt-1">
              <button disabled={busy} onClick={salvar}
                className="w-full flex items-center justify-center gap-2 bg-orange-500 text-white rounded-2xl py-3.5 font-bold shadow-lg active:bg-orange-600 disabled:opacity-40">
                {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Tags className="w-5 h-5" />}
                Salvar categorias ({sel.size})
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ───────────────────────── Mover etapa (status) em massa ─────────────────────────
function MoverEtapa({ lotes, user, refreshKey, onChanged }) {
  const [origem, setOrigem] = useState("PRONTO");
  const [destino, setDestino] = useState("TRIADO");
  const [fLote, setFLote] = useState("");
  const [itens, setItens] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [visiveis, setVisiveis] = useState(60);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    setItens(null); setSel(new Set()); setMsg(null); setVisiveis(60);
    if (!origem) { setItens([]); return; }
    const data = await fetchItens((q) => {
      let qq = q.eq("status", origem);
      if (fLote === LOTE_SEM) qq = qq.is("lote", null);
      else if (fLote) qq = qq.eq("lote", Number(fLote));
      return qq;
    });
    setItens(data);
    setSel(new Set(data.map((i) => i.sku))); // tudo marcado por padrão
  }, [origem, fLote]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const fotos = useThumbs(itens);
  const toggle = (sku) => setSel((s) => { const n = new Set(s); n.has(sku) ? n.delete(sku) : n.add(sku); return n; });
  const todos = () => setSel((s) => (itens && s.size === itens.length ? new Set() : new Set(itens.map((i) => i.sku))));

  const origemLabel = statusMeta(origem).label;
  const destinoLabel = statusMeta(destino).label;

  const aplicar = async () => {
    if (!sel.size) return;
    if (destino === origem) { setMsg({ tipo: "erro", texto: "Escolha uma etapa de destino diferente da origem." }); return; }
    if (!window.confirm(`Mover ${sel.size} item(ns) de "${origemLabel}" para "${destinoLabel}"?`)) return;
    setBusy(true); setMsg(null);
    try {
      let n = 0;
      for (const it of itens) {
        if (!sel.has(it.sku)) continue;
        await moverEtapa(it.sku, destino, user, origemLabel);
        n++;
      }
      onChanged?.();
      setMsg({ tipo: "ok", texto: `${n} item(ns) movido(s) para "${destinoLabel}".` });
      await load();
    } catch (e) {
      setMsg({ tipo: "erro", texto: e.message || String(e) });
    } finally { setBusy(false); }
  };

  return (
    <div className="px-4 pt-4 space-y-3">
      <p className="text-sm text-gray-500">
        Move itens de uma etapa para outra com registro no histórico. Ex.: devolver itens marcados como <b>Pronto p/ anúncio</b> por engano para <b>Triado</b>.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase text-gray-500">De (status atual)</span>
          <select value={origem} onChange={(e) => setOrigem(e.target.value)} className={inputCls + " mt-1"}>
            {ALL_STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase text-gray-500">Para (nova etapa)</span>
          <select value={destino} onChange={(e) => setDestino(e.target.value)} className={inputCls + " mt-1"}>
            {ALL_STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      </div>
      <select value={fLote} onChange={(e) => setFLote(e.target.value)} className={inputCls}>
        <option value="">Todos os lotes</option>
        <option value={LOTE_SEM}>Sem lote</option>
        {lotes.map((l) => <option key={l.lote} value={String(l.lote)}>Lote {l.lote} — {l.referencia || ""}</option>)}
      </select>

      {itens === null ? <Carregando /> : !itens.length ? (
        <Vazio icon={ArrowLeftRight} texto={`Nenhum item em "${origemLabel}" com esse filtro.`} />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <button onClick={todos} className="text-sm font-semibold text-orange-600">
              {sel.size === itens.length ? "Limpar seleção" : "Selecionar todos"}
            </button>
            <span className="text-xs text-gray-400">{sel.size} de {itens.length} selecionado(s)</span>
          </div>

          {msg && (
            <p className={`text-sm flex items-center gap-1.5 ${msg.tipo === "ok" ? "text-emerald-600" : "text-red-600"}`}>
              {msg.tipo === "ok" ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />} {msg.texto}
            </p>
          )}

          <div className="space-y-1.5">
            {itens.slice(0, visiveis).map((it) => (
              <button key={it.sku} onClick={() => toggle(it.sku)}
                className={`w-full text-left rounded-xl border px-3 py-2.5 flex items-center gap-3 ${sel.has(it.sku) ? "border-orange-300 bg-orange-50/40" : "border-gray-200 bg-white"}`}>
                {sel.has(it.sku) ? <CheckCircle2 className="w-5 h-5 text-orange-500 flex-shrink-0" /> : <Circle className="w-5 h-5 text-gray-300 flex-shrink-0" />}
                <Miniatura url={fotos[it.sku]} />
                <div className="flex-1 min-w-0">
                  <span className="font-mono text-xs font-bold text-gray-900">{it.sku}</span>
                  <p className="text-sm text-gray-600 truncate">{it.produto}</p>
                  <IdentLinha it={it} />
                </div>
              </button>
            ))}
          </div>
          {itens.length > visiveis && (
            <button onClick={() => setVisiveis((v) => v + 60)} className="w-full py-3 text-sm font-semibold text-orange-600">
              Carregar mais ({itens.length - visiveis} restantes)
            </button>
          )}

          {!!sel.size && (
            <div className="sticky bottom-20 pt-1">
              <button disabled={busy || destino === origem} onClick={aplicar}
                className="w-full flex items-center justify-center gap-2 bg-orange-500 text-white rounded-2xl py-3.5 font-bold shadow-lg active:bg-orange-600 disabled:opacity-40">
                {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowLeftRight className="w-5 h-5" />}
                Mover {sel.size} para “{destinoLabel}”
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ───────────────────────── Encaixotar (2ª etapa) ─────────────────────────
function Encaixotar({ user, params, refreshKey, onChanged }) {
  const [abertas, setAbertas] = useState(null);   // caixas ABERTAS
  const [fechadas, setFechadas] = useState(null);  // caixas FECHADAS (consulta)
  const [caixa, setCaixa] = useState(null);        // caixa ativa
  const [itens, setItens] = useState([]);          // itens da caixa ativa
  const [nova, setNova] = useState(false);         // form "nova caixa"
  const [tipo, setTipo] = useState(CAIXA_TIPO.CAIXA);
  const [destino, setDestino] = useState(DESTINOS[0]);
  const [local, setLocal] = useState("");
  const [scanInput, setScanInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [printLabels, setPrintLabels] = useState(null);

  const loadAbertas = useCallback(async () => {
    const [ab, fe] = await Promise.all([
      listarCaixas({ status: CAIXA_STATUS.ABERTA }),
      listarCaixas({ status: CAIXA_STATUS.FECHADA }),
    ]);
    setAbertas(ab);
    setFechadas(fe);
  }, []);
  useEffect(() => { loadAbertas(); }, [loadAbertas, refreshKey]);

  const abrirCaixa = useCallback(async (c) => {
    setCaixa(c); setMsg(null); setItens(await itensDaCaixa(c.codigo));
  }, []);

  const fotos = useThumbs(itens);

  const criar = async () => {
    setBusy(true); setMsg(null);
    try {
      const c = await criarCaixa({ tipo, destino, local_fisico: local }, user);
      setNova(false); setLocal("");
      onChanged?.(); await loadAbertas(); await abrirCaixa(c);
    } catch (e) {
      setMsg({ tipo: "erro", texto: e.message || String(e) });
    } finally { setBusy(false); }
  };

  // Escaneia/digita SKU ou GTIN e encaixota o item na caixa ativa.
  const processarCodigo = async (codigo) => {
    const c = String(codigo || "").trim();
    setScanInput("");
    if (!c || !caixa) return;
    const cn = c.toUpperCase();
    let alvo = (await supabase.from("itens").select("*").eq("sku", cn).maybeSingle()).data;
    if (!alvo) alvo = (await supabase.from("itens").select("*").eq("gtin", c).limit(1)).data?.[0];
    if (!alvo) { setMsg({ tipo: "erro", texto: `"${c}" não encontrado.` }); return; }
    if (alvo.caixa_id === caixa.codigo) { setMsg({ tipo: "ok", texto: `${alvo.sku} já está nesta caixa.` }); return; }
    if (alvo.caixa_id && !window.confirm(`${alvo.sku} já está na caixa ${alvo.caixa_id}. Mover para ${caixa.codigo}?`)) return;
    setBusy(true);
    try {
      const atualizado = await adicionarItemCaixa(alvo.sku, caixa, user);
      setItens((arr) => [atualizado, ...arr.filter((i) => i.sku !== atualizado.sku)]);
      setMsg({ tipo: "ok", texto: `${alvo.sku} encaixotado ✓` });
      onChanged?.();
    } catch (e) {
      setMsg({ tipo: "erro", texto: e.message || String(e) });
    } finally { setBusy(false); }
  };

  const remover = async (sku) => {
    setBusy(true);
    try {
      await removerItemCaixa(sku, user);
      setItens((arr) => arr.filter((i) => i.sku !== sku));
      onChanged?.();
    } catch (e) {
      setMsg({ tipo: "erro", texto: e.message || String(e) });
    } finally { setBusy(false); }
  };

  const fechar = async () => {
    if (!window.confirm(`Fechar a caixa ${caixa.codigo} com ${itens.length} item(ns)?`)) return;
    setBusy(true);
    try {
      await fecharCaixa(caixa.codigo, user);
      setCaixa(null); setItens([]); onChanged?.(); await loadAbertas();
    } finally { setBusy(false); }
  };

  const imprimir = () => setPrintLabels([buildBoxLabel(caixa, itens, params)]);
  const baixarLista = () => {
    if (!itens.length) return;
    baixarArquivo(`caixa-${caixa.codigo}.csv`, toCSV(itens, COLUNAS_CAIXA));
  };

  // ── Caixa ativa ────────────────────────────────────────────────
  if (caixa) {
    const isMala = caixa.tipo === CAIXA_TIPO.MALA;
    const voltar = () => { setCaixa(null); setItens([]); setMsg(null); };
    return (
      <div className="px-4 pt-4 space-y-3">
        <button onClick={voltar}
          className="flex items-center gap-1.5 text-sm font-semibold text-gray-600 -mb-1 active:text-gray-900">
          <ArrowLeft className="w-4 h-4" /> Voltar para caixas
        </button>
        <div className="bg-gray-900 rounded-2xl p-4 text-white">
          <div className="flex items-start justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-orange-400" />
                <span className="font-mono font-bold">{caixa.codigo}</span>
                <span className="text-[10px] font-bold uppercase bg-gray-700 rounded px-1.5 py-0.5">{isMala ? "Mala" : "Caixa"}</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">{caixa.destino || "sem destino"}{caixa.local_fisico ? ` · ${caixa.local_fisico}` : ""}</p>
            </div>
            <button onClick={voltar} className="flex items-center gap-1 text-xs text-gray-300 bg-gray-800 rounded-lg px-2.5 py-1.5 active:bg-gray-700">
              <ArrowLeft className="w-3.5 h-3.5" /> Trocar
            </button>
          </div>
          <div className="flex items-end justify-between mt-2">
            <p className="text-3xl font-bold">{itens.length} <span className="text-base text-gray-400">item(ns)</span></p>
            {(() => {
              const { total, semPreco } = estimarValorCaixa(itens, params);
              const { pesoKg, semPeso } = estimarPesoCaixa(itens, params);
              return (
                <div className="flex items-end gap-4">
                  <div className="text-right">
                    <p className="text-xs text-gray-400 leading-none">peso estimado</p>
                    <p className="text-xl font-bold text-sky-400">{pesoKg > 0 ? `~${fmtKg(pesoKg)}` : "—"}</p>
                    {semPeso > 0 && <p className="text-[10px] text-gray-500 leading-none">{semPeso} sem medida</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400 leading-none">valor estimado</p>
                    <p className="text-xl font-bold text-emerald-400">~{fmtBRL(total)}</p>
                    {semPreco > 0 && <p className="text-[10px] text-gray-500 leading-none">{semPreco} sem preço</p>}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); processarCodigo(scanInput); }} className="flex gap-2">
          <input value={scanInput} onChange={(e) => setScanInput(e.target.value)} placeholder="Escaneie/digite SKU ou GTIN"
            enterKeyHint="done" autoCapitalize="characters" autoComplete="off" className={`${inputCls} font-mono`} autoFocus />
          <button type="submit" disabled={busy || !scanInput.trim()} className="px-4 rounded-lg bg-orange-500 text-white font-bold disabled:opacity-40">OK</button>
          <button type="button" onClick={() => setScanning(true)} className="px-3 rounded-lg border border-gray-300 text-gray-600 flex items-center" title="Escanear">
            <Camera className="w-5 h-5" />
          </button>
        </form>
        {msg && (
          <p className={`text-sm flex items-center gap-1.5 ${msg.tipo === "ok" ? "text-emerald-600" : "text-red-600"}`}>
            {msg.tipo === "ok" ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />} {msg.texto}
          </p>
        )}

        <div className="flex gap-2">
          <button onClick={imprimir} disabled={!itens.length} className="flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold border border-gray-300 text-gray-700 bg-white rounded-xl py-2.5 disabled:opacity-40">
            <Printer className="w-4 h-4" /> Etiqueta
          </button>
          <button onClick={baixarLista} disabled={!itens.length} className="flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold border border-gray-300 text-gray-700 bg-white rounded-xl py-2.5 disabled:opacity-40">
            <FileDown className="w-4 h-4" /> Lista CSV
          </button>
          <button onClick={fechar} disabled={busy} className="flex-1 flex items-center justify-center gap-1.5 text-sm font-bold bg-gray-900 text-white rounded-xl py-2.5 disabled:opacity-40">
            <Lock className="w-4 h-4" /> Fechar
          </button>
        </div>

        {!itens.length ? (
          <Vazio icon={Package} texto="Caixa vazia. Escaneie os produtos para encaixotar." />
        ) : (
          <div className="space-y-1.5">
            {itens.map((it) => (
              <div key={it.sku} className="bg-white rounded-xl border border-gray-200 px-3 py-2.5 flex items-center gap-3">
                <Miniatura url={fotos[it.sku]} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-gray-900">{it.sku}</span>
                    {estimarValorVenda(it, params) != null && (
                      <span className="text-xs font-semibold text-emerald-600 flex-shrink-0">~{fmtBRL(estimarValorVenda(it, params))}</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 truncate">{it.produto}</p>
                  <IdentLinha it={it} />
                </div>
                <button onClick={() => remover(it.sku)} disabled={busy} className="flex-shrink-0 w-9 h-9 rounded-lg border border-gray-200 text-gray-400 flex items-center justify-center active:bg-gray-100" title="Remover da caixa">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {scanning && (
          <Suspense fallback={null}>
            <LazyScanner qr onDetected={(code) => { setScanning(false); processarCodigo(code); }} onClose={() => setScanning(false)} />
          </Suspense>
        )}
        {printLabels && (
          <Suspense fallback={<div className="fixed inset-0 z-[70] bg-white flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>}>
            <LazyLabelPrint labels={printLabels} user={user} onClose={() => setPrintLabels(null)} />
          </Suspense>
        )}
      </div>
    );
  }

  // ── Sem caixa ativa: criar / escolher ──────────────────────────
  return (
    <div className="px-4 pt-4 space-y-3">
      <p className="text-sm text-gray-500">
        Encaixotamento: abra uma caixa, escaneie os produtos e feche. Os itens <b>herdam o destino e o local</b> da caixa.
      </p>

      {nova ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-3 space-y-2">
          <div className="flex gap-1.5">
            {[{ id: CAIXA_TIPO.CAIXA, t: "Caixa" }, { id: CAIXA_TIPO.MALA, t: "Mala" }].map((m) => (
              <button key={m.id} onClick={() => setTipo(m.id)}
                className={`flex-1 px-2 py-1.5 rounded-lg text-sm font-semibold border ${tipo === m.id ? "bg-orange-500 text-white border-orange-500" : "bg-white text-gray-600 border-gray-300"}`}>
                {m.t}
              </button>
            ))}
          </div>
          <select value={destino} onChange={(e) => setDestino(e.target.value)} className={inputCls}>
            {DESTINOS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <input value={local} onChange={(e) => setLocal(e.target.value)} className={inputCls} placeholder="Local físico (ex.: estante 2)" />
          {msg?.tipo === "erro" && <p className="text-xs text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {msg.texto}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setNova(false); setMsg(null); }} className="flex-1 rounded-lg border border-gray-300 text-gray-600 py-2.5 text-sm font-semibold">Cancelar</button>
            <button onClick={criar} disabled={busy} className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-orange-500 text-white py-2.5 text-sm font-bold disabled:opacity-40">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Criar caixa
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => { setNova(true); setMsg(null); }}
          className="w-full flex items-center justify-center gap-2 bg-orange-500 text-white rounded-2xl py-3.5 font-bold shadow-sm active:bg-orange-600">
          <Plus className="w-5 h-5" /> Nova caixa / mala
        </button>
      )}

      {abertas === null ? <Carregando /> : !abertas.length ? (
        <Vazio icon={Package} texto="Nenhuma caixa aberta. Crie uma para começar." />
      ) : (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 pt-1">Caixas abertas ({abertas.length})</p>
          <div className="space-y-1.5">
            {abertas.map((c) => (
              <button key={c.codigo} onClick={() => abrirCaixa(c)}
                className="w-full text-left bg-white rounded-xl border border-gray-200 px-3 py-2.5 flex items-center gap-3 active:bg-gray-100">
                <span className="w-9 h-9 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center flex-shrink-0">
                  {c.tipo === CAIXA_TIPO.MALA ? <Inbox className="w-4 h-4" /> : <Package className="w-4 h-4" />}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="font-mono text-sm font-bold text-gray-900">{c.codigo}</span>
                  <p className="text-xs text-gray-500">{c.destino || "sem destino"}{c.local_fisico ? ` · ${c.local_fisico}` : ""}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
              </button>
            ))}
          </div>
        </>
      )}

      {/* Caixas fechadas: consulta de conteúdo e destino (somente leitura). */}
      {fechadas && fechadas.length > 0 && (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 pt-2">Caixas fechadas ({fechadas.length})</p>
          <div className="space-y-1.5">
            {fechadas.map((c) => <CaixaFechadaItem key={c.codigo} caixa={c} params={params} user={user} />)}
          </div>
        </>
      )}
    </div>
  );
}

// Linha de caixa FECHADA: expande para mostrar o conteúdo (carregado sob demanda),
// com peso/valor estimados, a lista de itens e a impressão da etiqueta (mesmo
// controle de vias dos demais tíquetes). Destino/local já ficam visíveis na linha.
function CaixaFechadaItem({ caixa, params, user }) {
  const [aberta, setAberta] = useState(false);
  const [itens, setItens] = useState(null);
  const [printLabels, setPrintLabels] = useState(null);
  const [vias, setVias] = useState(null); // { vias, ultima } a partir do histórico

  // Carrega o nº de vias já impressas da etiqueta desta caixa.
  const carregarVias = useCallback(async () => {
    const m = await buscarViasImpressaoCaixa([caixa.codigo]);
    setVias(m[caixa.codigo] || { vias: 0, ultima: null });
  }, [caixa.codigo]);
  useEffect(() => { carregarVias(); }, [carregarVias]);

  // Garante que os itens estejam carregados (usado ao expandir e ao imprimir).
  const garantirItens = async () => {
    if (itens !== null) return itens;
    const data = await itensDaCaixa(caixa.codigo);
    setItens(data);
    return data;
  };

  const toggle = async () => {
    const next = !aberta;
    setAberta(next);
    if (next) await garantirItens();
  };

  const imprimir = async (e) => {
    e.stopPropagation();
    const data = await garantirItens();
    setPrintLabels([buildBoxLabel(caixa, data, params)]);
  };

  const fecharImpressao = async () => {
    setPrintLabels(null);
    await carregarVias(); // reflete a nova via impressa
  };

  const { total } = itens ? estimarValorCaixa(itens, params) : { total: 0 };
  const { pesoKg } = itens ? estimarPesoCaixa(itens, params) : { pesoKg: 0 };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button onClick={toggle} className="w-full text-left px-3 py-2.5 flex items-center gap-3 active:bg-gray-100">
        <span className="w-9 h-9 rounded-lg bg-gray-100 text-gray-400 flex items-center justify-center flex-shrink-0">
          {caixa.tipo === CAIXA_TIPO.MALA ? <Inbox className="w-4 h-4" /> : <Package className="w-4 h-4" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold text-gray-900">{caixa.codigo}</span>
            <span className="text-[10px] font-bold uppercase bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">Fechada</span>
            {vias?.vias > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] font-bold text-gray-500" title={`Etiqueta impressa · ${vias.vias} via(s)`}>
                <Printer className="w-3 h-3" /> {vias.vias}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 truncate">{caixa.destino || "sem destino"}{caixa.local_fisico ? ` · ${caixa.local_fisico}` : ""}</p>
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-300 flex-shrink-0 transition-transform ${aberta ? "rotate-180" : ""}`} />
      </button>
      {aberta && (
        <div className="border-t border-gray-100 px-3 py-2.5 bg-gray-50 space-y-2.5">
          {itens === null ? (
            <div className="flex justify-center py-3"><Loader2 className="w-5 h-5 animate-spin text-orange-500" /></div>
          ) : (
            <>
              {!itens.length ? (
                <p className="text-xs text-gray-400 text-center py-2">Caixa vazia.</p>
              ) : (
                <>
                  <div className="flex items-center justify-between text-xs text-gray-600">
                    <span><b>{itens.length}</b> item(ns)</span>
                    <span>peso <b>{pesoKg > 0 ? `~${fmtKg(pesoKg)}` : "—"}</b> · valor <b className="text-emerald-600">~{fmtBRL(total)}</b></span>
                  </div>
                  <div className="space-y-1">
                    {itens.map((it) => (
                      <div key={it.sku} className="flex items-center gap-2 text-xs">
                        <span className="font-mono font-bold text-gray-800">{it.sku}</span>
                        {it.classe && <span className={`px-1 py-0.5 rounded text-[10px] font-bold ${CLASSE_STYLE[it.classe] || "bg-gray-400 text-white"}`}>{it.classe}</span>}
                        <span className="text-gray-500 truncate flex-1">{it.produto}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <button onClick={imprimir}
                className="w-full flex items-center justify-center gap-1.5 text-sm font-semibold border border-gray-300 text-gray-700 bg-white rounded-xl py-2.5 active:bg-gray-100">
                <Printer className="w-4 h-4" /> Imprimir etiqueta{vias?.vias > 0 ? ` · ${vias.vias + 1}ª via` : ""}
              </button>
            </>
          )}
        </div>
      )}
      {printLabels && (
        <Suspense fallback={<div className="fixed inset-0 z-[70] bg-white flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>}>
          <LazyLabelPrint labels={printLabels} user={user} onClose={fecharImpressao} />
        </Suspense>
      )}
    </div>
  );
}

// ───────────────────────── Inventário físico por lote ─────────────────────────
function Inventario({ lotes, user, refreshKey, onChanged }) {
  const [fLote, setFLote] = useState("");
  const [itens, setItens] = useState(null);
  const [scanInput, setScanInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [msg, setMsg] = useState(null); // { tipo, texto }
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!fLote) { setItens(null); return; }
    setItens(null);
    const data = await fetchItens((q) => (fLote === LOTE_SEM ? q.is("lote", null) : q.eq("lote", Number(fLote))));
    setItens(data);
  }, [fLote]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const conferidos = itens ? itens.filter((i) => i.conferido_em).length : 0;
  const fotos = useThumbs(itens);

  const conferir = async (sku, jaConferido) => {
    setBusy(true);
    try {
      if (jaConferido) {
        await limparConferencia(sku);
        setItens((arr) => arr.map((i) => (i.sku === sku ? { ...i, conferido_em: null, conferido_por: null } : i)));
      } else {
        await marcarConferido(sku, user);
        setItens((arr) => arr.map((i) => (i.sku === sku ? { ...i, conferido_em: new Date().toISOString(), conferido_por: user.email } : i)));
      }
      onChanged?.();
    } catch (e) {
      setMsg({ tipo: "erro", texto: e.message || String(e) });
    } finally {
      setBusy(false);
    }
  };

  const processarCodigo = async (codigo) => {
    const c = String(codigo || "").trim();
    if (!c || !itens) return;
    const cn = c.toUpperCase();
    const alvo = itens.find((i) => i.sku.toUpperCase() === cn || (i.gtin && i.gtin === c));
    setScanInput("");
    if (!alvo) { setMsg({ tipo: "erro", texto: `"${c}" não pertence a este lote.` }); return; }
    if (alvo.conferido_em) { setMsg({ tipo: "ok", texto: `${alvo.sku} já estava conferido.` }); return; }
    await conferir(alvo.sku, false);
    setMsg({ tipo: "ok", texto: `${alvo.sku} conferido ✓` });
  };

  const reiniciar = async () => {
    if (!itens) return;
    if (!window.confirm("Limpar a conferência de todos os itens deste lote?")) return;
    setBusy(true);
    try {
      for (const it of itens.filter((i) => i.conferido_em)) await limparConferencia(it.sku);
      setItens((arr) => arr.map((i) => ({ ...i, conferido_em: null, conferido_por: null })));
      onChanged?.();
    } finally { setBusy(false); }
  };

  return (
    <div className="px-4 pt-4 space-y-4">
      <select value={fLote} onChange={(e) => setFLote(e.target.value)} className={inputCls}>
        <option value="">Escolha um lote para conferir…</option>
        <option value={LOTE_SEM}>Sem lote</option>
        {lotes.map((l) => <option key={l.lote} value={String(l.lote)}>Lote {l.lote} — {l.referencia || ""}</option>)}
      </select>

      {!fLote ? (
        <Vazio icon={ScanLine} texto="Selecione um lote para iniciar a conferência física." />
      ) : itens === null ? (
        <Carregando />
      ) : (
        <>
          <div className="bg-gray-900 rounded-2xl p-4 text-white">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs uppercase tracking-widest text-gray-400 font-semibold">Conferidos</p>
                <p className="text-3xl font-bold mt-1">{conferidos} <span className="text-base text-gray-400">de {itens.length}</span></p>
              </div>
              <button onClick={reiniciar} disabled={busy || !conferidos}
                className="flex items-center gap-1.5 text-xs font-semibold bg-gray-800 rounded-full px-3 py-1.5 disabled:opacity-40">
                <RotateCcw className="w-3.5 h-3.5" /> Reiniciar
              </button>
            </div>
            <div className="h-2 bg-gray-700 rounded-full mt-3 overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${itens.length ? (conferidos / itens.length) * 100 : 0}%` }} />
            </div>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); processarCodigo(scanInput); }} className="flex gap-2">
            <input value={scanInput} onChange={(e) => setScanInput(e.target.value)} placeholder="Escaneie/digite SKU ou GTIN"
              enterKeyHint="done" autoCapitalize="characters" autoComplete="off"
              className={`${inputCls} font-mono`} autoFocus />
            <button type="submit" disabled={busy || !scanInput.trim()}
              className="px-4 rounded-lg bg-orange-500 text-white font-bold disabled:opacity-40">OK</button>
            <button type="button" onClick={() => setScanning(true)}
              className="px-3 rounded-lg border border-gray-300 text-gray-600 flex items-center" title="Escanear">
              <Camera className="w-5 h-5" />
            </button>
          </form>
          {msg && (
            <p className={`text-sm flex items-center gap-1.5 ${msg.tipo === "ok" ? "text-emerald-600" : "text-red-600"}`}>
              {msg.tipo === "ok" ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />} {msg.texto}
            </p>
          )}

          <div className="space-y-1.5">
            {itens.map((it) => {
              const ok = !!it.conferido_em;
              return (
                <button key={it.sku} onClick={() => conferir(it.sku, ok)} disabled={busy}
                  className={`w-full text-left rounded-xl border px-3 py-2.5 flex items-center gap-3 ${ok ? "bg-emerald-50 border-emerald-200" : "bg-white border-gray-200"}`}>
                  {ok ? <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" /> : <Circle className="w-5 h-5 text-gray-300 flex-shrink-0" />}
                  <Miniatura url={fotos[it.sku]} />
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-xs font-bold text-gray-900">{it.sku}</span>
                    <p className="text-sm text-gray-600 truncate">{it.produto}</p>
                    <IdentLinha it={it} />
                    {ok && <p className="text-xs text-emerald-700">por {it.conferido_por} · {new Date(it.conferido_em).toLocaleString("pt-BR")}</p>}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {scanning && (
        <Suspense fallback={null}>
          <LazyScanner onDetected={(code) => { setScanning(false); processarCodigo(code); }} onClose={() => setScanning(false)} />
        </Suspense>
      )}
    </div>
  );
}

// ───────────────────────── Pendências de dados ─────────────────────────
function Pendencias({ lotes, onOpen, refreshKey }) {
  const [fLote, setFLote] = useState("");
  const [itens, setItens] = useState(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      setItens(null);
      const data = await fetchItens((q) =>
        fLote === LOTE_SEM ? q.is("lote", null) : fLote ? q.eq("lote", Number(fLote)) : q);
      if (!cancelado) setItens(data);
    })();
    return () => { cancelado = true; };
  }, [fLote, refreshKey]);

  const incompletos = itens
    ? itens.map((it) => ({ it, ...checarCompletude(it) })).filter((x) => !x.ok)
    : [];
  const fotos = useThumbs(itens);

  return (
    <div className="px-4 pt-4 space-y-4">
      <select value={fLote} onChange={(e) => setFLote(e.target.value)} className={inputCls}>
        <option value="">Todos os lotes</option>
        <option value={LOTE_SEM}>Sem lote</option>
        {lotes.map((l) => <option key={l.lote} value={String(l.lote)}>Lote {l.lote} — {l.referencia || ""}</option>)}
      </select>

      {itens === null ? (
        <Carregando />
      ) : !incompletos.length ? (
        <Vazio icon={CheckCircle2} texto="Nenhuma pendência de cadastro. Tudo pronto para exportar." />
      ) : (
        <>
          <p className="text-sm text-gray-500">{incompletos.length} de {itens.length} itens com campos faltando para anunciar.</p>
          <div className="space-y-1.5">
            {incompletos.map(({ it, faltando }) => (
              <button key={it.sku} onClick={() => onOpen(it)}
                className="w-full text-left bg-white rounded-xl border border-gray-200 px-3 py-2.5 flex items-center gap-3 active:bg-gray-100">
                <Miniatura url={fotos[it.sku]} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-gray-900">{it.sku}</span>
                    <span className="text-xs text-gray-400">{it.lote ? `Lote ${it.lote}` : "Sem lote"}</span>
                  </div>
                  <p className="text-sm text-gray-600 truncate">{it.produto}</p>
                  <IdentLinha it={it} />
                  <div className="flex flex-wrap gap-1 mt-1">
                    {faltando.map((f) => (
                      <span key={f} className="text-xs bg-amber-100 text-amber-800 rounded px-1.5 py-0.5 font-medium">{f}</span>
                    ))}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ───────────────────────── auxiliares ─────────────────────────
// Miniaturas (1ª foto) dos itens da lista. Evita carregar muitas URLs de uma vez.
function useThumbs(itens, cap = 600) {
  const [fotos, setFotos] = useState({});
  useEffect(() => {
    if (!itens || !itens.length || itens.length > cap) { setFotos({}); return; }
    let cancel = false;
    (async () => {
      const map = await primeirasFotos(itens.map((i) => i.sku));
      if (!cancel) setFotos(map);
    })();
    return () => { cancel = true; };
  }, [itens, cap]);
  return fotos;
}

const Miniatura = ({ url }) => (
  <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100 flex items-center justify-center">
    {url ? <img src={url} alt="" loading="lazy" className="w-full h-full object-cover" /> : <Camera className="w-4 h-4 text-gray-300" />}
  </div>
);

const IdentLinha = ({ it }) =>
  (it.grupo || it.marca || it.modelo) ? (
    <div className="flex items-center gap-1.5 flex-wrap text-xs text-gray-400 mt-0.5">
      {it.grupo && <span className="bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">{it.grupo}</span>}
      {(it.marca || it.modelo) && <span className="truncate">{[it.marca, it.modelo].filter(Boolean).join(" ")}</span>}
    </div>
  ) : null;

const Carregando = () => <div className="py-16 text-center"><Loader2 className="w-7 h-7 animate-spin text-orange-500 mx-auto" /></div>;
const Vazio = ({ icon: Icon, texto }) => (
  <div className="text-center py-16 text-gray-400">
    <Icon className="w-10 h-10 mx-auto mb-2 opacity-40" />
    <p className="text-sm px-8">{texto}</p>
  </div>
);
