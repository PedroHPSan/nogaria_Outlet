import React, { useMemo, useState } from "react";
import { Tag, TrendingUp, AlertTriangle, Check, Copy, Wand2, ChevronDown, Sparkles } from "lucide-react";
import { fmtBRL, DESTINOS, CONDICOES_ANUNCIO, ESTADOS } from "../lib/model";
import { precificar, gerarTitulo, estadoToCondicao, normalizarCanal, DEFAULT_PARAMS } from "../lib/pricing";

const CANAIS = [
  ["ML", "Mercado Livre"], ["SHOPEE", "Shopee"], ["TIKTOK", "TikTok Shop"],
  ["MAGALU", "Magalu"], ["AMAZON", "Amazon"], ["B2B", "B2B / lote"], ["LOCAL", "OLX / local"],
];
// Piso de fallback (só quando o motor não tem custo do lote p/ calcular o piso real).
const PISO_PCT = 0.70;

const sel = "rounded-lg border border-gray-300 px-2 py-2 text-sm bg-white focus:ring-2 focus:ring-orange-500 focus:outline-none";
const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base bg-white focus:outline-none focus:ring-2 focus:ring-orange-500";

function Campo({ label, children }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase text-gray-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Chips({ options, value, onChange, activeCls = "bg-gray-900 text-white border-gray-900" }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onChange(value === o ? null : o)}
          className={`px-3 py-1.5 rounded-lg text-sm border ${value === o ? activeCls : "bg-white text-gray-600 border-gray-300"}`}>
          {o}
        </button>
      ))}
    </div>
  );
}

