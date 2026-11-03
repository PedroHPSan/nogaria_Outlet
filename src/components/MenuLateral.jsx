// Menu lateral do desktop (≥1024px com a visão desktop ligada). No celular não aparece: vale a barra inferior.
import React from "react";
import { LogOut, Plus, DoorOpen, MapPin, Boxes, QrCode, Monitor, Smartphone } from "lucide-react";

export default function MenuLateral({ abas, tab, onTab, email, onSair, acoes, modo, onAlternarLayout }) {
  const rapido = [
    { t: "Salas", icon: DoorOpen, fn: acoes.salas },
    { t: "Onde está", icon: MapPin, fn: acoes.ondeEsta },
    { t: "Caixa QR", icon: Boxes, fn: acoes.caixaQr },
    { t: "Foto QR", icon: QrCode, fn: acoes.fotoQr },
  ];
  return (
    <aside className="hidden desk:flex fixed inset-y-0 left-0 w-60 z-20 flex-col bg-gradient-to-b from-brand to-brand-deep text-white overflow-hidden">
      <div className="pointer-events-none absolute -left-24 -bottom-28 w-72 h-72 rounded-full bg-[radial-gradient(circle,rgba(249,115,22,.28),rgba(249,115,22,0)_70%)]" />
      <div className="relative px-5 pt-5 pb-5 flex flex-col items-start gap-1.5">
        <img src="/logo-nogaria-branca.png" alt="Nogária" className="h-6 w-auto" />
        <span className="bg-orange-500 text-brand-deep font-extrabold text-[10px] tracking-[0.3em] pl-2 pr-1 py-1 rounded leading-none">OUTLET</span>
      </div>
      <button onClick={acoes.novoItem} className="relative mx-3 mb-3 rounded-xl bg-orange-500 hover:bg-orange-600 py-2.5 text-sm font-extrabold text-brand-deep shadow-[0_10px_20px_-8px_rgba(249,115,22,.6)] flex items-center justify-center gap-2">
        <Plus className="w-4 h-4" /> Novo item
      </button>
      <nav className="relative flex-1 overflow-y-auto px-2 space-y-0.5">
        {abas.map((n) => (
          <button key={n.id} onClick={() => onTab(n.id)}
            className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-left ${tab === n.id ? "bg-white/12 text-white ring-1 ring-white/15" : "text-blue-100/80 hover:bg-white/10"}`}>
            <n.icon className={`w-5 h-5 ${tab === n.id ? "text-orange-400" : ""}`} /> {n.t}
          </button>
        ))}
        <p className="px-3 pt-4 pb-1 text-[11px] uppercase tracking-wide text-blue-100/50 font-semibold">Atalhos</p>
        {rapido.map((r) => (
          <button key={r.t} onClick={r.fn} className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-blue-100/80 hover:bg-white/10 text-left">
            <r.icon className="w-4.5 h-4.5" /> {r.t}
          </button>
        ))}
      </nav>
      <div className="relative p-3 border-t border-white/15 space-y-1.5">
        <button onClick={onAlternarLayout} className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-blue-100/80 hover:bg-white/10">
          {modo === "mobile" ? <Monitor className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />} {modo === "mobile" ? "Visão desktop" : "Visão mobile"}
        </button>
        <button onClick={onSair} className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-blue-100/60 hover:bg-white/10">
          <LogOut className="w-4 h-4" /> {email}
        </button>
      </div>
    </aside>
  );
}
