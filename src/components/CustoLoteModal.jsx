// Cadastro do custo de um lote (base da lucratividade). Grava a composição em `lotes`;
// `custo_composto` é gerado pelo banco a partir de lance + comissão + taxa + fretes + outros.
// `custo_total` também é atualizado porque vw_lote_resultado (lucro realizado) lê dele.
import React, { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { fmtBRL } from "../lib/model";

const CAMPOS = [
  ["lance_final", "Valor do lote / lance", "Quanto foi pago pelo lote (obrigatório)"],
  ["comissao_leiloeiro", "Comissão do leiloeiro", "Vazio = 5% do lance"],
  ["taxa_hisa", "Taxa / despesas de arrematação", "Vazio = 0"],
  ["frete_retirada", "Frete de retirada", "Vazio = ainda sem dado"],
  ["frete_transferencia", "Frete de transferência", "Vazio = ainda sem dado"],
  ["outros_custos", "Outros custos", "Embalagem, impostos, etc."],
];
const toNum = (v) => { const n = parseFloat(String(v).replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
const ini = (v) => (v == null ? "" : String(v).replace(".", ","));

export default function CustoLoteModal({ lote, onClose, onSaved }) {
  const [f, setF] = useState(() => Object.fromEntries(CAMPOS.map(([k]) => [k, ini(lote[k])])));
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState(null);

  const lance = toNum(f.lance_final);
  const comissao = f.comissao_leiloeiro.trim() === "" ? (lance || 0) * 0.05 : toNum(f.comissao_leiloeiro) || 0;
  const total = lance == null ? null
    : lance + comissao + (toNum(f.taxa_hisa) || 0) + (toNum(f.frete_retirada) || 0) + (toNum(f.frete_transferencia) || 0) + (toNum(f.outros_custos) || 0);

  const salvar = async () => {
    if (lance == null || lance <= 0) { setErro("Informe o valor pago pelo lote."); return; }
    setSaving(true); setErro(null);
    const patch = {
      lance_final: lance,
      comissao_leiloeiro: comissao,
      taxa_hisa: toNum(f.taxa_hisa) ?? 0,
      frete_retirada: toNum(f.frete_retirada),         // vazio = null (nunca 0 como "não sei")
      frete_transferencia: toNum(f.frete_transferencia),
      outros_custos: toNum(f.outros_custos),
      valor_pago_hisa: lance + comissao + (toNum(f.taxa_hisa) || 0),
      custo_total: total,
    };
    const { error } = await supabase.from("lotes").update(patch).eq("lote", lote.lote);
    // vw_lote_resultado / vw_precificacao leem o custo de pricing_lote_custo (tabela à parte).
    const { error: e2 } = error ? { error: null } : await supabase.from("pricing_lote_custo").upsert({ lote: lote.lote, custo_total: total }, { onConflict: "lote" });
    setSaving(false);
    if (error || e2) { setErro((error || e2).message); return; }
    onSaved?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="font-bold text-gray-900 flex-1">Custo do lote {lote.lote}{lote.referencia ? ` · ${lote.referencia}` : ""}</h2>
          <button onClick={onClose} aria-label="Fechar"><X className="w-6 h-6 text-gray-400" /></button>
        </div>
        <div className="space-y-3">
          {CAMPOS.map(([k, rot, dica]) => (
            <label key={k} className="block">
              <span className="text-xs font-semibold text-gray-700">{rot}</span>
              <input inputMode="decimal" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder="0,00"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-orange-500" />
              <span className="text-[11px] text-gray-400">{dica}</span>
            </label>
          ))}
        </div>
        <div className="mt-4 bg-gray-50 rounded-xl p-3 flex justify-between text-sm">
          <span className="text-gray-600">Custo total do lote</span>
          <b className="text-gray-900">{total == null ? "—" : fmtBRL(total)}</b>
        </div>
        {erro && <p className="text-xs text-red-600 mt-2">{erro}</p>}
        <button onClick={salvar} disabled={saving}
          className="w-full mt-4 rounded-xl py-3 text-sm font-bold bg-orange-500 text-white disabled:opacity-50 flex items-center justify-center gap-2">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} Salvar custo
        </button>
      </div>
    </div>
  );
}
