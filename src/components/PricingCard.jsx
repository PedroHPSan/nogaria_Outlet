import React, { useMemo, useState } from "react";
import { Tag, TrendingUp, AlertTriangle, Check, Copy, Wand2, ChevronDown, Sparkles } from "lucide-react";
import { fmtBRL, DESTINOS, CONDICOES_ANUNCIO, ESTADOS, EMBALAGENS } from "../lib/model";
import { gerarTitulo, normalizarCanal, DEFAULT_PARAMS } from "../lib/pricing";
import { derivarPreco } from "../lib/precoView";

const CANAIS = [
  ["ML", "Mercado Livre"], ["SHOPEE", "Shopee"], ["TIKTOK", "TikTok Shop"],
  ["MAGALU", "Magalu"], ["AMAZON", "Amazon"], ["B2B", "B2B / lote"], ["LOCAL", "OLX / local"],
];

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
  const [canal, setCanal] = useState(normalizarCanal(item.canal_principal));
  const [copiado, setCopiado] = useState(false);
  const [detalhes, setDetalhes] = useState(false);

  // Fonte ÚNICA da UI: derivarPreco consome precificar() (sem recalcular). O canal
  // selecionado entra por override para a recomendação reagir na hora.
  const d = useMemo(() => {
    const grupo = params.grupos?.[item.grupo] || {};
    return derivarPreco({ ...item, canal_principal: canal }, grupo, params, custoItem);
  }, [item, canal, params, custoItem]);

  const tituloSugerido = gerarTitulo(item, canal);
  const titulo = item.titulo_anuncio || tituloSugerido;

  const setVenda = (v) => onChange?.({ preco_ideal: v });
  const usarSugerido = () => onChange?.({ preco_ideal: d.recomendado });
  const copiar = () => { navigator.clipboard?.writeText(titulo); setCopiado(true); setTimeout(() => setCopiado(false), 1500); };

  const manualAbaixoPiso = d.flags.some((f) => f.tipo === "erro");
  // Inviável = o piso (preço mínimo p/ a margem) está acima do que o mercado paga.
  const inviavel = !d.economia.viavel;
  const canalLabel = (CANAIS.find(([v]) => v === canal) || [null, canal])[1];
  const destinoTxt = item.destino || "destino atual";
  const margemPct = Math.round((d.economia.margemMin ?? 0) * 100);
  const badge = d.economia.viavel
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
        <Campo label="Embalagem">
          <select className={sel + " w-full"} value={item.cond_embalagem || "PERFEITA"}
            onChange={(e) => onChange?.({ cond_embalagem: e.target.value })}>
            {EMBALAGENS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </Campo>
        <Campo label="Canal">
          <select className={sel + " w-full"} value={canal} onChange={(e) => { setCanal(e.target.value); onChange?.({ canal_principal: e.target.value }); }}>
            {CANAIS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </Campo>
      </div>

      {/* ZONA 1 — Recomendação OU veredito de inviabilidade (piso acima do mercado) */}
      {!inviavel ? (
        <div className="rounded-2xl bg-orange-50 border border-orange-100 p-3 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-700">Preço recomendado</p>
          <p className="text-3xl font-extrabold text-orange-700 leading-tight">{fmtBRL(d.recomendado)}</p>
          <p className="text-xs text-gray-500 mt-0.5">{d.economia.sugestao}</p>
          <button type="button" onClick={usarSugerido}
            className="mt-2 w-full inline-flex items-center justify-center gap-1.5 bg-orange-500 text-white rounded-xl py-2 text-sm font-bold active:bg-orange-600">
            <Sparkles className="w-4 h-4" /> Usar esta sugestão
          </button>
        </div>
      ) : (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 inline-flex items-center justify-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> Inviável em {canalLabel} · {destinoTxt}
          </p>
          <p className="text-3xl font-extrabold text-amber-700 leading-tight">{fmtBRL(d.recomendado)}</p>
          <p className="text-[11px] uppercase tracking-wide text-amber-700/80">preço que o mercado paga</p>
          <p className="text-xs text-gray-600 mt-1">
            Piso p/ {margemPct}% de margem: <b className="text-gray-800">{fmtBRL(d.piso)}</b> — acima do mercado.
          </p>
          <p className="text-xs font-semibold text-amber-800 mt-0.5">{d.economia.sugestao}</p>
        </div>
      )}

      {/* ZONA 2 — Por quê (derivação dos fatores até o recomendado) */}
      <div className="rounded-xl border border-gray-100 p-2.5 space-y-1">
        <p className="text-[11px] font-semibold uppercase text-gray-500">Por que esse preço</p>
        {d.derivacao.map((p, i) => (
          <div key={i} className="flex items-center justify-between text-xs gap-2">
            <span className="text-gray-600 truncate">
              {p.passo}{p.detalhe && p.detalhe !== "—" ? <span className="text-gray-400"> · {p.detalhe}</span> : null}
            </span>
            <span className="text-gray-800 flex-shrink-0">
              {p.fator != null && <span className="text-gray-400">× {p.fator} = </span>}
              <b>{fmtBRL(p.valor)}</b>
            </span>
          </div>
        ))}
      </div>

      {/* ZONA 3 — Seu preço & piso (override + guarda-corpo) */}
      <div>
        <span className="text-[11px] font-semibold uppercase text-gray-500">Seu preço de venda (R$)</span>
        <input type="number" inputMode="decimal"
          className={`w-full rounded-xl border px-3 py-2.5 text-2xl font-bold bg-white focus:outline-none focus:ring-2 mt-1 ${manualAbaixoPiso ? "border-red-400 text-red-700 focus:ring-red-400" : "border-gray-300 text-gray-900 focus:ring-orange-500"}`}
          value={item.preco_ideal ?? ""} onChange={(e) => setVenda(e.target.value)}
          placeholder={d.recomendado ? String(d.recomendado) : "0"} />
        {d.flags.map((f, i) => (
          <p key={i} className={`text-xs mt-1 inline-flex items-center gap-1 ${f.tipo === "erro" ? "text-red-600" : "text-amber-600"}`}>
            <AlertTriangle className="w-3 h-3" /> {f.msg}
          </p>
        ))}
        <div className="flex items-center justify-between text-xs text-gray-600 mt-2 px-0.5">
          <span>Mínimo (piso): <b className="text-gray-800">{fmtBRL(d.piso)}</b></span>
          <span className="inline-flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5" /> Lucro {fmtBRL(d.economia.lucro)} · Margem {(d.economia.margem * 100).toFixed(0)}%</span>
        </div>

        {/* Para onde vai o preço — a comissão da plataforma (Amazon/ML/etc.) visível em R$ */}
        <details className="mt-2 rounded-xl border border-gray-100">
          <summary className="flex items-center justify-between cursor-pointer list-none px-2.5 py-2 text-[11px] font-semibold uppercase text-gray-500">
            <span>Para onde vai o preço</span>
            <span className="normal-case font-bold text-gray-700">{canalLabel} leva {fmtBRL(d.economia.custoPlataforma)}</span>
          </summary>
          <div className="px-2.5 pb-2.5 space-y-1">
            <div className="flex items-center justify-between text-xs border-b border-gray-100 pb-1">
              <span className="text-gray-700 font-semibold">Receita (preço recomendado)</span>
              <span className="text-gray-800 font-semibold">{fmtBRL(d.economia.receita)}</span>
            </div>
            {[
              [`Comissão ${canalLabel} (${(d.economia.taxa * 100).toFixed(0)}%)`, d.economia.custoTaxa],
              ["Tarifa fixa", d.economia.fixo],
              [`Reserva (${(d.economia.reserva * 100).toFixed(0)}%)`, d.economia.custoReserva],
              ["Frete", d.economia.frete],
              ["Embalagem", d.economia.custoEmbalagem],
              ["Custo do item", d.economia.custo],
            ].map(([lbl, val], i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-gray-500">{lbl}</span>
                <span className="text-red-600">− {fmtBRL(val)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between text-xs border-t border-gray-100 pt-1">
              <span className="font-semibold text-gray-700">Lucro</span>
              <span className={`font-bold ${d.economia.lucro >= 0 ? "text-emerald-600" : "text-red-600"}`}>{fmtBRL(d.economia.lucro)}</span>
            </div>
          </div>
        </details>
        {custoItem == null && (
          <p className="text-[11px] text-amber-600 flex items-center gap-1 mt-1">
            <AlertTriangle className="w-3 h-3" /> Custo do lote não carregado — piso aproximado.
          </p>
        )}
      </div>

      {/* Destino — afeta margem mínima / piso */}
      <Campo label="Destino logístico">
        <Chips options={DESTINOS} value={item.destino || null}
          onChange={(v) => onChange?.({ destino: v })} activeCls="bg-orange-500 text-white border-orange-500" />
      </Campo>

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

        {/* Conteúdo de listagem gerado pela IA (bullets/keywords/ficha) — usado no flat file Amazon. */}
        {((Array.isArray(item.bullet_points) && item.bullet_points.length > 0) ||
          item.palavras_chave ||
          (Array.isArray(item.ficha_tecnica) && item.ficha_tecnica.length > 0)) && (
          <div className="rounded-xl border border-gray-200 p-2.5 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-gray-500">
              <Sparkles className="w-3.5 h-3.5 text-orange-500" /> Conteúdo do anúncio (IA)
            </div>
            {Array.isArray(item.bullet_points) && item.bullet_points.length > 0 && (
              <ul className="list-disc list-inside space-y-0.5 text-sm text-gray-700">
                {item.bullet_points.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            )}
            {item.palavras_chave && (
              <p className="text-xs text-gray-500"><span className="font-semibold">Palavras-chave:</span> {item.palavras_chave}</p>
            )}
            {Array.isArray(item.ficha_tecnica) && item.ficha_tecnica.length > 0 && (
              <div className="grid grid-cols-2 gap-x-3 text-xs">
                {item.ficha_tecnica.map((f, i) => (
                  <div key={i} className="flex justify-between gap-2 border-b border-gray-100 py-0.5">
                    <span className="text-gray-500 truncate">{f.atributo}</span>
                    <span className="text-gray-800 font-medium text-right">{f.valor}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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
          {/* Valor vendido + detalhe da venda ficam no card "Venda" do ItemDetail. */}
          <TriToggle label="Anúncio publicado?" value={item.anuncio_feito ? true : null}
            onChange={(v) => onChange?.({ anuncio_feito: v === true })} />
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
