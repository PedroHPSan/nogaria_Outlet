// Sacolas de WhatsApp: o que foi separado por cliente, o que falta pagar e entregar.
// Regras em sacolasCore; operações em sacolas.js (pagar reaproveita confirmarVenda).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { X, Loader2, Search, AlertTriangle, MessageCircle } from "lucide-react";
import { listarSacolas, tirarDaSacola, registrarPagamento, registrarEntrega, cancelarSacola, renovarSacola } from "../lib/sacolas";
import { statusEfetivo, totais } from "../lib/orcamentosCore";
import { resumoSacolas, resumoDoDia, porCliente, linkCobranca, FORMAS_PAGAMENTO, PRAZOS_RENOVACAO, rotuloPrazo, totaisComDecisao } from "../lib/sacolasCore";
import { promoVencida, pendentesDoErro } from "../lib/campanhasCore";
import { fmtBRL } from "../lib/model";
import { reservasDoBot } from "../lib/canais";
import { WA_API_ATIVA, eventoDaSacola, ROTULO_EVENTO, previaEnvio, enviarPelaApi, situacaoEnvios, rotuloEnvio } from "../lib/waEnvio";

const COR = {
  ABERTA: "bg-amber-100 text-amber-700", VENDIDO: "bg-emerald-100 text-emerald-700", ENTREGUE: "bg-sky-100 text-sky-700",
  CANCELADO: "bg-red-100 text-red-700", EXPIRADO: "bg-gray-200 text-gray-500",
};
const ROTULO = { ABERTA: "A pagar", VENDIDO: "Pago · a entregar", ENTREGUE: "Entregue", CANCELADO: "Cancelada", EXPIRADO: "Vencida" };
const FILTROS = [["ABERTA", "A pagar"], ["EXPIRADO", "Vencidas"], ["VENDIDO", "A entregar"], ["ENTREGUE", "Entregues"], ["", "Todas"], ["CLIENTES", "Por cliente"], ["BOT", "Do bot"]];
const fmtData = (iso) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function SacolasScreen({ user, onClose, onMudou }) {
  const [todas, setTodas] = useState(null);
  const [filtro, setFiltro] = useState("ABERTA");
  const [q, setQ] = useState("");
  const [erro, setErro] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const [pagando, setPagando] = useState(null); // { id, forma, valor }
  const [decisao, setDecisao] = useState(null); // { sacola, pend, forma } — campanha terminou antes do pagamento: manter promo ou cobrar cheio
  const [dias, setDias] = useState({}); // id da sacola -> dias para reabrir/estender (padrão 3)
  const [previa, setPrevia] = useState(null); // { sacola, evento } — confirmação do envio pela API
  const [doBot, setDoBot] = useState(null); // reservas ativas do bot do WhatsApp
  const [envios, setEnvios] = useState({}); // codigo -> situação dos envios (WhatsApp API)

  const carregar = useCallback(async () => {
    try { setErro(null); setTodas(await listarSacolas()); }
    catch (e) { setErro(e.message || String(e)); setTodas([]); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  const carregarEnvios = useCallback(async (lista) => {
    if (!WA_API_ATIVA) return;
    const pares = await Promise.all(lista.map(async (s) => [s.codigo, await situacaoEnvios(s).catch(() => [])]));
    setEnvios((prev) => ({ ...prev, ...Object.fromEntries(pares) }));
  }, []);
  useEffect(() => { if (todas?.length) carregarEnvios(todas.filter((s) => ["ABERTA", "VENDIDO", "ENTREGUE"].includes(statusEfetivo(s)))); }, [todas, carregarEnvios]);

  useEffect(() => { if (filtro === "BOT") reservasDoBot().then(setDoBot).catch((e) => { setErro(e.message || String(e)); setDoBot([]); }); }, [filtro]);

  const resumo = useMemo(() => resumoSacolas(todas || []), [todas]);
  const hoje = useMemo(() => resumoDoDia(todas || []), [todas]);
  const clientes = useMemo(() => porCliente(todas || []).filter((c) => !q.trim() || `${c.nome || ""} ${c.whatsapp || ""}`.toLowerCase().includes(q.trim().toLowerCase())), [todas, q]);
  const lista = useMemo(() => (todas || []).filter((s) => {
    if (filtro === "CLIENTES" || filtro === "BOT") return false;
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

  // Pagamento: se a campanha de algum item já terminou o servidor recusa (DECISAO_CAMPANHA) e abrimos o diálogo.
  const pagar = async (s) => {
    try { await registrarPagamento(s, { forma: pagando.forma, valor: String(pagando.valor).replace(",", ".") }, user); }
    catch (e) {
      const pend = pendentesDoErro(e);
      if (!pend) throw e;
      setDecisao({ sacola: s, pend, forma: pagando.forma });
    }
  };
  const decidir = (manter) => {
    const { sacola, pend, forma } = decisao;
    const t = totaisComDecisao(sacola.itens, sacola.desconto_pct, pend);
    return agir(sacola, async () => {
      await registrarPagamento(sacola, { forma, valor: String(manter ? t.promo : t.cheio) }, user, { manterPromo: manter });
      setDecisao(null);
    });
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
        {filtro === "BOT" && (
          <p className="text-[11px] text-gray-500">Reservas do bot valem 2 h. Para virar sacola: abra o item → Separar; a reserva passa para a sacola com o novo prazo.</p>
        )}
        {filtro === "BOT" && !doBot && <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</p>}
        {filtro === "BOT" && doBot && doBot.length === 0 && <p className="text-sm text-gray-500 text-center mt-10">Nenhuma reserva do bot agora.</p>}
        {filtro === "BOT" && (doBot || []).map((b) => (
          <div key={b.wa_id} className="bg-white rounded-xl border border-gray-200 p-3 space-y-1">
            <div className="flex items-center gap-2">
              <p className="font-bold text-gray-900 truncate">{b.nome || b.wa_id}</p>
              {b.ctwa && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">veio de anúncio</span>}
              <a href={`https://wa.me/${b.wa_id}`} target="_blank" rel="noreferrer" className="ml-auto text-xs text-emerald-700 font-semibold underline">Conversar</a>
            </div>
            <p className="text-[11px] text-amber-700 font-semibold">vence {fmtData(b.expira_em)}</p>
            {b.skus.map((sku, i) => <p key={sku} className="text-xs text-gray-700 truncate"><span className="font-mono text-gray-400">{sku}</span> {b.produtos[i]}</p>)}
          </div>
        ))}
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
          const restante = new Date(s.validade) - new Date();
          const vencendo = ef === "ABERTA" && restante < 86400000;
          const venceEm2h = ef === "ABERTA" && restante > 0 && restante < 7200000;
          const wa = ef === "ABERTA" ? linkCobranca(s) : null;
          const ocup = ocupado === s.id;
          return (
            <div key={s.id} className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-900 truncate">{s.cliente_nome || s.cliente_whatsapp || "Sem cliente"}</span>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${COR[ef]}`}>{ROTULO[ef] || ef}</span>
                <span className="ml-auto font-bold text-gray-900">{fmtBRL(t.total)}</span>
              </div>
              <p className="text-[11px] text-gray-400 font-mono">{s.codigo}{ef === "ABERTA" ? <span className={vencendo ? "text-red-600 font-bold" : ""}> · seguro até {fmtData(s.validade)}{venceEm2h ? ` · vence em ${Math.max(1, Math.round(restante / 60000))} min` : ""}</span> : ef === "EXPIRADO" ? <span className="text-red-600 font-bold"> · venceu em {fmtData(s.validade)} (itens liberados)</span> : null}{s.forma_pagamento ? ` · ${s.forma_pagamento}` : ""}</p>
              <ul className="text-xs text-gray-700 space-y-0.5">
                {s.itens.map((i) => (
                  <li key={i.sku} className="flex items-center gap-2">
                    <span className="truncate">{i.produto} <span className="font-mono text-gray-400">({i.sku})</span>
                      {Number(i.preco_cheio) > Number(i.preco) && <span className="ml-1 text-[10px] font-bold text-red-600">PROMO{i.campanha_nome ? ` · ${i.campanha_nome}` : ""}</span>}
                      {promoVencida(i) && ef === "ABERTA" && <span className="ml-1 text-[10px] font-bold text-amber-700">promo encerrada: decidir no pagamento</span>}
                    </span>
                    <span className="ml-auto whitespace-nowrap">{Number(i.preco_cheio) > Number(i.preco) && <span className="line-through text-gray-400 mr-1">{fmtBRL(i.preco_cheio)}</span>}{fmtBRL(i.preco)}</span>
                    {(ef === "ABERTA" || ef === "EXPIRADO") && (
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
                  <button disabled={ocup} onClick={() => agir(s, () => pagar(s))}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold">Confirmar pagamento</button>
                  <button onClick={() => setPagando(null)} className="text-xs text-gray-500">Cancelar</button>
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                {WA_API_ATIVA && eventoDaSacola(ef) && s.cliente_whatsapp && !(envios[s.codigo] || []).some((e) => e.evento === eventoDaSacola(ef) && !rotuloEnvio(e).falhou) && (
                  <button disabled={ocup} onClick={() => setPrevia({ sacola: s, evento: eventoDaSacola(ef) })} className="px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 text-xs font-semibold">Enviar pela API · {ROTULO_EVENTO[eventoDaSacola(ef)]}</button>
                )}
                {wa && <a href={wa} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-semibold flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5 text-emerald-600" /> Cobrar</a>}
                {ef === "ABERTA" && pagando?.id !== s.id && <button disabled={ocup} onClick={() => setPagando({ id: s.id, forma: FORMAS_PAGAMENTO[0], valor: String(t.total) })} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold">Registrar pagamento</button>}
                {ef === "VENDIDO" && <button disabled={ocup} onClick={() => agir(s, () => registrarEntrega(s, user))} className="px-3 py-1.5 rounded-lg bg-sky-600 text-white text-xs font-bold">Marcar entregue</button>}
                {(ef === "ABERTA" || ef === "EXPIRADO") && (
                  <span className="flex items-center gap-1">
                    <select value={dias[s.id] || 3} onChange={(e) => setDias({ ...dias, [s.id]: Number(e.target.value) })} aria-label="Prazo"
                      className="rounded-lg border border-gray-300 px-1.5 py-1.5 text-xs">
                      {PRAZOS_RENOVACAO.map((d) => <option key={d} value={d}>{rotuloPrazo(d)}</option>)}
                    </select>
                    <button disabled={ocup} onClick={() => agir(s, () => renovarSacola(s, dias[s.id] || 3, user))}
                      className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-bold">{ef === "EXPIRADO" ? "Reabrir" : "Estender"}</button>
                  </span>
                )}
                {(ef === "ABERTA" || ef === "EXPIRADO") && <button disabled={ocup} onClick={() => window.confirm("Cancelar a sacola e liberar os itens?") && agir(s, () => cancelarSacola(s))} className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs font-semibold">Cancelar</button>}
                {(envios[s.codigo] || []).map((e) => { const r = rotuloEnvio(e); return (
                  <span key={e.evento} className={`text-[11px] self-center ${r.falhou ? "text-red-600 font-bold" : "text-gray-500"}`}>{ROTULO_EVENTO[e.evento]}: {r.texto}</span>
                ); })}
                {ocup && <Loader2 className="w-4 h-4 animate-spin text-orange-500 self-center" />}
              </div>
            </div>
          );
        })}
      </div>
      {decisao && (() => {
        const t = totaisComDecisao(decisao.sacola.itens, decisao.sacola.desconto_pct, decisao.pend);
        const c = decisao.pend[0];
        const ocup = ocupado === decisao.sacola.id;
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-3" role="dialog" aria-label="Campanha encerrada">
            <div className="bg-white rounded-2xl w-full max-w-md p-4 space-y-3 max-h-[90vh] overflow-y-auto">
              <p className="font-bold text-gray-900 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-600" /> A campanha terminou antes do pagamento</p>
              <p className="text-sm text-gray-700">
                {c.campanha ? <b>{c.campanha}</b> : "A campanha"}{c.campanha_fim ? ` terminou em ${fmtData(c.campanha_fim)}` : " terminou"}.{" "}
                {decisao.pend.length} item(ns) desta sacola entraram com preço promocional. O que cobrar?
              </p>
              <table className="w-full text-xs">
                <thead><tr className="text-left text-gray-500"><th className="py-1">Item</th><th>Promoção</th><th>Preço cheio</th></tr></thead>
                <tbody>{decisao.pend.map((p) => (
                  <tr key={p.sku} className="border-t border-gray-100"><td className="py-1 pr-2 truncate max-w-[9rem]">{p.produto || p.sku}</td><td>{fmtBRL(p.preco_promo)}</td><td>{fmtBRL(p.preco_cheio_atual)}</td></tr>
                ))}</tbody>
              </table>
              <p className="text-xs text-gray-600">Total mantendo a promoção: <b>{fmtBRL(t.promo)}</b> · cobrando o preço cheio: <b>{fmtBRL(t.cheio)}</b> (diferença de {fmtBRL(t.diferenca)}).</p>
              {decisao.sacola.validade && <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg p-2">A cobrança enviada ao cliente prometia o valor da promoção até {fmtData(decisao.sacola.validade)}.</p>}
              <div className="flex flex-col gap-2">
                <button disabled={ocup} onClick={() => decidir(true)} className="w-full rounded-xl py-2.5 font-bold bg-emerald-600 text-white">Manter preço promocional ({fmtBRL(t.promo)})</button>
                <button disabled={ocup} onClick={() => decidir(false)} className="w-full rounded-xl py-2.5 font-bold bg-gray-900 text-white">Cobrar preço cheio ({fmtBRL(t.cheio)})</button>
                <button disabled={ocup} onClick={() => setDecisao(null)} className="text-xs text-gray-500 py-1">Cancelar (não registrar o pagamento)</button>
              </div>
              {ocup && <Loader2 className="w-4 h-4 animate-spin text-orange-500 mx-auto" />}
            </div>
          </div>
        );
      })()}
      {previa && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-3" role="dialog" aria-label="Prévia do envio">
          <div className="bg-white rounded-2xl w-full max-w-md p-4 space-y-3">
            <p className="font-bold text-gray-900">Enviar pelo WhatsApp (API) · {ROTULO_EVENTO[previa.evento]}</p>
            <p className="text-[11px] text-gray-400 font-mono">template {previaEnvio(previa.evento, previa.sacola).template} · para {previa.sacola.cliente_whatsapp}</p>
            <p className="text-sm text-gray-800 bg-emerald-50 rounded-lg p-3 whitespace-pre-wrap">{previaEnvio(previa.evento, previa.sacola).texto}</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setPrevia(null)} className="px-3 py-1.5 text-xs text-gray-500">Cancelar</button>
              <button onClick={async () => {
                const { sacola, evento } = previa; setPrevia(null);
                try { await enviarPelaApi(sacola, evento); await carregarEnvios([sacola]); } catch (e) { setErro(e.message || String(e)); }
              }} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold">Enviar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