function TriToggle({ label, value, onChange }) {
  const opts = [
    { v: true, t: "Sim", on: "bg-emerald-600 text-white" },
    { v: false, t: "Não", on: "bg-red-500 text-white" },
  ];
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-gray-800">{label}</span>
      <div className="flex gap-1">
        {opts.map((o) => (
          <button key={o.t} type="button" onClick={() => onChange(value === o.v ? null : o.v)}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold border ${value === o.v ? o.on + " border-transparent" : "bg-white text-gray-500 border-gray-300"}`}>
            {o.t}
          </button>
        ))}
      </div>
    </div>
  );
}

function Secao({ titulo, aberto, onToggle, children }) {
  return (
    <div className="border-t border-gray-100 pt-2">
      <button type="button" onClick={onToggle}
        className="w-full flex items-center justify-between text-xs font-semibold uppercase text-gray-500">
        {titulo}
        <ChevronDown className={`w-4 h-4 transition-transform ${aberto ? "rotate-180" : ""}`} />
      </button>
      {aberto && <div className="mt-2 space-y-2">{children}</div>}
    </div>
  );
}

// Card de Precificação & venda — caminho principal curto: condição/canal → um preço
// de venda (com presets) → mínimo derivado automaticamente. Detalhamento e campos
// secundários ficam em seções recolhíveis. onChange(patch) grava no item (set do
// ItemDetail); salvar() persiste. Motor de preço (pricing.js) inalterado.
//
// Obs.: a busca de preço no Mercado Livre está aposentada; a referência usa o valor
// salvo no item ou a âncora do grupo.
export default function PricingCard({ item, params = DEFAULT_PARAMS, custoItem = null, onChange }) {
  const grupo = params.grupos?.[item.grupo] || {};
  // Condição do motor é derivada do Estado do item (fonte única). Editar o Estado aqui
  // grava em item.estado via onChange, mantendo-o atrelado às chips de Estado da ficha.
  const cond = estadoToCondicao(item.estado, params.config?.condicaoPadrao);
  const [canal, setCanal] = useState(normalizarCanal(item.canal_principal));
  const [copiado, setCopiado] = useState(false);
  const [minManual, setMinManual] = useState(false);
  const [verCalculo, setVerCalculo] = useState(false);
  const [detalhes, setDetalhes] = useState(false);

  const refNovo = item.preco_ref_novo ?? grupo.ancoraNovo ?? item.preco_novo_est ?? 0;
  const refUsado = item.preco_ref_usado ?? grupo.ancoraUsado ?? null;
  const fonteRef = item.preco_ref_fonte ?? null;
  const risco = grupo.nivelRisco || "MEDIO";

  const r = useMemo(() => precificar({
    condicaoCod: cond, canalCod: canal, riscoNivel: risco,
    destino: item.destino, pesoKg: item.peso_real_kg ?? item.peso_kg ?? 0,
    refNovo, refUsado, custoItem: custoItem ?? 0,
  }, params), [cond, canal, risco, item.destino, item.peso_real_kg, item.peso_kg, refNovo, refUsado, custoItem, params]);

  const tituloSugerido = gerarTitulo(item, canal);
  const titulo = item.titulo_anuncio || tituloSugerido;

  // Mínimo derivado: piso real do motor; sem custo do lote, cai em % do preço de venda.
  const calcMin = (vendaVal) => {
    if (r.pPiso > 0) return r.pPiso;
    const base = Number(vendaVal) || r.pAnuncio || 0;
    return base > 0 ? Math.round(base * PISO_PCT) : null;
  };
  const precoMinEff = item.preco_min ?? calcMin(item.preco_ideal);

  const setVenda = (v) => onChange?.({ preco_ideal: v, ...(minManual ? {} : { preco_min: calcMin(v) }) });
  const usarSugerido = () => onChange?.({
    preco_ideal: r.pAnuncio, preco_sugerido: r.pAnuncio,
    ...(minManual ? {} : { preco_min: calcMin(r.pAnuncio) }),
  });
  const toggleMin = () => setMinManual((m) => {
    const next = !m;
    if (!next) onChange?.({ preco_min: calcMin(item.preco_ideal) }); // voltou ao automático
    return next;
  });
  const copiar = () => { navigator.clipboard?.writeText(titulo); setCopiado(true); setTimeout(() => setCopiado(false), 1500); };

  const presets = [
    { key: "novo", label: "Novo", v: refNovo, action: () => setVenda(refNovo) },
    { key: "usado", label: "Usado", v: refUsado, action: () => setVenda(refUsado) },
  ].filter((p) => p.v && p.v > 0);

  const badge = r.viavel
    ? { txt: "Publicar", cls: "bg-emerald-600 text-white", Icon: Check }
    : (canal === "LOCAL" || canal === "B2B")
      ? { txt: "Rever preço/custo", cls: "bg-amber-500 text-white", Icon: AlertTriangle }
      : { txt: "Kit / Lote ou local", cls: "bg-red-500 text-white", Icon: AlertTriangle };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-3 space-y-3 shadow-sm">
      <div className="flex items-center gap-2 text-gray-800">
        <Tag className="w-4 h-4 text-orange-500" />
        <span className="text-sm font-bold">Precificação &amp; venda</span>
        <span className={`ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${badge.cls}`}>
          <badge.Icon className="w-3 h-3" /> {badge.txt}
        </span>
      </div>

      {/* Entradas do motor */}
      <div className="grid grid-cols-2 gap-2">
        <Campo label="Estado">
          <select className={sel + " w-full"} value={item.estado || ""}
            onChange={(e) => onChange?.({ estado: e.target.value || null })}>
            {!item.estado && <option value="">Selecione…</option>}
            {ESTADOS.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </Campo>
        <Campo label="Canal">
          <select className={sel + " w-full"} value={canal} onChange={(e) => { setCanal(e.target.value); onChange?.({ canal_principal: e.target.value }); }}>
            {CANAIS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </Campo>
      </div>

      {/* Preço de venda — campo principal */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-semibold uppercase text-gray-500">Preço de venda (R$)</span>
          <button type="button" onClick={usarSugerido}
            className="text-xs font-semibold text-orange-600 inline-flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5" /> Usar sugerido {r.pAnuncio ? fmtBRL(r.pAnuncio) : ""}
          </button>
        </div>
        <input type="number" inputMode="decimal"
          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-2xl font-bold text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
          value={item.preco_ideal ?? ""} onChange={(e) => setVenda(e.target.value)}
          placeholder={r.pAnuncio ? String(r.pAnuncio) : "0"} />
        {presets.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {presets.map((p) => (
              <button key={p.key} type="button" onClick={p.action}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-gray-300 text-gray-600 bg-white active:bg-gray-100">
                {p.label} {fmtBRL(p.v)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Mínimo automático (com ajuste manual) */}
      <div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500">
            Mínimo: <b className="text-gray-700">{fmtBRL(precoMinEff)}</b>{" "}
            <span className="text-gray-400">{minManual ? "(manual)" : "(automático)"}</span>
          </span>
          <button type="button" onClick={toggleMin} className="text-orange-600 font-semibold">
            {minManual ? "voltar ao automático" : "ajustar"}
          </button>
        </div>
        {minManual && (
          <input type="number" inputMode="decimal" className={inputCls + " mt-1"} value={item.preco_min ?? ""}
            onChange={(e) => onChange?.({ preco_min: e.target.value })}
            placeholder={calcMin(item.preco_ideal) ? `sug. ${calcMin(item.preco_ideal)}` : ""} />
        )}
      </div>

      {/* Status compacto */}
      <div className="flex items-center justify-between text-xs text-gray-600 px-0.5">
        <span className="inline-flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5" /> Lucro {fmtBRL(r.lucroLiquido)}</span>
        <span>Margem {(r.margemLiquida * 100).toFixed(0)}%</span>
      </div>

      {/* Destino — afeta margem mínima / piso */}
      <Campo label="Destino logístico">
        <Chips options={DESTINOS} value={item.destino || null}
          onChange={(v) => onChange?.({ destino: v })} activeCls="bg-orange-500 text-white border-orange-500" />
      </Campo>

      {/* Ver cálculo (detalhe do motor) */}
      <Secao titulo="Ver cálculo" aberto={verCalculo} onToggle={() => setVerCalculo((o) => !o)}>
        <div className="flex items-center gap-3 text-xs text-gray-600">
          <span className="text-[11px] font-semibold uppercase text-gray-500">Ref.</span>
          <span>Novo <b className="text-gray-800">{fmtBRL(refNovo)}</b></span>
          {refUsado != null && <span>Usado <b className="text-gray-800">{fmtBRL(refUsado)}</b></span>}
          {fonteRef && <span className="text-gray-400 truncate">({fonteRef})</span>}
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
          <span>Frete {fmtBRL(r.frete)}</span>
          <span>Taxa {(r.takeRate * 100).toFixed(0)}% + {fmtBRL(r.fixo)}</span>
        </div>
        {custoItem == null && (
          <p className="text-[11px] text-amber-600 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> Custo do lote não carregado — piso aproximado.
          </p>
        )}
      </Secao>

      {/* Detalhes do anúncio e envio (secundário) */}
      <Secao titulo="Detalhes do anúncio e envio" aberto={detalhes} onToggle={() => setDetalhes((o) => !o)}>
        <Campo label={`Título (${canal})`}>
          <div className="flex gap-2">
            <input className={inputCls} value={item.titulo_anuncio ?? ""}
              onChange={(e) => onChange?.({ titulo_anuncio: e.target.value })}
              placeholder={tituloSugerido} />
            <button type="button" onClick={() => onChange?.({ titulo_anuncio: tituloSugerido })}
              className="px-3 rounded-lg border border-gray-300 text-gray-500 flex items-center flex-shrink-0" title="Gerar título sugerido">
              <Wand2 className="w-4 h-4" />
            </button>
            <button type="button" onClick={copiar}
              className="px-3 rounded-lg border border-gray-300 text-gray-500 flex items-center flex-shrink-0" title="Copiar título">
              {copiado ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </Campo>
        <Campo label="Condição do anúncio">
          <Chips options={CONDICOES_ANUNCIO} value={item.condicao_anuncio || null}
            onChange={(v) => onChange?.({ condicao_anuncio: v })}
            activeCls="bg-emerald-600 text-white border-emerald-600" />
        </Campo>
        <Campo label="Descrição do anúncio">
          <textarea className={inputCls} rows={2} value={item.descricao_anuncio ?? ""}
            onChange={(e) => onChange?.({ descricao_anuncio: e.target.value })} />
        </Campo>
        <div className="grid grid-cols-2 gap-2">
          <Campo label="Local físico">
            <input className={inputCls} value={item.local_fisico ?? ""}
              onChange={(e) => onChange?.({ local_fisico: e.target.value })} placeholder="ex.: estante 2" />
          </Campo>
          <Campo label="Caixa">
            <div className={`${inputCls} bg-gray-50 flex items-center min-h-[44px]`}>
              {item.caixa_id
                ? <span className="font-mono font-semibold text-gray-800">{item.caixa_id}</span>
                : <span className="text-sm text-gray-400">em Conferir → Encaixotar</span>}
            </div>
          </Campo>
        </div>
        <div className="rounded-xl border border-gray-200 p-2 space-y-1">
          <TriToggle label="Anúncio publicado?" value={item.anuncio_feito ? true : null}
            onChange={(v) => onChange?.({ anuncio_feito: v === true })} />
          <Campo label="Valor vendido (R$)">
            <input type="number" inputMode="decimal" className={inputCls} value={item.valor_vendido ?? ""}
              onChange={(e) => onChange?.({ valor_vendido: e.target.value })} />
          </Campo>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Campo label="Nº de série / IMEI">
            <input className={`${inputCls} font-mono`} value={item.num_serie ?? ""}
              onChange={(e) => onChange?.({ num_serie: e.target.value })} placeholder="alto valor" />
          </Campo>
          <Campo label="NCM (fiscal)">
            <input className={`${inputCls} font-mono`} inputMode="numeric" value={item.ncm ?? ""}
              onChange={(e) => onChange?.({ ncm: e.target.value })} placeholder="8 dígitos" />
          </Campo>
        </div>
      </Secao>
    </div>
  );
}
