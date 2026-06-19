import React, { useMemo, useState } from "react";
import { Tag, TrendingUp, AlertTriangle, Check, Copy } from "lucide-react";
import { fmtBRL } from "../lib/model";
import { precificar, gerarTitulo, estadoToCondicao, normalizarCanal, DEFAULT_PARAMS } from "../lib/pricing";

const CONDICOES = [
  ["NOVO_LACRADO", "Novo lacrado"], ["NOVO_CAIXA_AVARIADA", "Novo caixa avariada"],
  ["USADO_OK", "Usado funcionando"], ["AVARIA_ESTETICA", "Avaria estética"],
  ["SEM_TESTE", "Sem teste"], ["DEFEITO_PECAS", "Defeito / peças"],
];
const CANAIS = [
  ["ML", "Mercado Livre"], ["SHOPEE", "Shopee"], ["TIKTOK", "TikTok Shop"],
  ["MAGALU", "Magalu"], ["AMAZON", "Amazon"], ["B2B", "B2B / lote"], ["LOCAL", "OLX / local"],
];
const sel = "rounded-lg border border-gray-300 px-2 py-2 text-sm bg-white focus:ring-2 focus:ring-orange-500 focus:outline-none";

// custoItem deve vir de vw_precificacao.custo_proporcional (rateio do lote). Sem ele,
// o card calcula tudo menos o piso de custo (mostra aviso).
export default function PricingCard({ item, params = DEFAULT_PARAMS, custoItem = null, onApply }) {
  const grupo = params.grupos?.[item.grupo] || {};
  const [cond, setCond] = useState(estadoToCondicao(item.estado, params.config?.condicaoPadrao));
  const [canal, setCanal] = useState(normalizarCanal(item.canal_principal));
  const [copiado, setCopiado] = useState(false);

  // Busca de preço no Mercado Livre desativada: o ML desativou a pesquisa de preços.
  // A referência cai no valor já persistido no item, senão na âncora do grupo.
  // TODO: reativar a busca de preço ML (Edge Function precos-mercado, preservada em
  // supabase/functions/precos-mercado) quando o ML reabrir a pesquisa de preços.
  const refNovo = item.preco_ref_novo ?? grupo.ancoraNovo ?? item.preco_novo_est ?? 0;
  const refUsado = item.preco_ref_usado ?? grupo.ancoraUsado ?? null;
  const fonteRef = item.preco_ref_fonte ?? null;
  const risco = grupo.nivelRisco || "MEDIO";

  const r = useMemo(() => precificar({
    condicaoCod: cond, canalCod: canal, riscoNivel: risco,
    destino: item.destino, pesoKg: item.peso_real_kg ?? item.peso_kg ?? 0,
    refNovo, refUsado, custoItem: custoItem ?? 0,
  }, params), [cond, canal, risco, item, refNovo, refUsado, custoItem, params]);

  const titulo = gerarTitulo(item, canal);
  const badge = r.viavel
    ? { txt: "Publicar", cls: "bg-emerald-600 text-white", Icon: Check }
    : (canal === "LOCAL" || canal === "B2B")
      ? { txt: "Rever preço/custo", cls: "bg-amber-500 text-white", Icon: AlertTriangle }
      : { txt: "Kit / Lote ou local", cls: "bg-red-500 text-white", Icon: AlertTriangle };

  const aplicar = () => onApply?.({
    preco_min: r.pPiso, preco_ideal: r.pAnuncio, preco_sugerido: r.pAnuncio,
    condicao_anuncio: cond === "NOVO_LACRADO" ? "Novo" : "Usado",
    canal_principal: canal, titulo_anuncio: titulo,
  });

  const copiar = () => { navigator.clipboard?.writeText(titulo); setCopiado(true); setTimeout(() => setCopiado(false), 1500); };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3 space-y-3">
      <div className="flex items-center gap-2 text-gray-800">
        <Tag className="w-4 h-4 text-orange-500" />
        <span className="text-sm font-bold">Precificação</span>
        <span className={`ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${badge.cls}`}>
          <badge.Icon className="w-3 h-3" /> {badge.txt}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase text-gray-500">Condição</span>
          <select className={sel + " w-full mt-1"} value={cond} onChange={(e) => setCond(e.target.value)}>
            {CONDICOES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase text-gray-500">Canal</span>
          <select className={sel + " w-full mt-1"} value={canal} onChange={(e) => setCanal(e.target.value)}>
            {CANAIS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </label>
      </div>

      <div className="rounded-xl border border-gray-200 p-2 space-y-1.5">
        <span className="text-[11px] font-semibold uppercase text-gray-500">Referência de preço</span>
        <div className="flex items-center gap-3 text-xs text-gray-600">
          <span>Novo ref.: <b className="text-gray-800">{fmtBRL(refNovo)}</b></span>
          {refUsado != null && <span>Usado ref.: <b className="text-gray-800">{fmtBRL(refUsado)}</b></span>}
          {fonteRef && <span className="text-gray-400 truncate">({fonteRef})</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-xl bg-orange-50 py-2">
          <p className="text-[11px] font-semibold uppercase text-orange-700">P. anúncio</p>
          <p className="text-lg font-bold text-orange-700">{fmtBRL(r.pAnuncio)}</p>
        </div>
        <div className="rounded-xl bg-gray-50 py-2">
          <p className="text-[11px] font-semibold uppercase text-gray-500">P. mínimo (piso)</p>
          <p className="text-lg font-bold text-gray-700">{fmtBRL(r.pPiso)}</p>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-600 px-1">
        <span className="inline-flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5" /> Lucro {fmtBRL(r.lucroLiquido)}</span>
        <span>Margem {(r.margemLiquida * 100).toFixed(1)}%</span>
        <span>Taxa {(r.takeRate * 100).toFixed(0)}% + {fmtBRL(r.fixo)}</span>
      </div>

      {custoItem == null && (
        <p className="text-[11px] text-amber-600 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" /> Custo do lote não carregado — piso aproximado. Leia custo_proporcional de vw_precificacao.
        </p>
      )}

      <div className="rounded-xl border border-gray-200 p-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase text-gray-500">Título ({canal})</span>
          <button onClick={copiar} className="text-xs text-orange-600 font-semibold inline-flex items-center gap-1">
            {copiado ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copiado ? "Copiado" : "Copiar"}
          </button>
        </div>
        <p className="text-sm text-gray-800 mt-1">{titulo}</p>
      </div>

      <button onClick={aplicar}
        className="w-full rounded-xl bg-orange-500 text-white py-2.5 text-sm font-bold active:bg-orange-600">
        Aplicar preço ao item
      </button>
    </div>
  );
}
