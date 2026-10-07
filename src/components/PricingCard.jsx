import React, { useEffect, useState } from "react";
import { Tag, TrendingUp, AlertTriangle, Check, Copy, Wand2, ChevronDown, Sparkles, Loader2 } from "lucide-react";
import { fmtBRL, DESTINOS, CONDICOES_ANUNCIO, ESTADOS, EMBALAGENS } from "../lib/model";
import { gerarTitulo, normalizarCanal, DEFAULT_PARAMS } from "../lib/pricing";
import { analisarItens, validarPreco } from "../lib/motorPrecoDb";
import { lucroEm, canalV2, REGRAS } from "../lib/motorPreco";
import PriceRuler from "./pricing/PriceRuler";
import MemoriaCalculoV2 from "./pricing/MemoriaCalculoV2";
import { STATUS_V2 } from "./pricing/statusV2";
import { aoTrocarCategoria } from "../lib/categoriaTroca";
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
// ItemDetail); salvar() persiste. O preço vem do MOTOR NOVO (motorPreco: custo real do lote
// rateado + taxas + margem mínima 25%); o preço de mercado parte de pricing.js (condição × embalagem × risco).
//
// Obs.: a busca de preço no Mercado Livre está aposentada; a referência usa o valor
// salvo no item ou a âncora do grupo.
export default function PricingCard({ item, params = DEFAULT_PARAMS, user, onChange }) {
  const [canal, setCanal] = useState(normalizarCanal(item.canal_principal));
  const [copiado, setCopiado] = useState(false);
  const [detalhes, setDetalhes] = useState(false);
  const [r, setR] = useState(null);
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null);

  // Motor novo: recalcula quando muda qualquer entrada que afeta custo/preço.
  const chave = [item.sku, item.lote, item.estado, item.cond_embalagem, canal, item.grupo,
    item.preco_ref_novo, item.preco_ref_usado, item.peso_kg, item.peso_real_kg].join("|");
  useEffect(() => {
    let cancel = false;
    setErro(null);
    analisarItens([{ ...item, canal_principal: canal }], params)
      .then((m) => { if (!cancel) setR(m.get(item.sku) || null); })
      .catch((e) => { if (!cancel) setErro(e.message || "Falha ao calcular o preço"); });
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  const tituloSugerido = gerarTitulo(item, canal);
  const titulo = item.titulo_anuncio || tituloSugerido;
  const setVenda = (v) => onChange?.({ preco_ideal: v });
  const copiar = () => { navigator.clipboard?.writeText(titulo); setCopiado(true); setTimeout(() => setCopiado(false), 1500); };

  const canalLabel = (CANAIS.find(([v]) => v === canal) || [null, canal])[1];
  const canalSel = canalV2(canal);
  const margemPct = Math.round(REGRAS.margemMin * 100);
  const st = r ? (STATUS_V2[r.status] || STATUS_V2.SEM_REF) : null;

  // Números do canal ESCOLHIDO (r.piso/minimo podem ser os da venda local quando só ela fecha)
  const pisoE = r?.pisoEscolhido ?? 0;
  const minE = r?.minimoEscolhido ?? 0;
  const precoVenda = Number(item.preco_ideal) > 0 ? Number(item.preco_ideal) : (r?.sugerido ?? 0);
  const eco = r && precoVenda > 0 ? lucroEm(precoVenda, r.base, canalSel) : null;
  const abaixoPiso = r && pisoE > 0 && precoVenda > 0 && precoVenda < pisoE;
  const abaixoMin = r && !abaixoPiso && Number.isFinite(minE) && precoVenda > 0 && precoVenda < minE;
  const pode = r && r.sugerido > 0 && ["ANUNCIAR", "GIRO", "LOCAL"].includes(r.status);
  const jaValidado = r && item.preco_aprovacao === "APROVADO" && Number(item.preco_ideal) === r.sugerido;

  const validar = async () => {
    setSalvando(true); setMsg(null);
    const v = await validarPreco({ sku: item.sku, preco: r.sugerido, piso: r.piso, user,
      motivo: `motor-v2 ${r.status} margem ${(r.margem * 100).toFixed(1)}%` });
    setSalvando(false);
    if (!v.ok) { setMsg({ erro: true, txt: v.erro }); return; }
    setMsg({ erro: false, txt: "Preço validado e salvo." });
    onChange?.({ preco_ideal: r.sugerido, preco_aprovacao: "APROVADO" });
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-3 space-y-3 shadow-sm">
      <div className="flex items-center gap-2 text-gray-800">
        <Tag className="w-4 h-4 text-orange-500" />
        <span className="text-sm font-bold">Precificação &amp; venda</span>
        {st && <span className={`ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${st.cls}`}>{st.txt}</span>}
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

      {/* Destino logístico (informativo: a margem mínima agora é única) */}
      <div>
        <span className="text-[11px] font-semibold uppercase text-gray-500">Destino logístico</span>
        <div className="mt-1">
          <Chips options={DESTINOS} value={item.destino || null}
            onChange={(v) => onChange?.({ destino: v })} activeCls="bg-orange-500 text-white border-orange-500" />
        </div>
      </div>

      {erro && <p className="text-xs text-red-600">Não foi possível calcular o preço agora ({erro}). Você ainda pode digitar o preço manualmente.</p>}
      {!r && !erro && <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Calculando o preço…</p>}

      {r && (
        <>
          {/* Categoria pelo nome ≠ categoria gravada: a referência de preço parte da categoria */}
          {r.categoria?.divergente && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1">Pelo nome, a categoria parece ser <b>{r.categoria.sugerida}</b> (atual: {r.categoria.atual || "sem categoria"}). O preço de referência, a classe e o rateio do lote partem da categoria.</span>
              <button type="button" onClick={() => onChange?.(aoTrocarCategoria(item, r.categoria.sugerida, params))}
                className="px-2.5 py-1.5 rounded-lg bg-amber-600 text-white font-semibold flex-shrink-0">Trocar</button>
            </div>
          )}

          {/* Preço sugerido pelo motor novo */}
          <div className="rounded-2xl border border-orange-200 bg-orange-50/40 p-3 space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-gray-500">
              <Sparkles className="w-3.5 h-3.5 text-orange-500" /> Preço sugerido
            </div>
            {r.sugerido != null ? (
              <p className="text-2xl font-bold text-gray-900">
                {fmtBRL(r.sugerido)}
                <span className="text-xs font-normal text-gray-500 ml-2">
                  lucro {fmtBRL(r.lucro)} · margem {(r.margem * 100).toFixed(1).replace(".", ",")}%{r.canal === "LOCAL" && canalSel !== "LOCAL" ? " · venda local" : ""}
                </span>
              </p>
            ) : <p className="text-sm text-gray-700">{r.motivo}</p>}
            <p className="text-xs text-gray-600">{r.sugerido != null ? r.motivo : ""}</p>
            <p className="text-xs text-gray-500">
              Piso {fmtBRL(pisoE)} · Mínimo p/ {margemPct}% {Number.isFinite(minE) ? fmtBRL(minE) : "—"}
              {Number(item.preco_ideal) > 0 ? ` · Preço atual ${fmtBRL(item.preco_ideal)}` : ""}
            </p>
            {r.semCusto && <p className="text-xs text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Lote sem custo cadastrado: o piso não inclui custo de aquisição.</p>}
            {r.custoOrigem && /estimad/.test(r.custoOrigem) && <p className="text-[11px] text-gray-400">Custo do lote: {r.custoOrigem}.</p>}
            {pode && (
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => onChange?.({ preco_ideal: r.sugerido })}
                  className="px-3 py-2 rounded-xl text-sm font-semibold border border-orange-300 text-orange-700 bg-white">Usar</button>
                <button type="button" onClick={validar} disabled={salvando || jaValidado}
                  className="flex-1 rounded-xl py-2 font-bold bg-orange-500 text-white flex items-center justify-center gap-2 disabled:bg-gray-300 disabled:text-gray-500">
                  {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {jaValidado ? "Preço já validado" : `Validar ${fmtBRL(r.sugerido)}`}
                </button>
              </div>
            )}
            {msg && <p className={`text-xs ${msg.erro ? "text-red-600" : "text-emerald-700"}`}>{msg.txt}</p>}
          </div>

          {/* Seu preço + régua + veredito ao vivo */}
          <div className="rounded-2xl border border-gray-200 p-3 space-y-2">
            <span className="text-[11px] font-semibold uppercase text-gray-500">Seu preço de venda</span>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-gray-400">R$</span>
              <input type="number" inputMode="decimal"
                className={`w-full rounded-xl border px-3 py-2.5 text-2xl font-bold bg-white focus:outline-none focus:ring-2 ${abaixoPiso ? "border-red-400 text-red-700 focus:ring-red-400" : "border-gray-300 text-gray-900 focus:ring-orange-500"}`}
                value={item.preco_ideal ?? ""} onChange={(e) => setVenda(e.target.value)}
                placeholder={r.sugerido ? String(r.sugerido) : "0"} />
            </div>

            <PriceRuler piso={pisoE} recomendado={r.alvo} preco={precoVenda} fmtBRL={fmtBRL} />

            {abaixoPiso ? (
              <div className="rounded-xl bg-red-50 border border-red-200 p-2.5 text-xs text-red-700">
                <p className="font-bold flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Abaixo do piso — risco de prejuízo</p>
                <p className="mt-0.5">A {fmtBRL(precoVenda)} você fica {fmtBRL(pisoE - precoVenda)} abaixo do piso. Suba para ≥ {fmtBRL(pisoE)} ou venda em kit/lote/canal local.</p>
              </div>
            ) : abaixoMin ? (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800">
                <p className="font-bold flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Dá lucro, mas abaixo da margem mínima de {margemPct}%</p>
                <p className="mt-0.5">A {fmtBRL(precoVenda)} em {canalLabel}: lucro {fmtBRL(eco.lucro)} · margem {(eco.margem * 100).toFixed(1).replace(".", ",")}%. Para {margemPct}% seria {fmtBRL(minE)}.</p>
              </div>
            ) : eco ? (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-2.5 text-xs text-emerald-800">
                <p className="font-bold flex items-center gap-1"><TrendingUp className="w-4 h-4" /> Vendendo a {fmtBRL(precoVenda)} em {canalLabel}</p>
                <p className="mt-0.5">Lucro {fmtBRL(eco.lucro)} · margem {(eco.margem * 100).toFixed(1).replace(".", ",")}%. Faixa segura: {fmtBRL(pisoE)} a {fmtBRL(r.alvo)}.</p>
              </div>
            ) : null}
          </div>

          {/* Memória de cálculo: como chegamos neste preço (no canal escolhido e no preço avaliado) */}
          <MemoriaCalculoV2 r={{ ...r, canal: r.canalEscolhido, piso: pisoE, minimo: minE }} preco={precoVenda} fmtBRL={fmtBRL} />
        </>
      )}

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
