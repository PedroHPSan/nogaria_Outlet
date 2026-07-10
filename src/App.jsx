import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./lib/supabase";
import Login from "./screens/Login";
import Dashboard from "./screens/Dashboard";
import ItemsScreen from "./screens/ItemsScreen";
import ItemDetail from "./screens/ItemDetail";
import NewItem from "./screens/NewItem";
import ExportScreen from "./screens/ExportScreen";
import ConferenciaScreen from "./screens/ConferenciaScreen";
import VendasScreen from "./screens/VendasScreen";
import PortfolioScreen from "./screens/PortfolioScreen";
import { statusMeta } from "./lib/model";
import { carregarParametros } from "./lib/pricingParams";
import { DEFAULT_PARAMS } from "./lib/pricing";
import { Package, BarChart3, ClipboardList, History, Upload, LogOut, Loader2, Plus, ClipboardCheck, QrCode, Boxes, Receipt, Footprints } from "lucide-react";
import FotoQrScreen from "./screens/FotoQrScreen";
import CaixasScreen from "./screens/CaixasScreen";

// Rótulo amigável de um evento na aba Registro (status:*, lote:atribuido, conferido).
const eventoLabel = (e) => {
  const a = e.acao || "";
  if (a.startsWith("status:")) return "→ " + statusMeta(a.replace("status:", "")).label + (e.detalhe ? ` (${e.detalhe})` : "");
  if (a === "lote:atribuido") return "lote atribuído" + (e.detalhe ? ` (${e.detalhe})` : "");
  if (a === "conferido") return "conferido ✓";
  if (a === "desmembrado") return "desmembrado" + (e.detalhe ? ` (${e.detalhe})` : "");
  if (a === "etiqueta:impressa") return "etiqueta impressa" + (e.detalhe ? ` (${e.detalhe})` : "");
  if (a === "teste:dispensado") return "teste dispensado" + (e.detalhe ? ` (${e.detalhe})` : "");
  if (a === "medidas:medido") return "medidas confirmadas ✓" + (e.detalhe ? ` (${e.detalhe})` : "");
  if (a === "medidas:estimado") return "medidas estimadas" + (e.detalhe ? ` (${e.detalhe})` : "");
  if (a === "medidas:a_medir") return "marcado p/ medir depois";
  if (a === "caixa:criada") return "caixa criada" + (e.detalhe ? ` (${e.detalhe})` : "");
  if (a === "caixa:item_add") return "encaixotado" + (e.detalhe ? ` → ${e.detalhe}` : "");
  if (a === "caixa:item_remove") return "removido da caixa";
  if (a === "caixa:fechada") return "caixa fechada";
  if (a === "caixa:reaberta") return "caixa reaberta";
  if (a === "caixa:chegada") return "chegada registrada" + (e.detalhe ? ` (${e.detalhe})` : "");
  if (a === "caixa:local") return "armazenamento" + (e.detalhe ? ` → ${e.detalhe}` : "");
  if (a === "caixa:conferida") return "caixa conferida ✓";
  if (a === "caixa:item_avaria") return "item avariado na conferência";
  if (a === "caixa:item_faltando") return "item faltando na conferência";
  return a;
};

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = carregando
  const [lotes, setLotes] = useState([]);
  const [tab, setTab] = useState("painel");
  const [openItem, setOpenItem] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [showFotoQr, setShowFotoQr] = useState(false);
  const [showCaixaQr, setShowCaixaQr] = useState(false);
  const [preFilter, setPreFilter] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [eventos, setEventos] = useState([]);
  const [params, setParams] = useState(DEFAULT_PARAMS); // parâmetros do motor de precificação

  // sessão de autenticação
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // lotes não são realtime; recarrega sob demanda (ex.: ao criar um lote novo)
  const loadLotes = useCallback(() => {
    supabase.from("lotes").select("*").order("lote").then(({ data }) => setLotes(data || []));
  }, []);

  // parâmetros de precificação (tabelas pricing_*); cai em DEFAULT_PARAMS se falhar
  useEffect(() => {
    if (!session) return;
    carregarParametros().then(setParams).catch(() => {});
  }, [session]);

  // Deep-link: abrir direto uma ficha pela URL (?item=SKU). Usado pelo QR exibido
  // no notebook — o celular lê o QR e cai exatamente neste cadastro para fotografar.
  const deepLinkRef = useRef(false);
  useEffect(() => {
    if (!session || deepLinkRef.current) return;
    const sku = new URLSearchParams(window.location.search).get("item");
    if (!sku) return;
    deepLinkRef.current = true;
    (async () => {
      const { data } = await supabase.from("itens").select("*").eq("sku", sku).maybeSingle();
      if (data) { setTab("itens"); setOpenItem(data); }
      // limpa o parâmetro para não reabrir num refresh
      window.history.replaceState({}, "", window.location.pathname);
    })();
  }, [session]);

  // dados base + realtime
  useEffect(() => {
    if (!session) return;
    loadLotes();
    supabase.from("eventos").select("*").order("ts", { ascending: false }).limit(80).then(({ data }) => setEventos(data || []));

    const ch = supabase
      .channel("itens-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "itens" }, () => setRefreshKey((k) => k + 1))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "eventos" }, (p) =>
        setEventos((prev) => [p.new, ...prev].slice(0, 80))
      )
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [session, loadLotes]);

  const onSaved = useCallback(() => setRefreshKey((k) => k + 1), []);
  const onCreated = useCallback(() => { loadLotes(); setRefreshKey((k) => k + 1); setShowNew(false); }, [loadLotes]);
  const goFiltered = (f) => { setPreFilter(f); setTab("itens"); };
  const sair = () => supabase.auth.signOut();

  if (session === undefined)
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>;
  if (!session) return <Login />;

  const user = session.user;

  return (
    <div className="min-h-screen bg-gray-50 max-w-lg mx-auto relative">
      <div className="bg-gray-900 text-white px-4 py-3 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-orange-500 flex items-center justify-center"><Package className="w-4 h-4 text-white" /></div>
          <span className="font-bold tracking-tight">NOGÁRIA OUTLET</span>
        </div>
        <button onClick={sair} className="flex items-center gap-1.5 bg-gray-800 rounded-full pl-3 pr-2 py-1 text-xs font-semibold">
          {user.email?.split("@")[0]} <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>

      {tab === "painel" && <Dashboard lotes={lotes} onGoFiltered={goFiltered} refreshKey={refreshKey} />}
      {tab === "itens" && (
        <ItemsScreen
          key={preFilter ? JSON.stringify(preFilter) : "all"}
          lotes={lotes} initialFilter={preFilter} onOpen={setOpenItem} refreshKey={refreshKey} params={params} user={user}
        />
      )}
      {tab === "conferencia" && (
        <ConferenciaScreen
          lotes={lotes} user={user} params={params} onOpen={setOpenItem} refreshKey={refreshKey}
          onChanged={() => { loadLotes(); onSaved(); }}
        />
      )}
      {tab === "vendas" && (
        <VendasScreen lotes={lotes} onOpen={setOpenItem} user={user} refreshKey={refreshKey} onGoFiltered={goFiltered} />
      )}
      {tab === "portfolio" && <PortfolioScreen refreshKey={refreshKey} onOpen={setOpenItem} params={params} lotes={lotes} />}
      {tab === "exportar" && <ExportScreen lotes={lotes} refreshKey={refreshKey} />}
      {tab === "registro" && (
        <div className="px-4 pt-4 pb-24">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">Últimas atividades</h3>
          {!eventos.length && <p className="text-sm text-gray-400 py-10 text-center">Nenhuma atividade ainda.</p>}
          <div className="space-y-1.5">
            {eventos.map((e) => (
              <div key={e.id} className="bg-white rounded-xl border border-gray-200 px-3 py-2.5 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">{(e.usuario || "?")[0].toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800"><span className="font-mono font-bold">{e.sku}</span> {eventoLabel(e)}</p>
                  <p className="text-xs text-gray-400">{e.usuario} · {new Date(e.ts).toLocaleString("pt-BR")}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="fixed bottom-0 inset-x-0 z-20 bg-white border-t border-gray-200">
        <div className="max-w-lg mx-auto grid grid-cols-7">
          {[
            { id: "painel", icon: BarChart3, t: "Painel" },
            { id: "itens", icon: ClipboardList, t: "Itens" },
            { id: "conferencia", icon: ClipboardCheck, t: "Conferir" },
            { id: "vendas", icon: Receipt, t: "Vendas" },
            { id: "portfolio", icon: Footprints, t: "Catálogo" },
            { id: "exportar", icon: Upload, t: "Exportar" },
            { id: "registro", icon: History, t: "Registro" },
          ].map((n) => (
            <button key={n.id} onClick={() => { if (n.id !== "itens") setPreFilter(null); setTab(n.id); }}
              className={`py-2.5 flex flex-col items-center gap-0.5 text-[11px] font-semibold ${tab === n.id ? "text-orange-600" : "text-gray-400"}`}>
              <n.icon className="w-5 h-5" /> {n.t}
            </button>
          ))}
        </div>
      </div>

      {/* Botões flutuantes: caixa por QR + foto por QR + criar novo item (somem com modal aberto) */}
      {!openItem && !showNew && !showFotoQr && !showCaixaQr && (
        <div className="fixed bottom-16 inset-x-0 z-30 pointer-events-none">
          <div className="max-w-lg mx-auto px-4 flex justify-end items-center gap-2.5">
            <button onClick={() => setShowCaixaQr(true)} aria-label="Caixa por QR"
              className="pointer-events-auto h-12 rounded-full bg-gray-900 text-white shadow-lg flex items-center gap-1.5 pl-3.5 pr-4 text-sm font-semibold active:bg-gray-800">
              <Boxes className="w-5 h-5" /> Caixa QR
            </button>
            <button onClick={() => setShowFotoQr(true)} aria-label="Foto por QR"
              className="pointer-events-auto h-12 rounded-full bg-gray-900 text-white shadow-lg flex items-center gap-1.5 pl-3.5 pr-4 text-sm font-semibold active:bg-gray-800">
              <QrCode className="w-5 h-5" /> Foto QR
            </button>
            <button onClick={() => setShowNew(true)} aria-label="Novo item"
              className="pointer-events-auto w-14 h-14 rounded-full bg-orange-500 text-white shadow-lg flex items-center justify-center active:bg-orange-600">
              <Plus className="w-7 h-7" />
            </button>
          </div>
        </div>
      )}

      {openItem && <ItemDetail item={openItem} user={user} params={params} onClose={() => setOpenItem(null)} onSaved={onSaved} />}
      {showNew && <NewItem lotes={lotes} user={user} params={params} onClose={() => setShowNew(false)} onCreated={onCreated} />}
      {showFotoQr && (
        <FotoQrScreen
          onClose={() => setShowFotoQr(false)}
          onOpenItem={(it) => { setShowFotoQr(false); setOpenItem(it); }}
        />
      )}
      {showCaixaQr && (
        <CaixasScreen
          params={params} user={user}
          onClose={() => setShowCaixaQr(false)}
          onOpenItem={(it) => { setShowCaixaQr(false); setOpenItem(it); }}
        />
      )}
    </div>
  );
}
