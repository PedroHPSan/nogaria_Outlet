// Custeio do lote em 3 abas: Lote (modo, valor e custos adicionais), Produtos (custo direto por item) e
// Resumo (totais e retorno). Grava pela camada src/lib/custeio.js; o banco mantém custo_total em sincronia.
import React, { useEffect, useMemo, useState } from "react";
import { X, Loader2, Plus, Trash2 } from "lucide-react";
import { loteSemCusto } from "../lib/custoLote";
import { fmtBRL } from "../lib/model";
import {
  TIPOS_EXTRA, REGRAS_RATEIO, carregarItensCusto, carregarExtras, carregarHistoricoCusto, formInicial, totalPrevisto, salvarCusteio, toNum, emTexto, lerColado,
} from "../lib/custeio";

const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-orange-500";
const ABAS = [["lote", "Lote"], ["produtos", "Produtos"], ["resumo", "Resumo"], ["historico", "Histórico"]];
const VENDIDO = (s) => s === "VENDIDO" || s === "ENTREGUE";
const LIMITE_LINHAS = 200;

export default function CustoLoteModal({ lote, onClose, onSaved, abaInicial = "lote" }) {
  const [aba, setAba] = useState(abaInicial);
  const [form, setForm] = useState(null);
  const [itens, setItens] = useState(null);
  const [diretos, setDiretos] = useState({}); // sku -> texto (valor atual na tela)
  const [original, setOriginal] = useState({}); // sku -> texto (como está no banco)
  const [busca, setBusca] = useState("");
  const [valorMassa, setValorMassa] = useState("");
  const [saving, setSaving] = useState(false);
  const [escolheu, setEscolheu] = useState(() => !loteSemCusto(lote)); // lote sem custo: primeiro pergunta como o custo será lançado
  const [colado, setColado] = useState("");
  const [resColado, setResColado] = useState(null);
  const [historico, setHistorico] = useState(null); // null = não carregado · [] = vazio
  const [inicial, setInicial] = useState(null); // JSON do formulário como veio do banco (detecta alterações)
  const [erro, setErro] = useState(null);

  useEffect(() => {
    let cancel = false;
    Promise.all([carregarExtras(lote.lote).catch(() => []), carregarItensCusto(lote.lote)])
      .then(([extras, its]) => {
        if (cancel) return;
        const d = Object.fromEntries(its.map((i) => [i.sku, emTexto(i.custo_direto)]));
        const f0 = formInicial(lote, extras);
        setForm(f0); setInicial(JSON.stringify(f0)); setItens(its); setDiretos(d); setOriginal(d);
      })
      .catch((e) => !cancel && setErro(e.message));
    return () => { cancel = true; };
  }, [lote]);

  useEffect(() => { if (aba === "historico" && historico === null) carregarHistoricoCusto(lote.lote).then(setHistorico).catch(() => setHistorico([])); }, [aba, historico, lote.lote]);

  const alterados = useMemo(
    () => Object.fromEntries(Object.entries(diretos).filter(([sku, v]) => (toNum(v) ?? null) !== (toNum(original[sku]) ?? null))),
    [diretos, original]
  );
  if (!form || !itens) {
    return (
      <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center" onClick={onClose}>
        {erro ? <p className="bg-white rounded-xl p-4 text-sm text-red-600">{erro}</p> : <Loader2 className="w-7 h-7 animate-spin text-white" />}
      </div>
    );
  }

  const sujo = (inicial != null && JSON.stringify(form) !== inicial) || Object.keys(alterados).length > 0;
  const fechar = () => { if (!sujo || window.confirm("Descartar as alterações de custo que ainda não foram salvas?")) onClose(); };

  const aplicarColado = () => {
    const r = lerColado(colado, itens.map((i) => i.sku));
    setResColado(r);
    if (Object.keys(r.valores).length) setDiretos((d) => ({ ...d, ...r.valores }));
  };
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const { base, extras, total } = totalPrevisto(form, diretos);
  const nItens = itens.length;
  const comDireto = itens.filter((i) => toNum(diretos[i.sku]) != null).length;
  const vendidos = itens.filter((i) => VENDIDO(i.status));
  const receita = vendidos.reduce((s, i) => s + (Number(i.valor_vendido) || 0), 0);
  const setExtra = (idx, patch) => set({ extras: form.extras.map((e, i) => (i === idx ? { ...e, ...patch } : e)) });

  const aplicarValor = (soVazios) => {
    const v = toNum(valorMassa);
    if (v == null) return;
    setDiretos((d) => Object.fromEntries(Object.entries(d).map(([sku, atual]) => [sku, soVazios && toNum(atual) != null ? atual : emTexto(v)])));
  };
  const dividirIgual = () => {
    const v = toNum(valorMassa);
    if (!(v > 0) || !nItens) return;
    const cada = Math.floor((v / nItens) * 100) / 100;
    setDiretos((d) => Object.fromEntries(Object.keys(d).map((sku, i) => [sku, emTexto(i === nItens - 1 ? Math.round((v - cada * (nItens - 1)) * 100) / 100 : cada)])));
  };

  const salvar = async () => {
    setSaving(true); setErro(null);
    try {
      await salvarCusteio({ lote, form, diretosAlterados: alterados });
      onSaved?.();
      onClose();
    } catch (e) { setErro(e.message || String(e)); setSaving(false); }
  };

  const linhas = itens.filter((i) => !busca || `${i.sku} ${i.produto || ""}`.toLowerCase().includes(busca.toLowerCase()));

  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-end sm:items-center justify-center" onClick={() => !sujo && onClose()}>
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[92vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 pt-4">
          <h2 className="font-bold text-gray-900 flex-1 truncate">Custo do lote {lote.lote}{lote.referencia ? ` · ${lote.referencia}` : ""}</h2>
          <button onClick={fechar} aria-label="Fechar"><X className="w-6 h-6 text-gray-400" /></button>
        </div>
        {!escolheu ? (
          <div className="px-4 py-4 space-y-3">
            <p className="text-sm text-gray-700">Este lote ainda <b>não tem custo</b>. Como você quer lançar?</p>
            <button onClick={() => { set({ modo: "rateio" }); setAba("lote"); setEscolheu(true); }} className="w-full text-left rounded-xl border border-gray-200 p-4 hover:border-orange-400">
              <p className="font-bold text-gray-900">Paguei um valor pelo lote todo</p><p className="text-xs text-gray-500">Leilão ou compra fechada: informe o total e o sistema divide entre as peças.</p>
            </button>
            <button onClick={() => { set({ modo: "soma" }); setAba("produtos"); setEscolheu(true); }} className="w-full text-left rounded-xl border border-gray-200 p-4 hover:border-orange-400">
              <p className="font-bold text-gray-900">Tenho o custo de cada peça</p><p className="text-xs text-gray-500">Digite ou cole da planilha. Frete e impostos entram como custos adicionais.</p>
            </button>
          </div>
        ) : (<>
        <div className="grid grid-cols-4 gap-1 px-4 mt-3">
          {ABAS.map(([k, r]) => (
            <button key={k} onClick={() => setAba(k)}
              className={`py-2 rounded-lg text-sm font-bold ${aba === k ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"}`}>
              {r}{k === "produtos" && comDireto > 0 ? ` (${comDireto})` : ""}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {aba === "lote" && (<>
            <div className="grid grid-cols-2 gap-2">
              {[["rateio", "Valor do lote", "Leilão: valor fixo rateado entre os itens"], ["soma", "Soma dos itens", "Custo do lote = soma do custo de cada produto"]].map(([k, r, d]) => (
                <button key={k} onClick={() => set({ modo: k })}
                  className={`text-left rounded-xl border p-3 ${form.modo === k ? "border-orange-500 bg-orange-50" : "border-gray-200"}`}>
                  <p className="text-sm font-bold text-gray-900">{r}</p><p className="text-[11px] text-gray-500">{d}</p>
                </button>
              ))}
            </div>
            {form.modo === "rateio" ? (
              <div className="space-y-2">
                {[["valor", "Valor pago pelo lote / lance"], ["comissao", "Comissão do leiloeiro"], ["taxa", "Taxa / despesas de arrematação"]].map(([k, r]) => (
                  <label key={k} className="block"><span className="text-xs font-semibold text-gray-700">{r}</span>
                    <input inputMode="decimal" value={form[k]} onChange={(e) => set({ [k]: e.target.value })} placeholder="0,00" className={`mt-1 ${inputCls}`} />
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs bg-gray-50 rounded-xl p-3 text-gray-600">O custo vem da aba <b>Produtos</b>: {comDireto} de {nItens} itens com custo informado ({fmtBRL(base)}).</p>
            )}
            <div>
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-gray-700">Custos adicionais <span className="font-normal text-gray-400">· {fmtBRL(extras)}</span></p>
                <button onClick={() => set({ extras: [...form.extras, { id: null, sku: "", tipo: "frete_retirada", descricao: "", valor: "", regra_rateio: "motor" }] })}
                  className="text-xs font-bold text-orange-600 flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> adicionar</button>
              </div>
              <p className="text-[11px] text-gray-400">Sem SKU = rateado entre todos os itens do lote. Com SKU = só daquele item.</p>
              <div className="space-y-2 mt-2">
                {form.extras.map((e, i) => (
                  <div key={i} className="rounded-xl border border-gray-200 p-2 grid grid-cols-[1fr_6rem_auto] gap-2 items-center">
                    <select value={e.tipo} onChange={(ev) => setExtra(i, { tipo: ev.target.value })} className={inputCls}>
                      {TIPOS_EXTRA.map(([k, r]) => <option key={k} value={k}>{r}</option>)}
                    </select>
                    <input inputMode="decimal" value={e.valor} onChange={(ev) => setExtra(i, { valor: ev.target.value })} placeholder="R$" className={inputCls} />
                    <button onClick={() => set({ extras: form.extras.filter((_, j) => j !== i) })} aria-label="Remover"><Trash2 className="w-4 h-4 text-gray-400" /></button>
                    <input value={e.descricao} onChange={(ev) => setExtra(i, { descricao: ev.target.value })} placeholder="Descrição (opcional)" className={`${inputCls} col-span-2 text-sm`} />
                    <input value={e.sku} onChange={(ev) => setExtra(i, { sku: ev.target.value })} placeholder="SKU (opcional)" className={`${inputCls} text-sm`} />
                    {!e.sku.trim() && (
                      <select value={e.regra_rateio || "motor"} onChange={(ev) => setExtra(i, { regra_rateio: ev.target.value })} aria-label="Dividir por" className={`${inputCls} text-sm col-span-3`}>
                        {REGRAS_RATEIO.map(([k, r]) => <option key={k} value={k}>Dividir: {r}</option>)}
                      </select>
                    )}
                  </div>
                ))}
                {form.extras.length === 0 && <p className="text-xs text-gray-400">Nenhum custo adicional.</p>}
              </div>
            </div>
          </>)}

          {aba === "produtos" && (<>
            <div className="rounded-xl bg-gray-50 p-2.5 space-y-2">
              <div className="flex gap-2">
                <input inputMode="decimal" value={valorMassa} onChange={(e) => setValorMassa(e.target.value)} placeholder="Valor (R$)" className={inputCls} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => aplicarValor(true)} className="px-2.5 py-1.5 rounded-lg bg-white border border-gray-300 text-xs font-bold">Aplicar aos vazios</button>
                <button onClick={() => aplicarValor(false)} className="px-2.5 py-1.5 rounded-lg bg-white border border-gray-300 text-xs font-bold">Aplicar a todos</button>
                <button onClick={dividirIgual} className="px-2.5 py-1.5 rounded-lg bg-white border border-gray-300 text-xs font-bold">Dividir igualmente</button>
              </div>
              <p className="text-[11px] text-gray-400">Item sem custo direto entra no rateio do valor do lote (modo "Valor do lote").</p>
            </div>
            <details className="rounded-xl bg-gray-50 p-2.5">
              <summary className="text-xs font-bold text-gray-700 cursor-pointer">Colar da planilha</summary>
              <p className="text-[11px] text-gray-500 mt-1.5">Uma peça por linha: <b>SKU;valor</b> (ou SKU e valor separados por tab/espaço). Ou só uma coluna de valores, na ordem dos SKUs.</p>
              <textarea value={colado} onChange={(e) => { setColado(e.target.value); setResColado(null); }} rows={4} placeholder={"NOG-1001-001;35,90\nNOG-1001-002;42"} className={`mt-1.5 ${inputCls} text-sm font-mono`} />
              <button onClick={aplicarColado} disabled={!colado.trim()} className="mt-1.5 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-bold disabled:opacity-40">Aplicar</button>
              {resColado && <p className="text-[11px] mt-1.5 text-gray-600">{Object.keys(resColado.valores).length} peça(s) preenchida(s){resColado.ignorados.length ? ` · ${resColado.ignorados.length} linha(s) ignorada(s) (SKU de outro lote ou valor inválido)` : ""}. Revise e toque em Salvar custo.</p>}
            </details>
            <p className="text-xs font-semibold text-gray-700">{comDireto} de {nItens} peças com custo</p>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar SKU ou produto" className={inputCls} />
            <div className="divide-y divide-gray-100">
              {linhas.slice(0, LIMITE_LINHAS).map((i) => (
                <div key={i.sku} className="py-1.5 flex items-center gap-2">
                  <div className="flex-1 min-w-0"><p className="text-sm font-semibold text-gray-800 truncate">{i.produto || i.sku}</p><p className="text-[11px] text-gray-400">{i.sku}</p></div>
                  <input inputMode="decimal" value={diretos[i.sku] ?? ""} onChange={(e) => setDiretos((d) => ({ ...d, [i.sku]: e.target.value }))}
                    placeholder="rateio" className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-right" />
                </div>
              ))}
              {linhas.length > LIMITE_LINHAS && <p className="text-xs text-gray-400 py-2">Mostrando {LIMITE_LINHAS} de {linhas.length} — use a busca.</p>}
              {linhas.length === 0 && <p className="text-xs text-gray-400 py-2">Nenhum item.</p>}
            </div>
          </>)}

          {aba === "historico" && (
            <div className="space-y-1.5">
              {historico === null && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
              {historico && historico.length === 0 && <p className="text-xs text-gray-400">Nenhuma alteração de custo registrada ainda.</p>}
              {(historico || []).map((h) => (
                <div key={h.id} className="rounded-lg border border-gray-100 p-2 text-xs">
                  <p className="text-gray-500">{new Date(h.ts).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {h.usuario || "—"}</p>
                  <p className="text-gray-800 font-semibold">{h.tabela === "itens" ? `Custo da peça ${h.sku}` : h.tabela === "lote_custos_extra" ? `Custo adicional (${h.acao})${h.sku ? ` · ${h.sku}` : ""}` : "Custo do lote"}</p>
                  <p className="text-gray-500 break-words">{h.antes ? JSON.stringify(h.antes) : "—"} → {h.depois ? JSON.stringify(h.depois) : "removido"}</p>
                </div>
              ))}
            </div>
          )}

          {aba === "resumo" && (
            <div className="space-y-2 text-sm">
              {[["Base do lote", fmtBRL(base)], ["Custos adicionais", fmtBRL(extras)], ["Custo total", fmtBRL(total)],
                ["Itens no lote", nItens], ["Com custo direto", `${comDireto} (${nItens ? Math.round((comDireto / nItens) * 100) : 0}%)`],
                ["Custo médio por item", nItens ? fmtBRL(total / nItens) : "—"],
                ["Vendidos", `${vendidos.length} · ${fmtBRL(receita)}`],
                ["Recuperado do custo", total > 0 ? `${Math.round((receita / total) * 100)}%` : "—"]].map(([r, v], i) => (
                <div key={r} className={`flex justify-between ${i === 2 ? "bg-gray-50 rounded-xl p-3 font-bold" : "px-1"}`}><span className="text-gray-600">{r}</span><b className="text-gray-900">{v}</b></div>
              ))}
              {form.modo === "soma" && comDireto < nItens && (
                <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3">{nItens - comDireto} item(ns) sem custo direto: no modo "Soma dos itens" eles entram com custo zero.</p>
              )}
              {form.modo === "rateio" && Object.keys(alterados).length > 0 && (
                <p className="text-xs text-gray-500 px-1">Itens com custo direto saem da divisão: o valor do lote restante é rateado entre os demais.</p>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 px-4 py-3">
          <div className="flex justify-between text-sm mb-2"><span className="text-gray-600">Custo total</span><b className="text-gray-900">{fmtBRL(total)}</b></div>
          {erro && <p className="text-xs text-red-600 mb-2">{erro}</p>}
          <button onClick={salvar} disabled={saving}
            className="w-full rounded-xl py-3 text-sm font-bold bg-orange-500 text-white disabled:opacity-50 flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Salvar custo
          </button>
        </div>
        </>)}
      </div>
    </div>
  );
}
