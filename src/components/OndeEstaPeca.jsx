// Card da ficha: em quais canais a peça está, reserva ativa, "Retirar de todos" e "Vendi aqui" (pré-marca o canal da venda).
import React, { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { situacaoDaPeca, retirarDeTodos, CANAL_ROTULO, ESTADO_ROTULO } from "../lib/canais";
import { fmtBrasilia } from "../lib/filaPublicacao";

export default function OndeEstaPeca({ item, user, onVendiAqui }) {
  const [s, setS] = useState(null);
  const [erro, setErro] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const carregar = useCallback(() => situacaoDaPeca(item.sku).then((x) => { setS(x); setErro(null); }).catch((e) => setErro(e.message || String(e))), [item.sku]);
  useEffect(() => { carregar(); }, [carregar]);

  const noAr = (s?.canais || []).filter((c) => c.estado === "publicado");
  const retirar = async () => {
    if (!window.confirm(`Retirar ${item.sku} de ${noAr.length} canal(is)? A peça continua em estoque.`)) return;
    setOcupado(true);
    try { await retirarDeTodos(item.sku, user); await carregar(); } catch (e) { setErro(e.message || String(e)); } finally { setOcupado(false); }
  };

  if (!s && !erro) return null;
  if (s && !s.canais.length && !s.reserva && !erro) return null;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 mb-2 space-y-2">
      <p className="text-xs font-bold text-gray-700">Onde está esta peça</p>
      {s?.canais.map((c) => (
        <div key={c.canal} className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-gray-800">{CANAL_ROTULO[c.canal] || c.canal}</span>
          <span className={c.estado === "publicado" ? "text-emerald-700" : c.estado === "erro" ? "text-red-600" : "text-gray-500"}>{ESTADO_ROTULO[c.estado] || c.estado}</span>
          {c.ultimo_erro && <span className="text-red-600 truncate">{c.ultimo_erro}</span>}
          {c.url_publica && <a href={c.url_publica} target="_blank" rel="noreferrer" className="text-sky-600 underline ml-auto">abrir</a>}
          {c.estado === "publicado" && onVendiAqui && (
            <button onClick={() => onVendiAqui(c.canal)} className="ml-auto text-emerald-700 border border-emerald-200 rounded px-2 py-0.5 font-semibold">Vendi aqui</button>
          )}
        </div>
      ))}
      {s?.reserva && <p className="text-xs text-amber-700">Reservada ({s.reserva.canal}{s.reserva.origem_ref ? ` · ${s.reserva.origem_ref}` : ""}){s.reserva.expira_em ? ` até ${fmtBrasilia(s.reserva.expira_em)}` : ""}</p>}
      {noAr.length > 0 && (
        <button onClick={retirar} disabled={ocupado} className="w-full text-xs font-semibold rounded-lg border border-red-200 text-red-600 py-1.5 disabled:opacity-50">
          {ocupado ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Retirar de todos os canais"}
        </button>
      )}
      {erro && <p className="text-xs text-red-600">{erro}</p>}
    </div>
  );
}
