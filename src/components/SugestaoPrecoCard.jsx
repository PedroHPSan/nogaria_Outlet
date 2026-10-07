// Sugestão de preço do motor v2 na triagem: mostra o preço estimado, o porquê (mercado → custo do
// lote → taxas → lucro) e deixa o operador VALIDAR com um toque. Nada é gravado sem a validação,
// e o preço nunca é gravado abaixo do piso.
import React, { useEffect, useState } from "react";
import { Sparkles, Loader2, Check, AlertTriangle, ChevronDown } from "lucide-react";
import { analisarItens, validarPreco } from "../lib/motorPrecoDb";
import { fmtBRL } from "../lib/model";

export const STATUS_V2 = {
  ANUNCIAR: { txt: "Pode anunciar", cls: "bg-emerald-600 text-white" },
  GIRO: { txt: "Margem abaixo de 25%", cls: "bg-amber-500 text-white" },
  LOCAL: { txt: "Só fecha em venda local", cls: "bg-amber-500 text-white" },
  KIT: { txt: "Agrupar em kit", cls: "bg-blue-600 text-white" },
  SEM_REF: { txt: "Sem referência", cls: "bg-gray-500 text-white" },
  INVIAVEL: { txt: "Abaixo do piso", cls: "bg-red-500 text-white" },
};

export default function SugestaoPrecoCard({ item, params, user, onValidado }) {
  const [r, setR] = useState(null);
  const [erro, setErro] = useState(null);
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null);

  const chave = [item.sku, item.lote, item.estado, item.cond_embalagem, item.canal_principal, item.grupo,
    item.preco_ref_novo, item.preco_ref_usado, item.peso_kg, item.peso_real_kg].join("|");
  useEffect(() => {
    let cancel = false;
    setErro(null);
    analisarItens([item], params).then((m) => { if (!cancel) setR(m.get(item.sku) || null); })
      .catch((e) => { if (!cancel) setErro(e.message || "Falha ao calcular"); });
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  if (erro) return null; // sugestão é auxiliar: falhar em silêncio não pode travar a triagem
  if (!r) return (
    <div className="bg-white rounded-2xl border border-gray-200 p-3 mb-4 text-sm text-gray-500 flex items-center gap-2">
      <Loader2 className="w-4 h-4 animate-spin" /> Calculando sugestão de preço…
    </div>
  );

  const st = STATUS_V2[r.status] || STATUS_V2.SEM_REF;
  const pode = r.sugerido > 0 && (r.status === "ANUNCIAR" || r.status === "GIRO" || r.status === "LOCAL");
  const jaValidado = item.preco_aprovacao === "APROVADO" && Number(item.preco_ideal) === r.sugerido;

  const validar = async () => {
    setSalvando(true); setMsg(null);
    const v = await validarPreco({ sku: item.sku, preco: r.sugerido, piso: r.piso, user,
      motivo: `motor-v2 ${r.status} margem ${(r.margem * 100).toFixed(1)}%` });
    setSalvando(false);
    if (!v.ok) { setMsg({ erro: true, txt: v.erro }); return; }
    setMsg({ erro: false, txt: "Preço validado e salvo." });
    onValidado?.({ preco_ideal: r.sugerido, preco_aprovacao: "APROVADO" });
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-3 mb-4 shadow-sm space-y-2">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-orange-500" />
        <span className="text-sm font-bold text-gray-800">Preço sugerido (motor novo)</span>
        <span className={`ml-auto px-2 py-0.5 rounded-full text-xs font-semibold ${st.cls}`}>{st.txt}</span>
      </div>
      {r.sugerido != null ? (
        <p className="text-2xl font-bold text-gray-900">
          {fmtBRL(r.sugerido)}
          <span className="text-xs font-normal text-gray-500 ml-2">
            lucro {fmtBRL(r.lucro)} · margem {(r.margem * 100).toFixed(1).replace(".", ",")}%
            {r.canal === "LOCAL" ? " · venda local" : ""}
          </span>
        </p>
      ) : <p className="text-sm text-gray-600">{r.motivo}</p>}
      <p className="text-xs text-gray-500">
        Piso {fmtBRL(r.piso)} · Mínimo p/ 25% de margem {fmtBRL(r.minimo)}
        {item.preco_ideal > 0 ? ` · Preço atual ${fmtBRL(item.preco_ideal)}` : ""}
      </p>
      {r.semCusto && <p className="text-xs text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Lote sem custo cadastrado: piso sem custo de aquisição.</p>}
      {r.custoOrigem && /estimad/.test(r.custoOrigem) && <p className="text-[11px] text-gray-400">Custo do lote: {r.custoOrigem}.</p>}
      <button onClick={() => setAberto((a) => !a)} className="text-xs text-blue-700 flex items-center gap-1">
        <ChevronDown className={`w-3 h-3 transition ${aberto ? "rotate-180" : ""}`} /> De onde chegamos a esse preço
      </button>
      {aberto && <ul className="text-xs text-gray-700 space-y-1 list-disc pl-4">{r.explicacao.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      {pode && (
        <button onClick={validar} disabled={salvando || jaValidado}
          className="w-full rounded-xl py-2.5 font-bold bg-orange-500 text-white flex items-center justify-center gap-2 disabled:bg-gray-300 disabled:text-gray-500">
          {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {jaValidado ? "Preço já validado" : `Validar ${fmtBRL(r.sugerido)}`}
        </button>
      )}
      {msg && <p className={`text-xs ${msg.erro ? "text-red-600" : "text-emerald-700"}`}>{msg.txt}</p>}
    </div>
  );
}
