import React, { useState, useEffect, useCallback, Suspense } from "react";
import {
  listarCaixas, buscarCaixa, itensDaCaixa,
  registrarChegada, conferirCaixa,
  marcarItemAvariado, marcarItemFaltando, historicoCaixa,
} from "../lib/caixas";
import { marcarConferido, limparConferencia } from "../lib/conferencia";
import { estimarValorCaixa, estimarValorVenda, estimarPesoCaixa } from "../lib/classificacao";
import { CLASSE_STYLE, fmtBRL, fmtKg } from "../lib/model";
import {
  X, Loader2, ScanLine, ArrowRight, AlertTriangle, Boxes, Package, ChevronRight,
  ChevronLeft, MapPin, CalendarCheck, ClipboardCheck, PackageX, Search, CheckCircle2, History, QrCode,
} from "lucide-react";

const BarcodeScanner = React.lazy(() => import("./BarcodeScanner"));

// data de hoje em "YYYY-MM-DD" (para o <input type=date>).
const hojeISO = () => new Date().toISOString().slice(0, 10);

// Extrai o SKU do texto lido do QR da etiqueta do item. A etiqueta codifica o
// SKU puro (ex.: "NOG-126-001"), mas toleramos também um deep-link "?item=SKU".
const skuDoQR = (texto) => {
  const t = String(texto || "").trim();
  const m = t.match(/[?&]item=([^&]+)/i);
  return (m ? decodeURIComponent(m[1]) : t).trim().toUpperCase();
};

const eventoCaixaLabel = (a) => ({
  "caixa:criada": "caixa criada", "caixa:item_add": "item encaixotado",
  "caixa:item_remove": "item removido", "caixa:fechada": "caixa fechada",
  "caixa:reaberta": "caixa reaberta", "caixa:chegada": "chegada registrada",
  "caixa:local": "armazenamento", "caixa:conferida": "caixa conferida",
  "caixa:item_avaria": "item avariado", "caixa:item_faltando": "item faltando",
}[a] || a);

