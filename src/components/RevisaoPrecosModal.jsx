// Revisão de preços em massa (motor v2): lista o preço atual × sugerido com status e lucro, filtra
// por situação e valida vários de uma vez. Só grava o que o operador marcar, nunca abaixo do piso,
// e mantém o preço atual quando ele já cobre a margem mínima.
import React, { useEffect, useMemo, useState } from "react";
import { X, Loader2, Check, ChevronDown } from "lucide-react";
import { analisarItens, validarPreco } from "../lib/motorPrecoDb";
import { STATUS_V2 } from "./pricing/statusV2";
import { fmtBRL } from "../lib/model";

const FILTROS = [
  ["TODOS", "Todos"], ["ANUNCIAR", "Pode anunciar"], ["REVISAR", "Revisar"], ["KIT", "Kit"], ["SEM_REF", "Sem ref."], ["INVIAVEL", "Inviáveis"],
];
const grupoDe = (s) => (s === "GIRO" || s === "LOCAL" ? "REVISAR" : s);

export default function RevisaoPrecosModal({ itens, params, user, onClose, onAplicado }) {
  const [mapa, setMapa] = useState(null);
  const [erro, setErro] = useState(null);
  const [filtro, setFiltro] = useState("TODOS");
  const [marcados, setMarcados] = useState(new Set());
  const [aberto, setAberto] = useState(null);
  const [aplicando, setAplicando] = useState(false);
  const [resultado, setResultado] = useState(null);

  useEffect(() => {
    let cancel = false;
    analisarItens(itens, params, { force: true }).then((m) => {
      if (cancel) return;
      setMapa(m);
      // pré-marca só o que está pronto para anunciar e ainda não foi validado
      setMarcados(new Set(itens.filter((i) => m.get(i.sku)?.status === "ANUNCIAR" && m.get(i.sku)?.aprovacao !== "APROVADO").map((i) => i.sku)));
    }).catch((e) => !cancel && setErro(e.message || "Falha ao calcular"));
    return () => { cancel = true; };
  }, [itens, params]);

  const linhas = useMemo(() => {
    if (!mapa) return [];
    return itens.map((it) => {
      const r = mapa.get(it.sku);
      if (!r) return null;
      const mantem = r.atual != null && r.atual >= r.minimo && r.status !== "SEM_REF" && r.status !== "KIT";
      const final = mantem ? r.atual : r.sugerido;
      const apto = final > 0 && final >= r.piso && (mantem || ["ANUNCIAR", "GIRO", "LOCAL"].includes(r.status));
      return { it, r, final, mantem, apto };
    }).filter(Boolean);
  }, [mapa, itens]);

  const contagem = useMemo(() => {
    const c = { TODOS: linhas.length };
    linhas.forEach((l) => { const g = grupoDe(l.r.status); c[g] = (c[g] || 0) + 1; });
    return c;
  }, [linhas]);
  const visiveis = linhas.filter((l) => filtro === "TODOS" || grupoDe(l.r.status) === filtro);
  const aValidar = linhas.filter((l) => marcados.has(l.it.sku) && l.apto);

  // efeito da validação sobre os preços que já existem (evita baixar preço em massa sem perceber)
  const efeito = aValidar.reduce((e, l) => {
    if (l.r.atual == null) e.novos++; else if (l.final < l.r.atual) e.baixam++; else if (l.final > l.r.atual) e.sobem++; else e.iguais++;
    return e;
  }, { baixam: 0, sobem: 0, novos: 0, iguais: 0 });
  const alternar = (sku) => setMarcados((s) => { const n = new Set(s); n.has(sku) ? n.delete(sku) : n.add(sku); return n; });
  const marcarVisiveis = () => setMarcados((s) => { const n = new Set(s); visiveis.filter((l) => l.apto).forEach((l) => n.add(l.it.sku)); return n; });

  const validar = async () => {
    setAplicando(true);
    let ok = 0; const erros = [];
    for (const l of aValidar) {
      const v = await validarPreco({ sku: l.it.sku, preco: l.final, piso: l.r.piso, user, origem: "revisao-massa",
        motivo: `revisão em massa ${l.r.status}${l.mantem ? " (preço mantido)" : ""}` });
      v.ok ? ok++ : erros.push(l.it.sku);
    }
    setAplicando(false);
    setResultado({ ok, erros });
    onAplicado?.();
  };

  return (
    <div className="fixed inset-0 z-[75] bg-black/50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-2xl rounded-t-2xl sm:rounded-2xl p-4 space-y-3 max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Revisar preços ({itens.length})</h2>
          <button onClick={onClose} aria-label="Fechar"><X className="w-6 h-6 text-gray-400" /></button>
        </div>
        <p className="text-xs text-gray-500 -mt-1">Compara o preço atual com o sugerido pelo motor novo (custo real do lote, taxas e margem mínima de 25%). Só grava o que você marcar, nunca abaixo do piso.</p>
        {erro && <p className="text-sm text-red-600">{erro}</p>}
        {!mapa && !erro ? (
          <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Calculando…</p>
        ) : mapa && (
          <>
            <div className="flex gap-1.5 overflow-x-auto pb-1 shrink-0">
              {FILTROS.map(([k, t]) => (
                <button key={k} onClick={() => setFiltro(k)}
                  className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold border ${filtro === k ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200"}`}>
                  {t} ({contagem[k] || 0})
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between text-xs">
              <button onClick={marcarVisiveis} className="text-blue-700 font-semibold">Marcar aptos da lista</button>
              <button onClick={() => setMarcados(new Set())} className="text-gray-500">Limpar</button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-lg">
              {visiveis.map(({ it, r, final, mantem, apto }) => {
                const st = STATUS_V2[r.status] || STATUS_V2.SEM_REF;
                return (
                  <div key={it.sku} className="px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <input type="checkbox" className="accent-orange-500" disabled={!apto} checked={marcados.has(it.sku) && apto} onChange={() => alternar(it.sku)} />
                      <span className="font-mono text-gray-500 w-20 shrink-0">{it.sku}</span>
                      <span className="flex-1 min-w-0 truncate text-gray-800">{it.produto}</span>
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${st.cls}`}>{st.txt}</span>
                    </div>
                    <div className="flex items-center gap-2 pl-6 mt-0.5 text-gray-600">
                      <span>{r.atual != null ? fmtBRL(r.atual) : "—"} → <b className={apto ? "text-emerald-700" : "text-gray-500"}>{final ? fmtBRL(final) : "—"}</b>{mantem ? " (mantém)" : ""}</span>
                      {r.lucro != null && <span>· lucro {fmtBRL(r.lucro)} ({(r.margem * 100).toFixed(0)}%)</span>}
                      <span className="text-gray-400">· piso {fmtBRL(r.piso)}</span>
                      {it.preco_aprovacao === "APROVADO" && <span className="text-emerald-700">· validado</span>}
                      <button className="ml-auto text-blue-700" onClick={() => setAberto(aberto === it.sku ? null : it.sku)} aria-label="Por quê">
                        <ChevronDown className={`w-3.5 h-3.5 transition ${aberto === it.sku ? "rotate-180" : ""}`} />
                      </button>
                    </div>
                    {aberto === it.sku && <ul className="pl-8 mt-1 space-y-0.5 list-disc text-gray-700">{r.explicacao.map((x, i) => <li key={i}>{x}</li>)}</ul>}
                  </div>
                );
              })}
              {!visiveis.length && <p className="p-3 text-xs text-gray-400">Nada nesta situação.</p>}
            </div>
            {!resultado && aValidar.length > 0 && (
              <p className="text-xs text-gray-600">Ao validar: <b className={efeito.baixam ? "text-red-600" : ""}>{efeito.baixam} baixam</b> · {efeito.sobem} sobem · {efeito.novos} sem preço hoje · {efeito.iguais} iguais</p>
            )}
            {resultado ? (
              <p className="text-sm text-emerald-700 flex items-center gap-1.5"><Check className="w-4 h-4" /> {resultado.ok} preço(s) validado(s){resultado.erros.length ? ` · ${resultado.erros.length} falha(s)` : ""}</p>
            ) : (
              <button onClick={validar} disabled={aplicando || !aValidar.length}
                className="w-full rounded-xl py-3 font-bold bg-orange-500 text-white flex items-center justify-center gap-2 disabled:bg-gray-300 disabled:text-gray-500">
                {aplicando && <Loader2 className="w-4 h-4 animate-spin" />} Validar {aValidar.length} preço(s)
              </button>
            )}
            <p className="text-[11px] text-gray-400">Sem referência, kit e inviáveis não são gravados aqui. O custo do lote usa frete e taxa HISA estimados onde não há dado real.</p>
          </>
        )}
      </div>
    </div>
  );
}
