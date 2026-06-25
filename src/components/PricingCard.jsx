import React, { useMemo, useState } from "react";
import { Tag, TrendingUp, AlertTriangle, Check, Copy, Wand2, ChevronDown, Sparkles } from "lucide-react";
import { fmtBRL, DESTINOS, CONDICOES_ANUNCIO, ESTADOS, EMBALAGENS } from "../lib/model";
import { gerarTitulo, normalizarCanal, DEFAULT_PARAMS } from "../lib/pricing";
import { derivarPreco } from "../lib/precoView";
import PriceRuler from "./pricing/PriceRuler";
import { MemoriaPiso, MemoriaTeto } from "./pricing/MemoriaCalculo";
import Ajuda from "./pricing/Ajuda";

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

  // Inviável = o piso (preço mínimo p/ a margem) está acima do que o mercado paga.
  const inviavel = !d.economia.viavel;
  const canalLabel = (CANAIS.find(([v]) => v === canal) || [null, canal])[1];
  const destinoTxt = item.destino || "destino atual";
  const margemPct = Math.round((d.economia.margemMin ?? 0) * 100);

  // Indicadores AO VIVO no preço efetivo (o que o operador digitou, senão o recomendado).
  const eco = d.economia;
  const precoVenda = Number(item.preco_ideal) > 0 ? Number(item.preco_ideal) : d.recomendado;
  const lucroVenda = d.lucroEm(precoVenda);
  const margemVenda = d.margemEm(precoVenda);
  const abaixoPiso = d.piso > 0 && precoVenda > 0 && precoVenda < d.piso;
  const comissaoVenda = precoVenda * eco.taxa;
  const reservaVenda = precoVenda * eco.reserva;
  const plataformaVenda = comissaoVenda + eco.fixo;

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

      {/* Destino — afeta a margem mínima e, portanto, o piso */}
      <div>
        <span className="text-[11px] font-semibold uppercase text-gray-500 flex items-center gap-1">
          Destino logístico <Ajuda termo="margem" />
        </span>
        <div className="mt-1">
          <Chips options={DESTINOS} value={item.destino || null}
            onChange={(v) => onChange?.({ destino: v })} activeCls="bg-orange-500 text-white border-orange-500" />
        </div>
      </div>

      {/* Bloco central: seu preço + régua + veredito ao vivo */}
      <div className="rounded-2xl border border-gray-200 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase text-gray-500">Seu preço de venda</span>
          {d.recomendado > 0 && (
            <button type="button" onClick={usarSugerido}
              className="text-xs font-semibold text-orange-600 inline-flex items-center gap-1 active:opacity-70">
              <Sparkles className="w-3.5 h-3.5" /> Usar recomendado ({fmtBRL(d.recomendado)})
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-gray-400">R$</span>
          <input type="number" inputMode="decimal"
            className={`w-full rounded-xl border px-3 py-2.5 text-2xl font-bold bg-white focus:outline-none focus:ring-2 ${abaixoPiso ? "border-red-400 text-red-700 focus:ring-red-400" : "border-gray-300 text-gray-900 focus:ring-orange-500"}`}
            value={item.preco_ideal ?? ""} onChange={(e) => setVenda(e.target.value)}
            placeholder={d.recomendado ? String(d.recomendado) : "0"} />
        </div>

        <PriceRuler piso={d.piso} recomendado={d.recomendado} preco={precoVenda} fmtBRL={fmtBRL} />

        {/* Veredito ao vivo: inviável > abaixo do piso > lucro saudável */}
        {inviavel ? (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800">
            <p className="font-bold flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Inviável em {canalLabel} · {destinoTxt}</p>
            <p className="mt-0.5">O mercado paga ~{fmtBRL(d.recomendado)}, mas o piso p/ {margemPct}% de margem é {fmtBRL(d.piso)}. {eco.sugestao}.</p>
          </div>
        ) : abaixoPiso ? (
          <div className="rounded-xl bg-red-50 border border-red-200 p-2.5 text-xs text-red-700">
            <p className="font-bold flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Abaixo do piso — risco de prejuízo</p>
            <p className="mt-0.5">A {fmtBRL(precoVenda)} você fica {fmtBRL(d.piso - precoVenda)} abaixo do mínimo. Suba para ≥ {fmtBRL(d.piso)} ou venda em kit/lote/canal local.</p>
          </div>
        ) : (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-2.5 text-xs text-emerald-800">
            <p className="font-bold flex items-center gap-1"><TrendingUp className="w-4 h-4" /> Vendendo a {fmtBRL(precoVenda)} em {canalLabel} · {destinoTxt}</p>
            <p className="mt-0.5">Lucro {fmtBRL(lucroVenda)} · margem {Math.round((margemVenda ?? 0) * 100)}%. Faixa segura: {fmtBRL(d.piso)} a {fmtBRL(d.recomendado)}.</p>
          </div>
        )}

        {d.flags.filter((f) => f.tipo !== "erro").map((f, i) => (
          <p key={i} className="text-xs inline-flex items-center gap-1 text-amber-600">
            <AlertTriangle className="w-3 h-3" /> {f.msg}
          </p>
        ))}
        {custoItem == null && (
          <p className="text-[11px] text-amber-600 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> Custo do lote não carregado — piso aproximado.
          </p>
        )}
      </div>

      {/* Memórias de cálculo: como chegamos no piso e no recomendado, com valores */}
      <div className="space-y-2">
        <MemoriaPiso memoria={d.memoria} fmtBRL={fmtBRL} />
        <MemoriaTeto memoria={d.memoria} fmtBRL={fmtBRL} />

        {/* Para onde vai o preço — taxas da plataforma em R$, no preço digitado */}
        <details className="rounded-xl border border-gray-100">
          <summary className="flex items-center justify-between cursor-pointer list-none px-2.5 py-2 text-[11px] font-semibold uppercase text-gray-500">
            <span className="flex items-center gap-1">Para onde vai o preço <Ajuda termo="comissao" /></span>
            <span className="normal-case font-bold text-gray-700">{canalLabel} leva {fmtBRL(plataformaVenda)}</span>
          </summary>
          <div className="px-2.5 pb-2.5 space-y-1">
            <div className="flex items-center justify-between text-xs border-b border-gray-100 pb-1">
              <span className="text-gray-700 font-semibold">Receita</span>
              <span className="text-gray-800 font-semibold">{fmtBRL(precoVenda)}</span>
            </div>
            {[
              [`Comissão ${canalLabel} (${Math.round(eco.taxa * 100)}%)`, comissaoVenda],
              ["Tarifa fixa", eco.fixo],
              [`Reserva (${Math.round(eco.reserva * 100)}%)`, reservaVenda],
              ["Frete", eco.frete],
              ["Embalagem", eco.custoEmbalagem],
              ["Custo do item", eco.custo],
            ].map(([lbl, val], i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-gray-500">{lbl}</span>
                <span className="text-red-600">− {fmtBRL(val)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between text-xs border-t border-gray-100 pt-1">
              <span className="font-semibold text-gray-700">Lucro</span>
              <span className={`font-bold ${(lucroVenda ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>{fmtBRL(lucroVenda)}</span>
            </div>
          </div>
        </details>
      </div>

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
