// "Separar para…": 1 item na sacola de um cliente (cria a sacola ou soma na aberta) e reserva.
import React, { useEffect, useState } from "react";
import { X, Loader2, AlertTriangle, ShoppingBag } from "lucide-react";
import { separar, listarSacolas } from "../lib/sacolas";
import { statusEfetivo } from "../lib/orcamentosCore";
import { fmtBRL } from "../lib/model";

export default function SepararModal({ item, user, onClose, onFeito }) {
  const [nome, setNome] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [abertas, setAbertas] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);
  const [feito, setFeito] = useState(null);

  useEffect(() => {
    listarSacolas({ status: "ABERTA" })
      .then((l) => setAbertas(l.filter((s) => statusEfetivo(s) === "ABERTA")))
      .catch(() => {});
  }, []);

  const escolher = (s) => { setNome(s.cliente_nome || ""); setWhatsapp(s.cliente_whatsapp || ""); };

  const confirmar = async () => {
    if (!nome.trim() && !whatsapp.trim()) { setErro("Informe o nome ou o WhatsApp do cliente."); return; }
    setSalvando(true); setErro(null);
    try {
      const s = await separar(item, { nome, whatsapp }, user);
      setFeito(s); onFeito?.(s);
    } catch (e) { setErro(e.message || String(e)); }
    finally { setSalvando(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-900 flex items-center gap-2"><ShoppingBag className="w-4 h-4 text-orange-500" /> Separar para o cliente</h3>
          <button onClick={onClose} aria-label="Fechar"><X className="w-5 h-5 text-gray-500" /></button>
        </div>
        <p className="text-sm text-gray-600"><span className="font-mono font-bold">{item.sku}</span> · {item.produto} · {fmtBRL(item.preco_ideal || 0)}</p>

        {feito ? (
          <div className="space-y-3">
            <p className="text-sm text-emerald-700 font-semibold">
              Separado na sacola {feito.codigo} de {feito.cliente_nome || feito.cliente_whatsapp} ({feito.itens.length} item(ns)).
            </p>
            <button onClick={onClose} className="w-full rounded-xl py-2.5 font-bold bg-gray-900 text-white">Fechar</button>
          </div>
        ) : (
          <>
            {abertas.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {abertas.map((s) => (
                  <button key={s.id} onClick={() => escolher(s)}
                    className="px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap bg-orange-50 text-orange-700 border border-orange-200">
                    {s.cliente_nome || s.cliente_whatsapp} · {s.itens.length}
                  </button>
                ))}
              </div>
            )}
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do cliente" autoFocus
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="WhatsApp (com DDD) — opcional" inputMode="tel"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            {erro && <p className="text-sm text-red-600 flex items-start gap-1.5"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {erro}</p>}
            <button onClick={confirmar} disabled={salvando}
              className="w-full rounded-xl py-3 font-bold bg-orange-500 text-white flex items-center justify-center gap-2 disabled:opacity-60">
              {salvando && <Loader2 className="w-4 h-4 animate-spin" />} Separar e reservar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
