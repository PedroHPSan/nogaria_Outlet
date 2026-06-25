import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabase";
import { ALL_STATUS, fmtBRL, LOTE_SEM } from "../lib/model";
import { CANAIS, checarCompletude, diagnosticarPorCanal, precoVenda, toCSV, baixarArquivo, COLUNAS_MEDICAO, COLUNAS_AMAZON } from "../lib/export";
import { pendenteMedida } from "../lib/medidas";
import { Download, Loader2, AlertTriangle, CheckCircle2, FileSpreadsheet, Ruler, ShoppingCart } from "lucide-react";

const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base bg-white focus:outline-none focus:ring-2 focus:ring-orange-500";
const PAGE = 1000;

export default function ExportScreen({ lotes, refreshKey }) {
  const [fLote, setFLote] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fCanal, setFCanal] = useState("");
  const [soCompletos, setSoCompletos] = useState(true);
  const [itens, setItens] = useState(null); // null = carregando

  // Carrega todos os itens que batem com os filtros (paginado: o PostgREST
  // corta em 1.000 linhas, então acumulamos com .range() até trazer tudo).
  useEffect(() => {
    let cancelado = false;
    (async () => {
      setItens(null);
      let data = [];
      for (let from = 0; ; from += PAGE) {
        let query = supabase.from("itens").select("*");
        if (fLote === LOTE_SEM) query = query.is("lote", null);
        else if (fLote) query = query.eq("lote", Number(fLote));
        if (fStatus) query = query.eq("status", fStatus);
        if (fCanal) query = query.eq("canal_principal", fCanal);
        const { data: chunk, error } = await query.order("sku").range(from, from + PAGE - 1);
        if (error || !chunk) break;
        data = data.concat(chunk);
        if (chunk.length < PAGE) break;
      }
      if (!cancelado) setItens(data);
    })();
    return () => { cancelado = true; };
  }, [fLote, fStatus, fCanal, refreshKey]);

  // Separa em completos/incompletos e agrega os campos que mais faltam.
  // Com canal selecionado, "completo" = PRONTO para aquele canal (diagnosticarPorCanal,
  // que exige GTIN/NCM/dimensões/foto p/ ML e Amazon). Sem canal, usa a base genérica.
  const analise = useMemo(() => {
    if (!itens) return null;
    const prontidao = fCanal
      ? (it) => {
          const d = diagnosticarPorCanal(it).find((c) => c.canal === fCanal);
          return d ? { ok: d.pronto, faltando: d.faltando } : checarCompletude(it);
        }
      : (it) => checarCompletude(it);
    const completos = [], incompletos = [];
    const faltas = {};
    for (const it of itens) {
      const { ok, faltando } = prontidao(it);
      if (ok) completos.push(it);
      else {
        incompletos.push(it);
        faltando.forEach((l) => (faltas[l] = (faltas[l] || 0) + 1));
      }
    }
    const valor = completos.reduce((s, it) => s + (Number(precoVenda(it)) || 0), 0);
    const topFaltas = Object.entries(faltas).sort((a, b) => b[1] - a[1]);
    return { completos, incompletos, valor, topFaltas };
  }, [itens, fCanal]);

  const exportar = () => {
    const alvo = soCompletos ? analise.completos : itens;
    if (!alvo.length) return;
    const dt = new Date().toISOString().slice(0, 10);
    const sufLote = fLote === LOTE_SEM ? "-semlote" : fLote ? `-lote${fLote}` : "";
    const sufCanal = fCanal ? `-${fCanal.toLowerCase().replace(/\s+/g, "")}` : "";
    baixarArquivo(`nogaria-hub${sufLote}${sufCanal}-${dt}.csv`, toCSV(alvo));
  };

  const exportarAmazon = () => {
    const alvo = soCompletos ? analise.completos : itens;
    if (!alvo.length) return;
    const dt = new Date().toISOString().slice(0, 10);
    const sufLote = fLote === LOTE_SEM ? "-semlote" : fLote ? `-lote${fLote}` : "";
    baixarArquivo(`nogaria-amazon${sufLote}-${dt}.csv`, toCSV(alvo, COLUNAS_AMAZON));
  };

  const alvoLen = analise ? (soCompletos ? analise.completos.length : itens.length) : 0;

  // Lista de campo dos itens ainda não medidos/pesados (dentro dos filtros atuais).
  const pendentes = useMemo(() => (itens || []).filter(pendenteMedida), [itens]);
  const exportarPendentes = () => {
    if (!pendentes.length) return;
    const dt = new Date().toISOString().slice(0, 10);
    const sufLote = fLote === LOTE_SEM ? "-semlote" : fLote ? `-lote${fLote}` : "";
    baixarArquivo(`nogaria-medir${sufLote}-${dt}.csv`, toCSV(pendentes, COLUNAS_MEDICAO));
  };

  return (
    <div className="px-4 pt-4 pb-24 space-y-4">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Exportar para hub</h2>
        <p className="text-sm text-gray-500">CSV de produtos limpos para o integrador (Bling / Tiny / Magis5 / ANYMARKET).</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2">
        <select value={fLote} onChange={(e) => setFLote(e.target.value)} className={inputCls}>
          <option value="">Todos os lotes</option>
          <option value={LOTE_SEM}>Sem lote</option>
          {lotes.map((l) => <option key={l.lote} value={String(l.lote)}>Lote {l.lote} — {l.referencia || ""}</option>)}
        </select>
        <div className="flex gap-2">
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={inputCls}>
            <option value="">Todos os status</option>
            {ALL_STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select value={fCanal} onChange={(e) => setFCanal(e.target.value)} className={inputCls}>
            <option value="">Todos os canais</option>
            {CANAIS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 pt-1 text-sm font-medium text-gray-700">
          <input type="checkbox" checked={soCompletos} onChange={(e) => setSoCompletos(e.target.checked)}
            className="w-4 h-4 rounded accent-orange-500" />
          {fCanal ? `Exportar só itens prontos para ${fCanal}` : "Exportar só itens completos"}
        </label>
        {fCanal && (
          <p className="text-xs text-gray-400">Prontidão para <b>{fCanal}</b> inclui GTIN, NCM, dimensões/peso e foto.</p>
        )}
      </div>

      {!analise ? (
        <div className="py-12 text-center"><Loader2 className="w-7 h-7 animate-spin text-orange-500 mx-auto" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
              <div className="flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="w-4 h-4" /><span className="text-xs font-bold uppercase tracking-wide">{fCanal ? "Prontos" : "Completos"}</span></div>
              <p className="text-3xl font-bold text-emerald-800 mt-1">{analise.completos.length.toLocaleString("pt-BR")}</p>
              <p className="text-xs text-emerald-700 mt-0.5">{fmtBRL(analise.valor)} em venda</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <div className="flex items-center gap-1.5 text-amber-700"><AlertTriangle className="w-4 h-4" /><span className="text-xs font-bold uppercase tracking-wide">Incompletos</span></div>
              <p className="text-3xl font-bold text-amber-800 mt-1">{analise.incompletos.length.toLocaleString("pt-BR")}</p>
              <p className="text-xs text-amber-700 mt-0.5">de {itens.length.toLocaleString("pt-BR")} no total</p>
            </div>
          </div>

          {analise.topFaltas.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Campos que mais faltam</h3>
              <div className="space-y-1.5">
                {analise.topFaltas.map(([label, n]) => (
                  <div key={label} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">{label}</span>
                    <span className="font-bold text-amber-700">{n.toLocaleString("pt-BR")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button onClick={exportar} disabled={!alvoLen}
            className="w-full flex items-center justify-center gap-2 bg-orange-500 text-white rounded-2xl py-3.5 font-bold shadow-sm active:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed">
            <Download className="w-5 h-5" />
            Baixar CSV ({alvoLen.toLocaleString("pt-BR")} {alvoLen === 1 ? "item" : "itens"})
          </button>

          <button onClick={exportarAmazon} disabled={!alvoLen}
            className="w-full flex items-center justify-center gap-2 bg-gray-900 text-white rounded-2xl py-3 font-semibold active:bg-black disabled:opacity-40 disabled:cursor-not-allowed">
            <ShoppingCart className="w-4.5 h-4.5" />
            Baixar Amazon flat file ({alvoLen.toLocaleString("pt-BR")})
          </button>

          <button onClick={exportarPendentes} disabled={!pendentes.length}
            className="w-full flex items-center justify-center gap-2 bg-white text-gray-700 border border-gray-300 rounded-2xl py-3 font-semibold active:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
            <Ruler className="w-4.5 h-4.5" />
            Pendentes de medição ({pendentes.length.toLocaleString("pt-BR")})
          </button>

          {!itens.length && (
            <div className="text-center py-10 text-gray-400">
              <FileSpreadsheet className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Nenhum item com esses filtros.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
