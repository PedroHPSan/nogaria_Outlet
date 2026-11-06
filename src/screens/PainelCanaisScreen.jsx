// Painel catálogo × triagem (C6) + integrações com problema (N6): o que trava o catálogo e o que o worker não conseguiu fazer.
import React, { useCallback, useEffect, useState, Suspense } from "react";
import { X, Loader2, LayoutDashboard } from "lucide-react";
import { lazySeguro } from "../lib/lazySeguro";
const ConectarWhatsAppScreen = lazySeguro(() => import("./ConectarWhatsAppScreen"));
import { painelCatalogo, catalogoDiversos, jobsComProblema, reenfileirarJob, listarCanais, definirCanalAtivo, alertasAbertos, CANAL_ROTULO } from "../lib/canais";
import { fmtBrasilia } from "../lib/filaPublicacao";

const BLOQUEIOS = [["sem_preco", "Sem preço"], ["sem_categoria", "Sem categoria"], ["sem_estado", "Sem estado"], ["sem_foto", "Sem foto"], ["reservado", "Reservadas"]];
const N = (v) => Number(v ?? 0).toLocaleString("pt-BR");

export default function PainelCanaisScreen({ onClose, user }) {
  const [p, setP] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [canais, setCanais] = useState([]);
  const [alertas, setAlertas] = useState([]);
  const [diversos, setDiversos] = useState([]);
  const [conectarWa, setConectarWa] = useState(false);
  const [erro, setErro] = useState(null);
  const carregar = useCallback(async () => {
    try { setErro(null); const [a, b, c, d, e] = await Promise.all([painelCatalogo(), jobsComProblema(), listarCanais(), alertasAbertos(), catalogoDiversos()]); setP(a); setJobs(b); setCanais(c); setAlertas(d); setDiversos(e || []); } catch (e) { setErro(e.message || String(e)); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  const alternarCanal = async (c) => {
    const novo = !c.ativo;
    if (!novo && !window.confirm(`Desativar ${CANAL_ROTULO[c.codigo] || c.nome}? Deixa de aceitar reservas e publicações (as retiradas continuam).`)) return;
    try { await definirCanalAtivo(c.codigo, novo, user); await carregar(); } catch (e) { setErro(e.message || String(e)); }
  };
  const tentar = async (id) => { try { await reenfileirarJob(id); await carregar(); } catch (e) { setErro(e.message || String(e)); } };

  const maxBloq = p ? Math.max(1, ...BLOQUEIOS.map(([k]) => p.bloqueios[k])) : 1;
  return (
    <div className="fixed inset-0 z-[80] bg-gray-50 flex flex-col">
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-2">
        <LayoutDashboard className="w-5 h-5 text-sky-600" />
        <h2 className="font-bold text-gray-900">Painel do catálogo</h2>
        <button onClick={onClose} aria-label="Fechar" className="ml-auto"><X className="w-6 h-6 text-gray-400" /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {erro && <p className="text-xs text-red-600">{erro}</p>}
        {alertas.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-1">
            <p className="text-xs font-bold text-red-700">Alertas ({alertas.length})</p>
            {alertas.map((a) => <p key={a.chave} className="text-xs text-red-700">{a.detalhe} <span className="text-red-400">desde {fmtBrasilia(a.aberto_em)}</span></p>)}
          </div>
        )}
        {!p && !erro && <Loader2 className="w-6 h-6 animate-spin text-gray-400 mx-auto mt-10" />}
        {p && (<>
          <div className="grid grid-cols-2 gap-2 text-center">
            {[["Em Foto OK ou além", p.foto_ok], ["Elegíveis", p.elegiveis], ["No catálogo", p.publicados], ["Publicadas em 7 dias", p.publicados_7d]].map(([r, v]) => (
              <div key={r} className="bg-white rounded-xl border border-gray-200 py-3"><p className="text-xl font-bold text-gray-900">{N(v)}</p><p className="text-[11px] text-gray-500">{r}</p></div>
            ))}
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-1.5">
            <p className="text-xs font-bold text-gray-700">O que mais trava (peças em Foto OK+)</p>
            {BLOQUEIOS.map(([k, r]) => (
              <div key={k} className="flex items-center gap-2 text-xs">
                <span className="w-28 text-gray-600">{r}</span>
                <div className="flex-1 bg-gray-100 rounded h-2"><div className="bg-amber-400 h-2 rounded" style={{ width: `${(p.bloqueios[k] / maxBloq) * 100}%` }} /></div>
                <span className="w-12 text-right font-semibold">{N(p.bloqueios[k])}</span>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-xs space-y-1">
            <p><b>{N(p.elegiveis_nao_publicados)}</b> elegível(is) ainda fora do catálogo.</p>
            <p className="text-gray-600"><b>{N(p.excluidos)}</b> tirada(s) do catálogo de propósito.</p>
            <p className={p.divergentes ? "text-red-600" : "text-gray-600"}><b>{N(p.divergentes)}</b> no catálogo mas não elegível(is) (saem como "out of stock" no feed).</p>
            <p className="text-gray-400">Atualizado {fmtBrasilia(p.atualizado_em)}</p>
          </div>
          {diversos.length > 0 && (
            <div className="bg-white rounded-xl border border-amber-300 p-3 space-y-1">
              <p className="text-xs font-bold text-amber-800">{N(diversos.length)} peça(s) no catálogo em "Diversos"</p>
              <p className="text-[11px] text-gray-500">Sem categoria reconhecida: corrija o grupo na ficha para entrarem na lista certa.</p>
              {diversos.slice(0, 30).map((d) => (
                <p key={d.sku} className="text-xs text-gray-700 truncate"><span className="font-mono">{d.sku}</span> · {d.produto || "—"} <span className="text-gray-400">({d.grupo || "sem grupo"})</span></p>
              ))}
              {diversos.length > 30 && <p className="text-[11px] text-gray-400">e mais {N(diversos.length - 30)}…</p>}
            </div>
          )}
        </>)}
        <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
          <p className="text-xs font-bold text-gray-700">Canais</p>
          <button onClick={() => setConectarWa(true)} className="text-xs font-semibold text-emerald-700 underline">Conectar o número do WhatsApp (Cadastro Incorporado)</button>
          <p className="text-[11px] text-gray-500">Desativado: recusa reserva, publicação e feed do canal. Venda e retirada continuam funcionando.</p>
          {canais.map((c) => (
            <div key={c.codigo} className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-gray-800">{CANAL_ROTULO[c.codigo] || c.nome}</span>
              <span className={c.ativo ? "text-emerald-700" : "text-red-600"}>{c.ativo ? "Ativo" : "Desativado"}</span>
              <button onClick={() => alternarCanal(c)} className="ml-auto px-2 py-0.5 rounded border border-gray-300 font-semibold">{c.ativo ? "Desativar" : "Ativar"}</button>
            </div>
          ))}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
          <p className="text-xs font-bold text-gray-700">Integrações com problema</p>
          {jobs.length === 0 && <p className="text-xs text-gray-500">Nenhum job com erro ou morto.</p>}
          {jobs.map((j) => (
            <div key={j.id} className="flex items-center gap-2 text-xs">
              <span className={`px-1.5 rounded ${j.status === "morto" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>{j.status}</span>
              <span className="font-mono">{j.tipo}</span>
              <span className="text-gray-500 truncate flex-1">{j.erro}</span>
              <button onClick={() => tentar(j.id)} className="px-2 py-0.5 rounded border border-gray-300 font-semibold">Tentar de novo</button>
            </div>
          ))}
        </div>
      </div>
      {conectarWa && <Suspense fallback={null}><ConectarWhatsAppScreen onClose={() => setConectarWa(false)} /></Suspense>}
    </div>
  );
}
