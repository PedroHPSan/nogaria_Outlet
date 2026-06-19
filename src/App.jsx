import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "./lib/supabase";
import Login from "./screens/Login";
import Dashboard from "./screens/Dashboard";
import ItemsScreen from "./screens/ItemsScreen";
import ItemDetail from "./screens/ItemDetail";
import NewItem from "./screens/NewItem";
import ExportScreen from "./screens/ExportScreen";
import ConferenciaScreen from "./screens/ConferenciaScreen";
import { statusMeta } from "./lib/model";
import { carregarParametros } from "./lib/pricingParams";
import { DEFAULT_PARAMS } from "./lib/pricing";
import { Package, BarChart3, ClipboardList, History, Upload, LogOut, Loader2, Plus, ClipboardCheck } from "lucide-react";

// Rótulo amigável de um evento na aba Registro (status:*, lote:atribuido, conferido).
const eventoLabel = (e) => {
  const a = e.acao || "";
  if (a.startsWith("status:")) return "→ " + statusMeta(a.replace("status:", "")).label;
  if (a === "lote:atribuido") return "lote atribuído" + (e.detalhe ? ` (${e.detalhe})` : "");
  if (a === "conferido") return "conferido ✓";
  if (a === "etiqueta:impressa") return "etiqueta impressa" + (e.detalhe ? ` (${e.detalhe})` : "");
  return a;
};

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = carregando
  const [lotes, setLotes] = useState([]);
  const [tab, setTab] = useState("painel");
  const [openItem, setOpenItem] = useState(null);
  const [showNew, setShowNew] = useState(false);
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
          lotes={lotes} user={user} onOpen={setOpenItem} refreshKey={refreshKey}
          onChanged={() => { loadLotes(); onSaved(); }}
        />
      )}
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
        <div className="max-w-lg mx-auto grid grid-cols-5">
          {[
            { id: "painel", icon: BarChart3, t: "Painel" },
            { id: "itens", icon: ClipboardList, t: "Itens" },
            { id: "conferencia", icon: ClipboardCheck, t: "Conferir" },
            { id: "exportar", icon: Upload, t: "Exportar" },
            { id: "registro", icon: History, t: "Registro" },
          ].map((n) => (
            <button key={n.id} onClick={() => { if (n.id !== "itens") setPreFilter(null); setTab(n.id); }}
              className={`py-2.5 flex flex-col items-center gap-0.5 text-xs font-semibold ${tab === n.id ? "text-orange-600" : "text-gray-400"}`}>
              <n.icon className="w-5 h-5" /> {n.t}
            </button>
          ))}
        </div>
      </div>

      {/* Botão flutuante: criar novo item (some quando há um modal aberto) */}
      {!openItem && !showNew && (
        <div className="fixed bottom-16 inset-x-0 z-30 pointer-events-none">
          <div className="max-w-lg mx-auto px-4 flex justify-end">
            <button onClick={() => setShowNew(true)} aria-label="Novo item"
              className="pointer-events-auto w-14 h-14 rounded-full bg-orange-500 text-white shadow-lg flex items-center justify-center active:bg-orange-600">
              <Plus className="w-7 h-7" />
            </button>
          </div>
        </div>
      )}

      {openItem && <ItemDetail item={openItem} user={user} params={params} onClose={() => setOpenItem(null)} onSaved={onSaved} />}
      {showNew && <NewItem lotes={lotes} user={user} params={params} onClose={() => setShowNew(false)} onCreated={onCreated} />}
    </div>
  );
}
