// Custos extras GLOBAIS: valem para todos os lotes (ou um subconjunto), com vigência e exceções por lote.
// Não são copiados para cada lote: o banco soma na hora (custo_itens_lote).
import React, { useCallback, useEffect, useState } from "react";
import { X, Loader2, Plus, Trash2 } from "lucide-react";
import {
  TIPOS_EXTRA, REGRAS_RATEIO, BASES_GLOBAL, globalVazio, validarGlobal, soErros, descreverGlobal, emTexto,
  listarGlobais, salvarGlobal, removerGlobal, listarExcecoes, definirExcecao,
} from "../lib/custeio";

const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-orange-500";

export default function CustosGlobaisModal({ lotes = [], onClose, onSaved }) {
  const [lista, setLista] = useState(null);
  const [form, setForm] = useState(null);
  const [excecoes, setExcecoes] = useState([]);
  const [msgs, setMsgs] = useState([]);
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(() => listarGlobais().then(setLista).catch((e) => { setMsgs([e.message]); setLista([]); }), []);
  useEffect(() => { carregar(); }, [carregar]);

  const editar = async (g) => {
    setMsgs([]);
    setForm({ ...g, valor: emTexto(g.valor), grupos: (g.grupos || []).join(", "), lotes: (g.lotes || []).join(", "), vigencia_fim: g.vigencia_fim || "" });
    setExcecoes(await listarExcecoes(g.id).catch(() => []));
  };
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const avisos = form ? validarGlobal(form) : [];

  const salvar = async () => {
    const erros = soErros(validarGlobal(form));
    if (erros.length) { setMsgs(erros); return; }
    setBusy(true); setMsgs([]);
    try { await salvarGlobal(form); setForm(null); await carregar(); onSaved?.(); }
    catch (e) { setMsgs([e.message || String(e)]); } finally { setBusy(false); }
  };
  const remover = async (g) => {
    if (!window.confirm(`Remover o custo global "${g.nome}"? Os lotes deixam de somá-lo.`)) return;
    try { await removerGlobal(g.id); await carregar(); onSaved?.(); } catch (e) { setMsgs([e.message || String(e)]); }
  };
  const alternarExcecao = async (lote) => {
    const tem = excecoes.includes(lote);
    try { await definirExcecao(form.id, lote, !tem); setExcecoes((x) => (tem ? x.filter((l) => l !== lote) : [...x, lote])); onSaved?.(); }
    catch (e) { setMsgs([e.message || String(e)]); }
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-end sm:items-center justify-center" onClick={() => !form && onClose()}>
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[92vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 pt-4 pb-2">
          <h2 className="font-bold text-gray-900 flex-1">Custos globais</h2>
          <button onClick={onClose} aria-label="Fechar"><X className="w-6 h-6 text-gray-400" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
          <p className="text-xs text-gray-500">Custos que valem para todos os lotes (ou alguns): embalagem padrão, taxa fixa, imposto %. O banco soma ao custo de cada peça na hora; não é preciso lançar lote a lote.</p>
          {msgs.length > 0 && <ul className="text-sm text-red-600 bg-red-50 rounded-lg p-2 list-disc pl-6">{msgs.map((m, i) => <li key={i}>{m}</li>)}</ul>}

          {!form && (<>
            <button onClick={() => { setMsgs([]); setExcecoes([]); setForm({ ...globalVazio(), vigencia_inicio: new Date().toISOString().slice(0, 10) }); }}
              className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 font-bold bg-orange-500 text-white"><Plus className="w-4 h-4" /> Novo custo global</button>
            {lista === null && <Loader2 className="w-5 h-5 animate-spin text-orange-500" />}
            {lista && lista.length === 0 && <p className="text-sm text-gray-500">Nenhum custo global cadastrado.</p>}
            {(lista || []).map((g) => (
              <div key={g.id} className={`rounded-xl border p-3 ${g.ativo ? "border-gray-200" : "border-gray-100 opacity-60"}`}>
                <div className="flex items-center gap-2">
                  <button onClick={() => editar(g)} className="flex-1 text-left min-w-0"><p className="font-bold text-gray-900 truncate">{g.nome}{!g.ativo ? " (inativo)" : ""}</p></button>
                  <button onClick={() => remover(g)} aria-label="Remover"><Trash2 className="w-4 h-4 text-gray-400" /></button>
                </div>
                <p className="text-xs text-gray-600">{descreverGlobal(g)}</p>
                <p className="text-[11px] text-gray-400">Vigência: {g.vigencia_inicio}{g.vigencia_fim ? ` a ${g.vigencia_fim}` : " em diante"} · pela data do lote</p>
              </div>
            ))}
          </>)}

          {form && (
            <div className="space-y-2">
              <label className="block text-xs font-bold text-gray-600">Nome<input className={inputCls} value={form.nome} onChange={(e) => set({ nome: e.target.value })} placeholder="Ex.: Taxa de separação" /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs font-bold text-gray-600">Tipo<select className={inputCls} value={form.tipo} onChange={(e) => set({ tipo: e.target.value })}>{TIPOS_EXTRA.map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select></label>
                <label className="block text-xs font-bold text-gray-600">{form.base === "pct_custo_lote" ? "Percentual (%)" : "Valor (R$)"}<input inputMode="decimal" className={inputCls} value={form.valor} onChange={(e) => set({ valor: e.target.value })} /></label>
              </div>
              <label className="block text-xs font-bold text-gray-600">Como aplicar<select className={inputCls} value={form.base} onChange={(e) => set({ base: e.target.value })}>{BASES_GLOBAL.map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select></label>
              {form.base === "por_lote" && <label className="block text-xs font-bold text-gray-600">Dividir entre as peças<select className={inputCls} value={form.regra_rateio} onChange={(e) => set({ regra_rateio: e.target.value })}>{REGRAS_RATEIO.filter(([k]) => k !== "motor").map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select></label>}
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs font-bold text-gray-600">Vigência — início<input type="date" className={inputCls} value={form.vigencia_inicio} onChange={(e) => set({ vigencia_inicio: e.target.value })} /></label>
                <label className="block text-xs font-bold text-gray-600">Fim (opcional)<input type="date" className={inputCls} value={form.vigencia_fim} onChange={(e) => set({ vigencia_fim: e.target.value })} /></label>
              </div>
              <label className="block text-xs font-bold text-gray-600">Só destes grupos (opcional, separe por vírgula)<input className={inputCls} value={form.grupos} onChange={(e) => set({ grupos: e.target.value })} placeholder="Vestuário, Calçados" /></label>
              <label className="block text-xs font-bold text-gray-600">Só destes lotes (opcional)<input className={inputCls} value={form.lotes} onChange={(e) => set({ lotes: e.target.value })} placeholder="1001, 1003" /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.ativo} onChange={(e) => set({ ativo: e.target.checked })} /> Ativo</label>
              {form.id && lotes.length > 0 && (
                <details className="rounded-xl bg-gray-50 p-2.5">
                  <summary className="text-xs font-bold text-gray-700 cursor-pointer">Exceções: lotes que NÃO pagam este custo ({excecoes.length})</summary>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {lotes.map((l) => (
                      <button key={l.lote} onClick={() => alternarExcecao(l.lote)} className={`px-2 py-1 rounded-full text-xs font-semibold border ${excecoes.includes(l.lote) ? "bg-red-50 border-red-300 text-red-700" : "bg-white border-gray-200 text-gray-600"}`}>
                        {l.lote}{excecoes.includes(l.lote) ? " ✕" : ""}
                      </button>
                    ))}
                  </div>
                </details>
              )}
              {avisos.filter((m) => m.startsWith("Atenção")).map((m) => <p key={m} className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2">{m}</p>)}
              <div className="flex gap-2">
                <button disabled={busy} onClick={salvar} className="flex-1 rounded-xl py-3 font-bold bg-orange-500 text-white disabled:opacity-50">{busy ? "Salvando…" : "Salvar"}</button>
                <button onClick={() => { setForm(null); setMsgs([]); }} className="px-4 rounded-xl border border-gray-300 font-bold text-gray-700">Voltar</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
