// Aviso na ficha do item: ele está em campanha (ativa ou agendada). O "de" fica congelado; mexer no preço de venda
// não altera a promoção em andamento, só o preço depois dela.
import React, { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { campanhasDoItem, vendasEHistoricoDoItem, campanhasEmAndamento, incluirItens, removerItemCampanha } from "../lib/campanhas";
import { avisoCampanhaItem, fmtPrazo, historicoDoProduto, ROTULO_LOG, ROTULO_DECISAO } from "../lib/campanhasCore";
import { fmtBRL } from "../lib/model";

const COR = { ativa: "bg-emerald-100 text-emerald-800", agendada: "bg-sky-100 text-sky-800", encerrada: "bg-gray-200 text-gray-600", cancelada: "bg-red-100 text-red-700" };
const brl = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dt = (iso) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// Auditoria POR PRODUTO: em quais campanhas ele está/esteve (de→por, origem, venda) e o histórico de inclusões/remoções;
// e "Incluir em campanha" (campanha publicada em andamento) — produto por produto.
export default function CampanhaItemAviso({ sku, user }) {
  const [linhas, setLinhas] = useState(null);
  const [extra, setExtra] = useState(null); // { vendas, log }
  const [emAndamento, setEmAndamento] = useState([]);
  const [destino, setDestino] = useState("");
  const [pct, setPct] = useState("20");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rev, setRev] = useState(0);

  useEffect(() => {
    let vivo = true;
    Promise.all([campanhasDoItem(sku), vendasEHistoricoDoItem(sku), campanhasEmAndamento()])
      .then(([l, e, c]) => { if (!vivo) return; setLinhas(l); setExtra(e); setEmAndamento(c); setDestino((d) => d || c[0]?.id || ""); })
      .catch(() => vivo && setLinhas([]));
    return () => { vivo = false; };
  }, [sku, rev]);

  const aviso = avisoCampanhaItem(linhas || []);
  const hist = historicoDoProduto(linhas || [], extra?.vendas || []);
  const incluir = async () => {
    const p = Number(String(pct).replace(",", "."));
    if (!destino) return setMsg({ ok: false, t: "Escolha a campanha." });
    if (!(p > 0 && p <= 90)) return setMsg({ ok: false, t: "Desconto entre 0,01% e 90%." });
    setBusy(true); setMsg(null);
    try {
      const r = await incluirItens(destino, [sku], p, user);
      setMsg(r.incluidos.length ? { ok: true, t: "Produto incluído na campanha (preço de hoje como \"de\")." } : { ok: false, t: `Não incluído: ${r.ignorados[0]?.motivo || "motivo desconhecido"}.` });
      setRev((x) => x + 1);
    } catch (e) { setMsg({ ok: false, t: e.message || String(e) }); } finally { setBusy(false); }
  };
  const remover = async (c) => {
    if (!window.confirm(`Remover ${sku} da campanha "${c.nome}"?`)) return;
    setBusy(true); setMsg(null);
    try { await removerItemCampanha(c.campanha_id, sku, user); setMsg({ ok: true, t: "Removido da campanha." }); setRev((x) => x + 1); }
    catch (e) { setMsg({ ok: false, t: e.message || String(e) }); } finally { setBusy(false); }
  };

  if (linhas === null) return null;
  if (!aviso && hist.length === 0 && emAndamento.length === 0) return null;
  return (
    <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 mb-4 text-sm text-red-900 space-y-2">
      {aviso && (<>
        <p className="font-bold flex items-center gap-1.5"><Megaphone className="w-4 h-4" /> Em campanha: {aviso.campanha} ({aviso.ativa ? `até ${fmtPrazo(aviso.fim_em)}` : `começa em ${fmtPrazo(aviso.inicio_em)}`})</p>
        <p className="text-xs">
          "De" congelado em <b>{fmtBRL(aviso.preco_cheio)}</b> com {String(aviso.desconto_pct).replace(".", ",")}% off. Mudar o preço de venda agora <b>não altera</b> a promoção em andamento;
          vale só para depois dela (e para quem pagar após o fim, conforme a decisão da equipe).
        </p>
      </>)}
      {!aviso && <p className="font-bold flex items-center gap-1.5"><Megaphone className="w-4 h-4" /> Campanhas deste produto</p>}

      <details className="rounded-xl bg-white/70 p-2.5" open={!aviso && hist.length > 0}>
        <summary className="text-xs font-bold cursor-pointer">Histórico por produto ({hist.length} campanha(s))</summary>
        <div className="mt-2 space-y-2">
          {hist.length === 0 && <p className="text-xs text-gray-500">Este produto nunca esteve em campanha.</p>}
          {hist.map((c) => (
            <div key={c.campanha_id} className="rounded-lg border border-red-100 bg-white p-2 text-xs space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <b className="text-gray-900">{c.nome}</b>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${COR[c.estado]}`}>{c.estado}</span>
                {c.origem === "manual" && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">incluído manualmente</span>}
              </div>
              <p className="text-gray-600">{dt(c.inicio_em)} → {dt(c.fim_em)} · <span className="line-through text-gray-400">{brl(c.preco_cheio)}</span> <b>{brl(c.preco_promo)}</b> ({c.desconto_pct}%) · canais: {c.canais.join(", ")}</p>
              {c.venda && <p className="text-emerald-700">Vendido: {brl(c.venda.valor_vendido ?? c.venda.preco_promo)} · {ROTULO_DECISAO[c.venda.decisao]} · {c.venda.origem_ref}</p>}
              {(c.estado === "ativa" || c.estado === "agendada") && <button disabled={busy} onClick={() => remover(c)} className="text-[11px] font-bold text-red-600">Remover desta campanha</button>}
            </div>
          ))}
          {(extra?.log || []).length > 0 && (
            <div className="pt-1 border-t border-red-100">
              <p className="text-[11px] font-bold text-gray-600">Registro de alterações</p>
              {extra.log.map((h) => <p key={h.id} className="text-[11px] text-gray-600">{dt(h.ts)} · {ROTULO_LOG[h.acao] || h.acao}{h.detalhe?.origem === "manual" ? " (manual)" : ""} · {h.usuario || "—"}</p>)}
            </div>
          )}
        </div>
      </details>

      {emAndamento.length > 0 && !hist.some((c) => c.estado === "ativa" || c.estado === "agendada") && (
        <div className="rounded-xl bg-white/70 p-2.5 space-y-1.5">
          <p className="text-xs font-bold">Incluir este produto em uma campanha</p>
          <div className="flex flex-wrap gap-2 items-center">
            <select value={destino} onChange={(e) => setDestino(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white" aria-label="Campanha">
              {emAndamento.map((c) => <option key={c.id} value={c.id}>{c.nome} (até {dt(c.fim_em)})</option>)}
            </select>
            <div className="relative w-20"><input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm pr-5" aria-label="Desconto" /><span className="absolute right-1.5 top-1.5 text-xs text-gray-400">%</span></div>
            <button disabled={busy} onClick={incluir} className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold disabled:opacity-50">Incluir</button>
          </div>
        </div>
      )}
      {msg && <p className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-600"}`} role="status">{msg.t}</p>}
    </div>
  );
}