// Tela de caixas: lista (com filtro), scan por QR e detalhe/conferência.
export default function CaixasScreen({ params, user, onClose, onOpenItem }) {
  const [fase, setFase] = useState("lista"); // "lista" | "scan" | "buscando" | "detalhe"
  const [filtro, setFiltro] = useState("pendentes"); // "pendentes" | "conferidas" | "todas"
  const [caixas, setCaixas] = useState([]);
  const [caixa, setCaixa] = useState(null);
  const [itens, setItens] = useState([]);
  const [hist, setHist] = useState([]);
  const [erro, setErro] = useState(null);
  const [manual, setManual] = useState("");

  const carregarLista = useCallback(async () => {
    setCaixas(await listarCaixas());
  }, []);
  useEffect(() => { carregarLista(); }, [carregarLista]);

  const abrir = async (texto) => {
    const cod = String(texto || "").trim();
    if (!cod) return;
    setFase("buscando"); setErro(null);
    try {
      const c = await buscarCaixa(cod);
      if (!c) { setErro(`Nenhuma caixa/mala com o código "${cod}".`); setFase(caixas.length ? "lista" : "scan"); return; }
      setCaixa(c);
      setItens(await itensDaCaixa(c.codigo));
      setHist(await historicoCaixa(c.codigo));
      setFase("detalhe");
    } catch (e) {
      setErro("Falha ao buscar: " + (e.message || String(e))); setFase("lista");
    }
  };

  const recarregarDetalhe = async () => {
    if (!caixa) return;
    const c = await buscarCaixa(caixa.codigo);
    setCaixa(c);
    setItens(await itensDaCaixa(c.codigo));
    setHist(await historicoCaixa(c.codigo));
  };

  const voltarLista = async () => { setCaixa(null); setErro(null); setManual(""); await carregarLista(); setFase("lista"); };

  // ---- Fase: detalhe/conferência ----
  if (fase === "detalhe" && caixa) {
    return (
      <CaixaDetalhe
        caixa={caixa} itens={itens} hist={hist} params={params} user={user}
        onBack={voltarLista} onClose={onClose} onOpenItem={onOpenItem}
        onChanged={recarregarDetalhe}
      />
    );
  }

  // ---- Fase: buscando ----
  if (fase === "buscando") {
    return (
      <div className="fixed inset-0 z-50 bg-gray-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  // ---- Fase: scan ----
  if (fase === "scan") {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col">
        <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>}>
          <BarcodeScanner qr onClose={() => setFase("lista")} onDetected={abrir}
            title="Caixa por QR — escaneie a etiqueta" hint="Aponte para o QR da etiqueta de caixa/mala." />
        </Suspense>
        <div className="absolute bottom-0 inset-x-0 bg-black/80 px-4 py-3">
          {erro && <p className="text-amber-300 text-xs mb-2 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {erro}</p>}
          <form onSubmit={(e) => { e.preventDefault(); abrir(manual); }} className="flex gap-2">
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="ou digite o código (ex.: CX-001)"
              autoCapitalize="characters" autoComplete="off"
              className="flex-1 rounded-lg border border-gray-600 bg-gray-900 text-white px-3 py-2.5 text-sm font-mono placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500" />
            <button type="submit" className="px-4 rounded-lg bg-orange-500 text-white font-semibold flex items-center gap-1 text-sm">
              Abrir <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ---- Fase: lista ----
  const filtradas = caixas.filter((c) =>
    filtro === "todas" ? true : filtro === "conferidas" ? !!c.conferida_em : !c.conferida_em
  );

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col">
      <div className="bg-gray-900 text-white px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-sm flex items-center gap-1.5"><Boxes className="w-4 h-4" /> Conferência de caixas</span>
          <button onClick={onClose} aria-label="Fechar"><X className="w-6 h-6 text-gray-300" /></button>
        </div>
        <div className="mt-3 flex gap-2">
          {[["pendentes", "A conferir"], ["conferidas", "Conferidas"], ["todas", "Todas"]].map(([id, label]) => (
            <button key={id} onClick={() => setFiltro(id)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold ${filtro === id ? "bg-orange-500 text-white" : "bg-gray-800 text-gray-300"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white border-b border-gray-200 px-4 py-3 flex gap-2">
        <button onClick={() => { setErro(null); setManual(""); setFase("scan"); }}
          className="flex-1 flex items-center justify-center gap-2 bg-gray-900 text-white rounded-xl py-2.5 text-sm font-bold active:bg-gray-800">
          <ScanLine className="w-4 h-4" /> Escanear QR
        </button>
        <form onSubmit={(e) => { e.preventDefault(); abrir(manual); }} className="flex-1 flex gap-2">
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="código (CX-001)"
            autoCapitalize="characters" autoComplete="off"
            className="flex-1 min-w-0 rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-500" />
          <button type="submit" aria-label="Abrir" className="px-3 rounded-lg bg-orange-500 text-white"><Search className="w-4 h-4" /></button>
        </form>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {erro && <p className="text-sm text-red-600 mb-3 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {erro}</p>}
        {!filtradas.length ? (
          <p className="text-sm text-gray-400 text-center py-10">Nenhuma caixa {filtro === "conferidas" ? "conferida" : filtro === "pendentes" ? "pendente" : ""}.</p>
        ) : (
          <div className="space-y-1.5">
            {filtradas.map((c) => (
              <button key={c.codigo} onClick={() => abrir(c.codigo)}
                className="w-full text-left bg-white rounded-xl border border-gray-200 px-3 py-2.5 flex items-center gap-3 active:bg-gray-100">
                {c.tipo === "MALA" ? <Boxes className="w-5 h-5 text-gray-400" /> : <Package className="w-5 h-5 text-gray-400" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-gray-900">{c.codigo}</span>
                    {c.conferida_em
                      ? <span className="text-[10px] font-bold uppercase bg-emerald-100 text-emerald-700 rounded px-1.5 py-0.5">conferida</span>
                      : <span className="text-[10px] font-bold uppercase bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">a conferir</span>}
                  </div>
                  <p className="text-xs text-gray-500 truncate">{c.local_fisico || "sem local"}{c.chegou_em ? ` · chegou ${new Date(c.chegou_em).toLocaleDateString("pt-BR")}` : ""}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Detalhe/conferência de uma caixa: avaliação, chegada+armazenamento, itens e histórico.
function CaixaDetalhe({ caixa, itens, hist, params, user, onBack, onClose, onOpenItem, onChanged }) {
  const { total, semPreco } = estimarValorCaixa(itens, params);
  const { pesoKg, semPeso } = estimarPesoCaixa(itens, params);

  const [local, setLocal] = useState(caixa.local_fisico || "");
  const [dataChegada, setDataChegada] = useState(caixa.chegou_em ? String(caixa.chegou_em).slice(0, 10) : hojeISO());
  const [salvando, setSalvando] = useState(null); // "chegada" | "conferir" | "local"
  const [busy, setBusy] = useState({}); // { [sku]: "avaria" | "faltando" | "conf" }
  const [erro, setErro] = useState(null);
  const [scanOpen, setScanOpen] = useState(false); // scanner contínuo de conferência por QR
  const [scanMsg, setScanMsg] = useState(null); // { tom: "ok"|"dup"|"warn"|"err", texto }

  const conferidos = itens.filter((i) => i.conferido_em).length;

  const doChegada = async () => {
    setSalvando("chegada"); setErro(null);
    try { await registrarChegada(caixa.codigo, { chegou_em: dataChegada, local }, user); await onChanged(); }
    catch (e) { setErro(e.message || String(e)); }
    finally { setSalvando(null); }
  };
  const doConferir = async () => {
    setSalvando("conferir"); setErro(null);
    try { await conferirCaixa(caixa.codigo, user); await onChanged(); }
    catch (e) { setErro(e.message || String(e)); }
    finally { setSalvando(null); }
  };
  const doAvaria = async (sku) => {
    setBusy((b) => ({ ...b, [sku]: "avaria" })); setErro(null);
    try { await marcarItemAvariado(sku, user); await onChanged(); }
    catch (e) { setErro(e.message || String(e)); }
    finally { setBusy((b) => { const n = { ...b }; delete n[sku]; return n; }); }
  };
  const doFaltando = async (sku) => {
    setBusy((b) => ({ ...b, [sku]: "faltando" })); setErro(null);
    try { await marcarItemFaltando(sku, user); await onChanged(); }
    catch (e) { setErro(e.message || String(e)); }
    finally { setBusy((b) => { const n = { ...b }; delete n[sku]; return n; }); }
  };

  // Alterna a marcação de conferido de um item (checkbox). Reusa a conferência
  // de inventário já existente (itens.conferido_em/por).
  const doToggleConf = async (it) => {
    setBusy((b) => ({ ...b, [it.sku]: "conf" })); setErro(null);
    try {
      if (it.conferido_em) await limparConferencia(it.sku);
      else await marcarConferido(it.sku, user);
      await onChanged();
    } catch (e) { setErro(e.message || String(e)); }
    finally { setBusy((b) => { const n = { ...b }; delete n[it.sku]; return n; }); }
  };

  // Conferência por QR (leitura contínua): marca conferido na hora o item lido,
  // desde que ele pertença a esta caixa. Dá feedback e segue lendo o próximo.
  const handleScanItem = async (texto) => {
    const sku = skuDoQR(texto);
    const it = itens.find((i) => String(i.sku).toUpperCase() === sku);
    if (!it) { setScanMsg({ tom: "warn", texto: `${sku} não é desta caixa` }); return; }
    if (it.conferido_em) { setScanMsg({ tom: "dup", texto: `${sku} já estava conferido` }); return; }
    try {
      await marcarConferido(it.sku, user);
      await onChanged();
      setScanMsg({ tom: "ok", texto: `${it.sku} conferido ✓` });
    } catch (e) {
      setScanMsg({ tom: "err", texto: e.message || String(e) });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col">
      <div className="bg-gray-900 text-white px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-300"><ChevronLeft className="w-5 h-5" /> Caixas</button>
          <button onClick={onClose} aria-label="Fechar"><X className="w-6 h-6 text-gray-300" /></button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="font-mono text-lg font-bold text-orange-400">{caixa.codigo}</span>
          {caixa.conferida_em && <span className="text-[10px] font-bold uppercase bg-emerald-600 rounded px-1.5 py-0.5">conferida</span>}
          {caixa.status === "FECHADA" && <span className="text-[10px] font-bold uppercase bg-gray-700 rounded px-1.5 py-0.5">fechada</span>}
        </div>
        <div className="flex items-end justify-between mt-2">
          <p className="text-3xl font-bold">{itens.length} <span className="text-base text-gray-400">item(ns)</span></p>
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
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {erro && <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {erro}</p>}

        {/* Chegada + armazenamento */}
        <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2.5">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500 flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Chegada e armazenamento</p>
          <label className="block">
            <span className="text-xs text-gray-500">Local de armazenamento</span>
            <input value={local} onChange={(e) => setLocal(e.target.value)} placeholder="ex.: Belém · Galpão A"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Data de chegada</span>
            <input type="date" value={dataChegada} onChange={(e) => setDataChegada(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
          </label>
          <button onClick={doChegada} disabled={salvando === "chegada"}
            className="w-full flex items-center justify-center gap-2 bg-orange-500 text-white rounded-xl py-2.5 text-sm font-bold active:bg-orange-600 disabled:opacity-60">
            {salvando === "chegada" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck className="w-4 h-4" />}
            Registrar chegada + armazenamento
          </button>
          <p className="text-[11px] text-gray-400">O local é aplicado à caixa e a todos os {itens.length} item(ns) dela.</p>
        </div>

        {/* Itens */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
              Itens da caixa · <span className="text-emerald-600">{conferidos}/{itens.length} conferidos</span>
            </p>
            {itens.length > 0 && (
              <button onClick={() => { setScanMsg(null); setScanOpen(true); }}
                className="flex items-center gap-1.5 rounded-lg bg-gray-900 text-white px-3 py-1.5 text-xs font-bold active:bg-gray-800">
                <QrCode className="w-3.5 h-3.5" /> Ler QR
              </button>
            )}
          </div>
          {!itens.length ? (
            <p className="text-sm text-gray-400 text-center py-6">Caixa vazia.</p>
          ) : (
            <div className="space-y-1.5">
              {itens.map((it) => {
                const v = estimarValorVenda(it, params);
                const b = busy[it.sku];
                return (
                  <div key={it.sku} className={`rounded-xl border px-3 py-2.5 ${it.conferido_em ? "border-emerald-300 bg-emerald-50/50" : "border-gray-200 bg-white"}`}>
                    <div className="flex items-center gap-3">
                      <input type="checkbox" checked={!!it.conferido_em} disabled={b === "conf"}
                        onChange={() => doToggleConf(it)} aria-label={`Conferido ${it.sku}`}
                        className="w-5 h-5 flex-shrink-0 accent-emerald-600 disabled:opacity-50" />
                      <button onClick={() => onOpenItem?.(it)} className="flex-1 min-w-0 text-left flex items-center gap-3 active:opacity-70">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-gray-900">{it.sku}</span>
                            {it.classe && <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${CLASSE_STYLE[it.classe] || "bg-gray-400 text-white"}`}>{it.classe}</span>}
                            {it.estado === "Avariado" && <span className="text-[10px] font-bold uppercase bg-red-100 text-red-700 rounded px-1.5 py-0.5">avariado</span>}
                            {v != null && <span className="ml-auto text-xs font-semibold text-emerald-600">~{fmtBRL(v)}</span>}
                          </div>
                          <p className="text-sm text-gray-600 truncate">{it.produto}</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
                      </button>
                    </div>
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => doAvaria(it.sku)} disabled={!!b || it.estado === "Avariado"}
                        className="flex-1 flex items-center justify-center gap-1 rounded-lg border border-amber-300 text-amber-700 py-1.5 text-xs font-semibold active:bg-amber-50 disabled:opacity-50">
                        {b === "avaria" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />} Avariado
                      </button>
                      <button onClick={() => doFaltando(it.sku)} disabled={!!b}
                        className="flex-1 flex items-center justify-center gap-1 rounded-lg border border-red-300 text-red-700 py-1.5 text-xs font-semibold active:bg-red-50 disabled:opacity-50">
                        {b === "faltando" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PackageX className="w-3.5 h-3.5" />} Faltando
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Histórico */}
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Histórico da caixa</p>
          {!hist.length ? (
            <p className="text-sm text-gray-400">Sem histórico ainda.</p>
          ) : (
            <div className="space-y-1">
              {hist.map((e) => (
                <div key={e.id} className="bg-white rounded-lg border border-gray-200 px-3 py-2 text-sm">
                  <span className="text-gray-800">{eventoCaixaLabel(e.acao)}</span>
                  {e.detalhe && <span className="text-gray-500"> · {e.detalhe}</span>}
                  <p className="text-[11px] text-gray-400">{e.usuario} · {new Date(e.ts).toLocaleString("pt-BR")}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white border-t border-gray-200 px-4 py-3">
        <button onClick={doConferir} disabled={salvando === "conferir"}
          className="w-full flex items-center justify-center gap-2 bg-gray-900 text-white rounded-xl py-3 font-bold active:bg-gray-800 disabled:opacity-60">
          {salvando === "conferir" ? <Loader2 className="w-5 h-5 animate-spin" /> : <ClipboardCheck className="w-5 h-5" />}
          {caixa.conferida_em ? "Conferir novamente" : "Marcar caixa conferida"}
          {caixa.conferida_em && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
        </button>
      </div>

      {/* Scanner contínuo: lê o QR do item e marca conferido na hora, seguindo p/ o próximo. */}
      {scanOpen && (
        <>
          <Suspense fallback={<div className="fixed inset-0 z-[60] bg-black flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>}>
            <BarcodeScanner qr continuous onClose={() => setScanOpen(false)} onDetected={handleScanItem}
              title="Conferir itens por QR" hint="Aponte para o QR da etiqueta do item — marca conferido na hora." />
          </Suspense>
          <div className="fixed inset-x-0 bottom-0 z-[70] px-4 pb-4 pt-3 bg-gradient-to-t from-black/90 to-transparent">
            <div className="max-w-lg mx-auto space-y-2">
              <p className="text-center text-sm font-semibold text-white">{conferidos}/{itens.length} conferidos</p>
              {scanMsg && (
                <p className={`text-center text-sm font-bold rounded-lg py-2 ${
                  scanMsg.tom === "ok" ? "bg-emerald-500 text-white"
                    : scanMsg.tom === "dup" ? "bg-sky-500 text-white"
                    : scanMsg.tom === "warn" ? "bg-amber-500 text-white"
                    : "bg-red-500 text-white"}`}>
                  {scanMsg.texto}
                </p>
              )}
              <button onClick={() => setScanOpen(false)}
                className="w-full bg-white text-gray-900 rounded-xl py-3 font-bold active:bg-gray-100">
                Concluir
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
