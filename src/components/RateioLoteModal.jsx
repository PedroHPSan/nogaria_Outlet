// Rateio do lote: mostra de onde vem o custo (lance + comissão + taxa HISA + frete, real ou
// estimado), quanto cada item carrega, e permite ATRIBUIR PESOS (0,25–4) com prévia do efeito antes
// de salvar. Também congela (fecha) o rateio. Nada muda sem o operador salvar.
import React, { useEffect, useMemo, useState } from "react";
import { X, Loader2, Lock, Unlock, AlertTriangle, Check } from "lucide-react";
import { calcularLote, salvarPesoRateio, fecharRateio, reabrirRateio, temPesoRateio } from "../lib/motorPrecoDb";
import { precificarV2, custoMaximoLance, canalV2 } from "../lib/motorPreco";
import { STATUS_V2 } from "./SugestaoPrecoCard";
import { fmtBRL } from "../lib/model";

const PESOS = [0.25, 0.5, 1, 2, 4];
const pct = (v) => `${(v * 100).toFixed(1).replace(".", ",")}%`;

export default function RateioLoteModal({ lote, params, user, onClose, onAlterado }) {
  const [calc, setCalc] = useState(null);       // rateio atual (salvo)
  const [prev, setPrev] = useState(null);       // prévia com os pesos pendentes
  const [pend, setPend] = useState({});         // sku → k pendente
  const [erro, setErro] = useState(null);
  const [motivo, setMotivo] = useState("");
  const [grupoSel, setGrupoSel] = useState("");
  const [kGrupo, setKGrupo] = useState(1);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null);

  const carregar = (force = false) => calcularLote(lote, params, { force }).then((c) => { setCalc(c); setPend({}); setPrev(null); })
    .catch((e) => setErro(e.message || "Falha ao calcular o rateio"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { carregar(true); }, [lote]);

  // prévia sempre que houver pesos pendentes
  useEffect(() => {
    let cancel = false;
    if (!Object.keys(pend).length) { setPrev(null); return undefined; }
    calcularLote(lote, params, { pesos: pend }).then((c) => { if (!cancel) setPrev(c); }).catch(() => {});
    return () => { cancel = true; };
  }, [pend, lote, params]);

  const vista = prev || calc;
  const linhas = useMemo(() => {
    if (!vista) return [];
    return vista.linhas.map((l) => {
      const r = precificarV2({ alvoMercado: l.alvo, custoAloc: l.custo, canal: l.it.canal_principal, pesoKg: l.it.peso_real_kg ?? l.it.peso_kg, refEstimada: l.refEstimada });
      const antes = calc.linhas.find((x) => x.it.sku === l.it.sku);
      return { ...l, r, delta: l.custo - (antes?.custo ?? l.custo) };
    }).sort((a, b) => b.custo - a.custo);
  }, [vista, calc]);

  const resumo = useMemo(() => {
    if (!vista) return null;
    const custoTotal = vista.custo?.total ?? 0;
    const anuncio = linhas.reduce((s, l) => s + (l.refEstimada ? 0 : l.alvo), 0);
    const maxLance = custoMaximoLance(linhas.map((l) => ({ alvo: l.refEstimada ? 0 : l.alvo, grupo: l.it.grupo, pesoKg: l.it.peso_real_kg ?? l.it.peso_kg, canal: canalV2(l.it.canal_principal) })));
    const lucro = linhas.filter((l) => ["ANUNCIAR", "GIRO", "LOCAL"].includes(l.r.status)).reduce((s, l) => s + (l.r.lucro || 0), 0);
    const cont = {}; linhas.forEach((l) => { cont[l.r.status] = (cont[l.r.status] || 0) + 1; });
    return { custoTotal, anuncio, maxLance, lucro, cont, semRef: linhas.filter((l) => l.refEstimada).length };
  }, [vista, linhas]);

  const grupos = useMemo(() => [...new Set((calc?.linhas || []).map((l) => l.it.grupo).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")), [calc]);
  const setK = (sku, k) => setPend((p) => {
    const atual = calc.linhas.find((l) => l.it.sku === sku)?.k ?? 1;
    const n = { ...p };
    if (Number(k) === atual) delete n[sku]; else n[sku] = Number(k);
    return n;
  });
  const aplicarGrupo = () => {
    if (!grupoSel) return;
    setPend((p) => {
      const n = { ...p };
      calc.linhas.filter((l) => l.it.grupo === grupoSel).forEach((l) => { if (Number(kGrupo) === l.k) delete n[l.it.sku]; else n[l.it.sku] = Number(kGrupo); });
      return n;
    });
  };

  const salvar = async () => {
    setSalvando(true); setMsg(null);
    let ok = 0; let falha = null;
    for (const [sku, k] of Object.entries(pend)) {
      const ant = calc.linhas.find((l) => l.it.sku === sku)?.k ?? 1;
      const r = await salvarPesoRateio({ sku, k, motivo, anterior: ant, user });
      if (r.ok) ok++; else { falha = r.erro; break; }
    }
    setSalvando(false);
    if (falha) setMsg({ erro: true, txt: falha }); else setMsg({ erro: false, txt: `${ok} peso(s) salvo(s).` });
    await carregar(true);
    onAlterado?.();
  };
  const alternarFechamento = async () => {
    setSalvando(true); setMsg(null);
    const r = calc.fechado ? await reabrirRateio(lote) : await fecharRateio(lote, params, user);
    setSalvando(false);
    setMsg(r.ok ? { erro: false, txt: calc.fechado ? "Rateio reaberto." : `Rateio fechado (${r.itens} itens congelados).` } : { erro: true, txt: r.erro });
    await carregar(true);
    onAlterado?.();
  };

  const c = calc?.custo;
  const nPend = Object.keys(pend).length;
  const migPeso = temPesoRateio();
  return (
    <div className="fixed inset-0 z-[75] bg-black/50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-3xl rounded-t-2xl sm:rounded-2xl p-4 space-y-3 max-h-[94vh] flex flex-col">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Rateio do lote {lote}{calc?.fechado ? " · fechado" : ""}</h2>
          <button onClick={onClose} aria-label="Fechar"><X className="w-6 h-6 text-gray-400" /></button>
        </div>
        {erro && <p className="text-sm text-red-600">{erro}</p>}
        {!calc && !erro ? <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Calculando…</p> : calc && resumo && (
          <>
            {c ? (
              <div className="text-xs text-gray-700 bg-gray-50 rounded-lg p-2 space-y-0.5">
                <p className="font-semibold">Custo do lote: {fmtBRL(c.total)} <span className="font-normal text-gray-500">({c.origem})</span></p>
                {c.lance != null && <p>Lance {fmtBRL(c.lance)} + comissão 5% {fmtBRL(c.comissao)} + taxa HISA {fmtBRL(c.taxaHisa)} ({c.taxaOrigem}) + frete {fmtBRL(c.frete)} ({c.freteOrigem})</p>}
                <p>Anúncio potencial (com referência) {fmtBRL(resumo.anuncio)} · custo = {resumo.anuncio ? pct(resumo.custoTotal / resumo.anuncio) : "—"} do anúncio · <b>custo máximo p/ 25% de margem: {fmtBRL(resumo.maxLance)}</b></p>
                {resumo.custoTotal > resumo.maxLance && <p className="text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Custo do lote acima do máximo que fecha 25% no canal escolhido: o pesos só redistribuem, não criam margem.</p>}
              </div>
            ) : <p className="text-sm text-amber-700">Lote sem custo cadastrado.</p>}
            <p className="text-xs text-gray-600">
              Lucro esperado dos itens anunciáveis {fmtBRL(resumo.lucro)} · {Object.entries(resumo.cont).map(([k, v]) => `${STATUS_V2[k]?.txt || k}: ${v}`).join(" · ")}
              {resumo.semRef ? ` · ${resumo.semRef} com custo estimado (sem referência)` : ""}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-gray-500">Peso em massa:</span>
              <select value={grupoSel} onChange={(e) => setGrupoSel(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1">
                <option value="">grupo…</option>{grupos.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <select value={kGrupo} onChange={(e) => setKGrupo(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1">
                {PESOS.map((k) => <option key={k} value={k}>peso {k}</option>)}
              </select>
              <button onClick={aplicarGrupo} disabled={!grupoSel} className="px-2 py-1 rounded-lg bg-gray-900 text-white disabled:bg-gray-300">Aplicar ao grupo</button>
              {nPend > 0 && <button onClick={() => setPend({})} className="text-gray-500 underline">limpar prévia</button>}
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-lg">
              {linhas.map((l) => {
                const st = STATUS_V2[l.r.status] || STATUS_V2.SEM_REF;
                const mudou = pend[l.it.sku] != null;
                return (
                  <div key={l.it.sku} className={`px-3 py-1.5 text-xs flex items-center gap-2 ${mudou ? "bg-amber-50" : ""}`}>
                    <span className="font-mono text-gray-500 w-20 shrink-0">{l.it.sku}</span>
                    <span className="flex-1 min-w-0 truncate text-gray-800">{l.it.produto}{l.refEstimada ? " · ref. estimada" : ""}</span>
                    <span className="w-16 text-right text-gray-500">{fmtBRL(l.alvo)}</span>
                    <select value={pend[l.it.sku] ?? l.k} onChange={(e) => setK(l.it.sku, e.target.value)} disabled={calc.fechado} className="rounded border border-gray-300 px-1 py-0.5 w-16" aria-label="Peso">
                      {PESOS.map((k) => <option key={k} value={k}>×{k}</option>)}
                    </select>
                    <span className="w-20 text-right font-semibold">{fmtBRL(l.custo)}{mudou && l.delta ? <span className={`block text-[10px] ${l.delta > 0 ? "text-red-600" : "text-emerald-700"}`}>{l.delta > 0 ? "+" : ""}{fmtBRL(l.delta)}</span> : null}</span>
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${st.cls}`}>{st.txt}</span>
                  </div>
                );
              })}
            </div>
            {nPend > 0 && (
              <div className="space-y-2">
                <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo do peso (obrigatório) — ex.: robô veio sem base" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                {!migPeso && <p className="text-xs text-amber-700">A migration do peso de rateio ainda não foi aplicada: a prévia funciona, mas não dá para salvar.</p>}
                <button onClick={salvar} disabled={salvando || !motivo.trim() || !migPeso}
                  className="w-full rounded-xl py-2.5 font-bold bg-orange-500 text-white flex items-center justify-center gap-2 disabled:bg-gray-300 disabled:text-gray-500">
                  {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar {nPend} peso(s)
                </button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <button onClick={alternarFechamento} disabled={salvando || !c || nPend > 0}
                className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold border border-gray-300 text-gray-700 disabled:opacity-40">
                {calc.fechado ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />} {calc.fechado ? "Reabrir rateio" : "Fechar rateio (congelar)"}
              </button>
              {msg && <span className={`text-xs ${msg.erro ? "text-red-600" : "text-emerald-700"}`}>{msg.txt}</span>}
            </div>
            <p className="text-[11px] text-gray-400">Frete e taxa HISA estimados onde não há dado real. O peso só redistribui o custo do lote; limite 0,25–4, motivo obrigatório e registrado.</p>
          </>
        )}
      </div>
    </div>
  );
}
