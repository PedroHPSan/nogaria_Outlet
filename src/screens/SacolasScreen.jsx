// Sacolas de WhatsApp: o que foi separado por cliente, o que falta pagar e entregar.
// Regras em sacolasCore; operações em sacolas.js (pagar reaproveita confirmarVenda).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { X, Loader2, Search, AlertTriangle, MessageCircle } from "lucide-react";
import { listarSacolas, tirarDaSacola, registrarPagamento, registrarEntrega, cancelarSacola } from "../lib/sacolas";
import { statusEfetivo, totais } from "../lib/orcamentosCore";
import { resumoSacolas, resumoDoDia, porCliente, linkCobranca, FORMAS_PAGAMENTO } from "../lib/sacolasCore";
import { fmtBRL } from "../lib/model";

const COR = {
  ABERTA: "bg-amber-100 text-amber-700", VENDIDO: "bg-emerald-100 text-emerald-700", ENTREGUE: "bg-sky-100 text-sky-700",
  CANCELADO: "bg-red-100 text-red-700", EXPIRADO: "bg-gray-200 text-gray-500",
};
const ROTULO = { ABERTA: "A pagar", VENDIDO: "Pago · a entregar", ENTREGUE: "Entregue", CANCELADO: "Cancelada", EXPIRADO: "Vencida" };
const FILTROS = [["ABERTA", "A pagar"], ["VENDIDO", "A entregar"], ["ENTREGUE", "Entregues"], ["", "Todas"], ["CLIENTES", "Por cliente"]];
const fmtData = (iso) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function SacolasScreen({ user, onClose, onMudou }) {
  const [todas, setTodas] = useState(null);
  const [filtro, setFiltro] = useState("ABERTA");
  const [q, setQ] = useState("");
  const [erro, setErro] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const [pagando, setPagando] = useState(null); // { id, forma, valor }

  const carregar = useCallback(async () => {
    try { setErro(null); setTodas(await listarSacolas()); }
    catch (e) { setErro(e.message || String(e)); setTodas([]); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const resumo = useMemo(() => resumoSacolas(todas || []), [todas]);
  const hoje = useMemo(() => resumoDoDia(todas || []), [todas]);
  const clientes = useMemo(() => porCliente(todas || []).filter((c) => !q.trim() || `${c.nome || ""} ${c.whatsapp || ""}`.toLowerCase().includes(q.trim().toLowerCase())), [todas, q]);
  const lista = useMemo(() => (todas || []).filter((s) => {
    if (filtro === "CLIENTES") return false;
    if (filtro && statusEfetivo(s) !== filtro) return false;
    const t = q.trim().toLowerCase();
    return !t || `${s.codigo} ${s.cliente_nome || ""} ${s.cliente_whatsapp || ""}`.toLowerCase().includes(t);
  }), [todas, filtro, q]);

  const agir = async (s, fn) => {
    setOcupado(s.id); setErro(null);
    try { await fn(); setPagando(null); await carregar(); onMudou?.(); }
    catch (e) { setErro(e.message || String(e)); }
    finally { setOcupado(null); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col">
      <div className="bg-gray-900 text-white px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-lg">Sacolas do WhatsApp</h2>
          <button onClick={onClose} aria-label="Fechar"><X className="w-6 h-6 text-gray-300" /></button>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div className="bg-gray-800 rounded-lg py-2"><p className="text-[11px] text-gray-400">A receber</p><p className="font-bold text-amber-300">{fmtBRL(resumo.aReceber)}</p><p className="text-[10px] text-gray-500">{resumo.abertas} sacola(s){resumo.vencendo ? ` · ${resumo.vencendo} vencendo` : ""}</p></div>
          <div className="bg-gray-800 rounded-lg py-2"><p className="text-[11px] text-gray-400">A entregar</p><p className="font-bold">{resumo.pagasSemEntrega}</p><p className="text-[10px] text-gray-500">já pagas</p></div>
          <div className="bg-gray-800 rounded-lg py-2"><p className="text-[11px] text-gray-400">Recebido</p><p className="font-bold text-emerald-300">{fmtBRL(resumo.recebido)}</p></div>
        </div>
        <p className="mt-2 text-[11px] text-gray-400">
          Hoje: {hoje.separadas.n} separada(s) ({fmtBRL(hoje.separadas.valor)}) · {hoje.pagas.n} paga(s) ({fmtBRL(hoje.pagas.valor)}) · {hoje.entregues} entregue(s)
        </p>
        <div className="mt-2 relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por cliente, WhatsApp ou código"
            className="w-full rounded-lg bg-gray-800 text-sm pl-9 pr-3 py-2 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>
        <div className="mt-2 flex gap-1.5 overflow-x-auto">
          {FILTROS.map(([v, l]) => (
            <button key={l} onClick={() => setFiltro(v)}
              className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${filtro === v ? "bg-orange-500 text-white" : "bg-gray-800 text-gray-300"}`}>{l}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {erro && <p className="text-sm text-red-600 flex items-start gap-1.5"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {erro}</p>}
        {!todas && <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</p>}
        {filtro === "CLIENTES" && clientes.map((c) => (
          <div key={c.whatsapp || c.nome} className="bg-white rounded-xl border border-gray-200 p-3 flex items-center gap-3">
            <div className="min-w-0">
              <p className="font-bold text-gray-900 truncate">{c.nome || c.whatsapp}</p>
              <p className="text-[11px] text-gray-500">{c.sacolas} sacola(s){c.aEntregar ? ` · ${c.aEntregar} a entregar` : ""}</p>
            </div>
            <div className="ml-auto text-right text-xs">
              <p className="text-emerald-700 font-bold">Pago {fmtBRL(c.pago)}</p>
              {c.aPagar > 0 && <p className="text-amber-700 font-semibold">Deve {fmtBRL(c.aPagar)}</p>}
            </div>
          </div>
        ))}
        {filtro === "CLIENTES" && todas && clientes.length === 0 && <p className="text-sm text-gray-500 text-center mt-10">Nenhum cliente ainda.</p>}
        {todas && filtro !== "CLIENTES" && lista.length === 0 && !erro && <p className="text-sm text-gray-500 text-center mt-10">Nenhuma sacola aqui. Separe um item pela ficha dele (botão Separar).</p>}
        {lista.map((s) => {
          const ef = statusEfetivo(s);
          const t = totais(s.itens, s.desconto_pct);
          const vencendo = ef === "ABERTA" && new Date(s.validade) - new Date() < 86400000;
          const wa = ef === "ABERTA" ? linkCobranca(s) : null;
          const ocup = ocupado === s.id;
          return (
            <div key={s.id} className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-900 truncate">{s.cliente_nome || s.cliente_whatsapp || "Sem cliente"}</span>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${COR[ef]}`}>{ROTULO[ef] || ef}</span>
                <span className="ml-auto font-bold text-gray-900">{fmtBRL(t.total)}</span>
              </div>
              <p className="text-[11px] text-gray-400 font-mono">{s.codigo}{ef === "ABERTA" ? <span className={vencendo ? "text-red-600 font-bold" : ""}> · seguro até {fmtData(s.validade)}</span> : null}{s.forma_pagamento ? ` · ${s.forma_pagamento}` : ""}</p>
              <ul className="text-xs text-gray-700 space-y-0.5">
                {s.itens.map((i) => (
                  <li key={i.sku} className="flex items-center gap-2">
                    <span className="truncate">{i.produto} <span className="font-mono text-gray-400">({i.sku})</span></span>
                    <span className="ml-auto">{fmtBRL(i.preco)}</span>
                    {ef === "ABERTA" && (
                      <button disabled={ocup} aria-label={`Tirar ${i.sku}`} onClick={() => window.confirm(`Tirar ${i.sku} da sacola e liberar o item?`) && agir(s, () => tirarDaSacola(s, i.sku))}>
                        <X className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              {pagando?.id === s.id && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <select value={pagando.forma} onChange={(e) => setPagando({ ...pagando, forma: e.target.value })} className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs">
                    {FORMAS_PAGAMENTO.map((f) => <option key={f}>{f}</option>)}
                  </select>
                  <input value={pagando.valor} onChange={(e) => setPagando({ ...pagando, valor: e.target.value })} inputMode="decimal"
                    className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-xs" aria-label="Valor recebido" />
                  <button disabled={ocup} onClick={() => agir(s, () => registrarPagamento(s, { forma: pagando.forma, valor: String(pagando.valor).replace(",", ".") }, user))}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold">Confirmar pagamento</button>
                  <button onClick={() => setPagando(null)} className="text-xs text-gray-500">Cancelar</button>
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                {wa && <a href={wa} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-semibold flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5 text-emerald-600" /> Cobrar</a>}
                {ef === "ABERTA" && pagando?.id !== s.id && <button disabled={ocup} onClick={() => setPagando({ id: s.id, forma: FORMAS_PAGAMENTO[0], valor: String(t.total) })} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold">Registrar pagamento</button>}
                {ef === "VENDIDO" && <button disabled={ocup} onClick={() => agir(s, () => registrarEntrega(s, user))} className="px-3 py-1.5 rounded-lg bg-sky-600 text-white text-xs font-bold">Marcar entregue</button>}
                {ef === "ABERTA" && <button disabled={ocup} onClick={() => window.confirm("Cancelar a sacola e liberar os itens?") && agir(s, () => cancelarSacola(s))} className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs font-semibold">Cancelar</button>}
                {ocup && <Loader2 className="w-4 h-4 animate-spin text-orange-500 self-center" />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
