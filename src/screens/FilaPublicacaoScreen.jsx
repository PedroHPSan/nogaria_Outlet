// Fila de publicação do Instagram: rascunho → aprovação (agora ou agendada, horário de Brasília) → publicado.
import React, { useCallback, useEffect, useState } from "react";
import { X, Loader2, Instagram } from "lucide-react";
import {
  STATUS_FILA, listarFila, aprovarPublicacao, cancelarPublicacao, reenviarPublicacao, agendarPublicacao,
  brasiliaParaIso, fmtBrasilia, simulada,
} from "../lib/filaPublicacao";

const FILTROS = [["", "Todas"], ["rascunho", "Rascunhos"], ["agendado", "Agendadas"], ["publicado", "Publicadas"], ["erro", "Com erro"]];

export default function FilaPublicacaoScreen({ onClose }) {
  const [lista, setLista] = useState(null);
  const [filtro, setFiltro] = useState("");
  const [erro, setErro] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const [quando, setQuando] = useState({}); // id -> "YYYY-MM-DDTHH:mm" (Brasília)

  const carregar = useCallback(async () => {
    try { setErro(null); setLista(await listarFila()); } catch (e) { setErro(e.message || String(e)); setLista([]); }
  }, []);
  useEffect(() => { carregar(); const t = setInterval(carregar, 15000); return () => clearInterval(t); }, [carregar]);

  const agir = async (id, fn) => {
    setOcupado(id); setErro(null);
    try { await fn(); await carregar(); } catch (e) { setErro(e.message || String(e)); } finally { setOcupado(null); }
  };
  const aprovar = (p) => agir(p.id, async () => {
    if (quando[p.id]) await agendarPublicacao(p.id, brasiliaParaIso(quando[p.id]));
    await aprovarPublicacao(p.id);
  });

  const visiveis = (lista || []).filter((p) => !filtro || p.status === filtro);
  return (
    <div className="fixed inset-0 z-[80] bg-gray-50 flex flex-col">
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-2">
        <Instagram className="w-5 h-5 text-pink-600" />
        <h2 className="font-bold text-gray-900">Fila do Instagram</h2>
        <button onClick={onClose} aria-label="Fechar" className="ml-auto"><X className="w-6 h-6 text-gray-400" /></button>
      </div>
      <div className="px-4 py-2 flex gap-1.5 overflow-x-auto">
        {FILTROS.map(([k, r]) => (
          <button key={k} onClick={() => setFiltro(k)} className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${filtro === k ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-600"}`}>{r}</button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-3">
        {erro && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2" role="alert">{erro}</p>}
        {!lista && <Loader2 className="w-5 h-5 animate-spin text-orange-500 mx-auto mt-10" />}
        {lista && visiveis.length === 0 && !erro && <p className="text-sm text-gray-500 text-center mt-10">Nada na fila. Gere cards no catálogo e use "Enviar para a fila do Instagram".</p>}
        {visiveis.map((p) => {
          const st = STATUS_FILA[p.status] || STATUS_FILA.rascunho;
          const ocup = ocupado === p.id;
          return (
            <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
              <div className="flex gap-3">
                <img src={p.payload?.midias?.[0]} alt="" className="w-20 h-20 rounded-lg object-cover bg-gray-100 shrink-0" loading="lazy" />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${st.cor}`}>{st.rotulo}</span>
                    <span className="text-[11px] text-gray-500 uppercase">{p.tipo}{p.payload?.midias?.length > 1 ? ` · ${p.payload.midias.length} imagens` : ""}</span>
                    {simulada(p) && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800">SIMULADO</span>}
                  </div>
                  <p className="text-[11px] text-gray-400 font-mono truncate">{p.skus.join(", ")}</p>
                  <p className="text-xs text-gray-700 line-clamp-3 whitespace-pre-line">{p.payload?.legenda || "(sem legenda)"}</p>
                </div>
              </div>
              <p className="text-[11px] text-gray-500">
                criado por {p.criado_por}{p.aprovado_por ? ` · aprovado por ${p.aprovado_por}` : ""}
                {p.agendado_para ? ` · agendado para ${fmtBrasilia(p.agendado_para)} (Brasília)` : ""}
                {p.publicado_em ? ` · publicado ${fmtBrasilia(p.publicado_em)}` : ""}
              </p>
              {p.erro && <p className="text-xs text-red-600">{p.erro}</p>}
              <div className="flex flex-wrap items-center gap-2">
                {p.status === "rascunho" && (
                  <>
                    <input type="datetime-local" value={quando[p.id] || ""} onChange={(e) => setQuando({ ...quando, [p.id]: e.target.value })}
                      aria-label="Agendar (horário de Brasília)" className="rounded-lg border border-gray-300 px-2 py-1 text-xs" />
                    <button disabled={ocup} onClick={() => aprovar(p)} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold disabled:opacity-50">
                      {quando[p.id] ? "Aprovar e agendar" : "Aprovar e publicar"}
                    </button>
                  </>
                )}
                {p.status === "erro" && <button disabled={ocup} onClick={() => agir(p.id, () => reenviarPublicacao(p.id))} className="px-3 py-1.5 rounded-lg bg-sky-600 text-white text-xs font-bold">Tentar de novo</button>}
                {["rascunho", "aprovado", "agendado", "erro"].includes(p.status) && (
                  <button disabled={ocup} onClick={() => window.confirm("Cancelar esta publicação?") && agir(p.id, () => cancelarPublicacao(p.id))} className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs font-semibold">Cancelar</button>
                )}
                {ocup && <Loader2 className="w-4 h-4 animate-spin text-orange-500" />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
