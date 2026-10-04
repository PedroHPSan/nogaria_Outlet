// Preço rápido em massa: mostra a prévia (atual → novo, motivo) e só aplica o que
// não pede aprovação. Nunca grava abaixo do piso do motor.
import React, { useEffect, useMemo, useState } from "react";
import { X, Loader2, AlertTriangle, Check } from "lucide-react";
import { derivarPreco } from "../lib/precoView";
import { planoEmMassa } from "../lib/precoRapido";
import { carregarFaixas, carregarCustos, aplicarPlano } from "../lib/precoRapidoDb";
import { fmtBRL } from "../lib/model";

export default function PrecoRapidoModal({ itens, params, user, onClose, onAplicado }) {
  const [faixas, setFaixas] = useState(null);
  const [custos, setCustos] = useState(null);
  const [arredondar, setArredondar] = useState(true);
  const [markdown, setMarkdown] = useState(true);
  const [aplicando, setAplicando] = useState(false);
  const [resultado, setResultado] = useState(null);

  useEffect(() => {
    let cancel = false;
    Promise.all([carregarFaixas(), carregarCustos(itens.map((i) => i.sku))]).then(([f, c]) => {
      if (!cancel) { setFaixas(f); setCustos(c); }
    });
    return () => { cancel = true; };
  }, [itens]);

  const plano = useMemo(() => {
    if (!faixas) return null;
    return planoEmMassa(itens, (it) => derivarPreco(it, params?.grupos?.[it.grupo] || {}, params, custos?.[it.sku] ?? null), { faixas, arredondar, markdown });
  }, [itens, params, faixas, custos, arredondar, markdown]);

  const aplicar = async () => {
    setAplicando(true);
    try {
      const r = await aplicarPlano(plano.linhas, user);
      setResultado(r);
      onAplicado?.();
    } finally { setAplicando(false); }
  };

  const t = plano?.totais;
  return (
    <div className="fixed inset-0 z-[75] bg-black/50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-lg rounded-t-2xl sm:rounded-2xl p-4 space-y-3 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Preço rápido ({itens.length})</h2>
          <button onClick={onClose} aria-label="Fechar"><X className="w-6 h-6 text-gray-400" /></button>
        </div>
        {!plano ? (
          <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Calculando…</p>
        ) : (
          <>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={markdown} onChange={(e) => setMarkdown(e.target.checked)} className="accent-orange-500" /> Desconto por tempo parado</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={arredondar} onChange={(e) => setArredondar(e.target.checked)} className="accent-orange-500" /> Arredondar (…9)</label>
            </div>
            <p className="text-xs text-gray-600">
              <b>{t.aplicar}</b> a aplicar · <b>{t.aprovacao}</b> pedem aprovação · {t.semMudanca} sem mudança · {t.ignorados} sem recomendação · Δ {fmtBRL(t.deltaTotal)}
            </p>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-lg">
              {plano.linhas.map((l) => (
                <div key={l.sku} className="px-3 py-2 text-xs flex items-center gap-2">
                  <span className="font-mono text-gray-500 w-20 shrink-0">{l.sku}</span>
                  <span className="flex-1 min-w-0 truncate text-gray-800">{l.item.produto}</span>
                  {l.ignorado ? <span className="text-gray-400">{l.ignorado}</span> : (
                    <span className={l.aprovacao ? "text-amber-700" : l.aplicar ? "text-emerald-700 font-semibold" : "text-gray-400"}>
                      {l.atual != null ? fmtBRL(l.atual) : "—"} → {fmtBRL(l.novo)}{l.pctMarkdown && l.novo !== l.atual ? ` (−${l.pctMarkdown}% idade)` : ""}
                    </span>
                  )}
                  {l.aprovacao && <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" title={l.motivos.join("; ")} />}
                </div>
              ))}
            </div>
            {custos && Object.keys(custos).length === 0 && (
              <p className="text-xs text-amber-700">Custos de lote indisponíveis: o piso pode estar menos preciso.</p>
            )}
            {resultado ? (
              <p className="text-sm text-emerald-700 flex items-center gap-1.5"><Check className="w-4 h-4" /> {resultado.ok} preço(s) atualizado(s){resultado.erros.length ? ` · ${resultado.erros.length} erro(s)` : ""}</p>
            ) : (
              <button onClick={aplicar} disabled={aplicando || !t.aplicar}
                className="w-full rounded-xl py-3 font-bold bg-orange-500 text-white flex items-center justify-center gap-2 disabled:bg-gray-300 disabled:text-gray-500">
                {aplicando && <Loader2 className="w-4 h-4 animate-spin" />} Aplicar {t.aplicar} preço(s)
              </button>
            )}
            <p className="text-[11px] text-gray-400">Itens que pedem aprovação (queda &gt; 40 %, A+, piso indefinido) não são alterados aqui.</p>
          </>
        )}
      </div>
    </div>
  );
}
