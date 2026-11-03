// Menu lateral do desktop (≥1024px com a visão desktop ligada). No celular não aparece: vale a barra inferior.
import React from "react";
import { Package, LogOut, Plus, DoorOpen, MapPin, Boxes, QrCode, Monitor, Smartphone } from "lucide-react";

export default function MenuLateral({ abas, tab, onTab, email, onSair, acoes, modo, onAlternarLayout }) {
  const rapido = [
    { t: "Salas", icon: DoorOpen, fn: acoes.salas },
    { t: "Onde está", icon: MapPin, fn: acoes.ondeEsta },
    { t: "Caixa QR", icon: Boxes, fn: acoes.caixaQr },
    { t: "Foto QR", icon: QrCode, fn: acoes.fotoQr },
  ];
  return (
    <aside className="hidden desk:flex fixed inset-y-0 left-0 w-60 z-20 flex-col bg-gray-900 text-white">
      <div className="px-4 py-4 flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center"><Package className="w-4 h-4 text-white" /></div>
        <span className="font-bold tracking-tight">NOGÁRIA OUTLET</span>
      </div>
      <button onClick={acoes.novoItem} className="mx-3 mb-3 rounded-xl bg-orange-500 hover:bg-orange-600 py-2.5 text-sm font-bold flex items-center justify-center gap-2">
        <Plus className="w-4 h-4" /> Novo item
      </button>
      <nav className="flex-1 overflow-y-auto px-2 space-y-0.5">
        {abas.map((n) => (
          <button key={n.id} onClick={() => onTab(n.id)}
            className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-left ${tab === n.id ? "bg-gray-800 text-orange-400" : "text-gray-300 hover:bg-gray-800/60"}`}>
            <n.icon className="w-5 h-5" /> {n.t}
          </button>
        ))}
        <p className="px-3 pt-4 pb-1 text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Atalhos</p>
        {rapido.map((r) => (
          <button key={r.t} onClick={r.fn} className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-300 hover:bg-gray-800/60 text-left">
            <r.icon className="w-4.5 h-4.5" /> {r.t}
          </button>
        ))}
      </nav>
      <div className="p-3 border-t border-gray-800 space-y-1.5">
        <button onClick={onAlternarLayout} className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800/60">
          {modo === "mobile" ? <Monitor className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />} {modo === "mobile" ? "Visão desktop" : "Visão mobile"}
        </button>
        <button onClick={onSair} className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-gray-400 hover:bg-gray-800/60">
          <LogOut className="w-4 h-4" /> {email}
        </button>
      </div>
    </aside>
  );
}
