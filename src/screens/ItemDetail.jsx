import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react";
import { supabase } from "../lib/supabase";
import { STATUS_FLOW, statusIdx, statusMeta, CLASSE_STYLE, ESTADOS, VOLTAGENS, validarEAN } from "../lib/model";
import {
  ChevronLeft, Camera, AlertTriangle, ArrowRight, Trash2, Loader2, X, ScanLine, Barcode, Printer
} from "lucide-react";
import { buildProductLabel } from "../lib/labels";
import { buscarViasImpressao } from "../lib/printLog";
import PricingCard from "../components/PricingCard";
import CategoriaPicker from "../components/CategoriaPicker";
import { DEFAULT_PARAMS } from "../lib/pricing";

// Lazy: a lib de leitura de código de barras (@zxing) só carrega ao abrir o scanner.
const BarcodeScanner = React.lazy(() => import("./BarcodeScanner"));
// Lazy: a tela de etiquetas só carrega (qrcode/jspdf) ao imprimir.
const LabelPrint = React.lazy(() => import("../components/labels/LabelPrint"));

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white";

function TriToggle({ label, value, onChange }) {
  const opts = [
    { v: true, t: "Sim", on: "bg-emerald-600 text-white" },
    { v: false, t: "Não", on: "bg-red-500 text-white" },
  ];
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-100">
      <span className="text-sm text-gray-800">{label}</span>
      <div className="flex gap-1">
        {opts.map((o) => (
          <button key={o.t} onClick={() => onChange(value === o.v ? null : o.v)}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold border ${value === o.v ? o.on + " border-transparent" : "bg-white text-gray-500 border-gray-300"}`}>
            {o.t}
          </button>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block py-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

export default function ItemDetail({ item, user, params = DEFAULT_PARAMS, onClose, onSaved }) {
  const [it, setIt] = useState({ ...item });
  const [fotos, setFotos] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [custoItem, setCustoItem] = useState(null); // custo_proporcional do rateio do lote (vw_precificacao)
  const [viaInfo, setViaInfo] = useState(null); // { vias, ultima } — controle de impressão
  const dirty = useRef(false);
  const fileRef = useRef();

  const catList = useMemo(
    () => Object.keys(params.grupos || {}).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [params]
  );

  // Vias de etiqueta já impressas deste item (aviso de "já impresso").
  const carregarVias = useCallback(async () => {
    const m = await buscarViasImpressao([it.sku]);
    setViaInfo(m[it.sku] || { vias: 0, ultima: null });
  }, [it.sku]);
  useEffect(() => { carregarVias(); }, [carregarVias]);

  const gtinValido = !it.gtin || validarEAN(it.gtin);

  const set = (patch) => { dirty.current = true; setIt((p) => ({ ...p, ...patch })); };

  // carregar fotos do item
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("fotos").select("*").eq("sku", it.sku).order("ordem");
      if (data) {
        const withUrls = await Promise.all(
          data.map(async (f) => {
            const { data: signed } = await supabase.storage.from("fotos-produtos").createSignedUrl(f.storage_path, 3600);
            return { ...f, url: signed?.signedUrl };
          })
        );
        setFotos(withUrls);
      }
    })();
  }, [it.sku]);

  // custo proporcional do item (rateio do lote) — usado pelo PricingCard p/ o piso de custo.
  // A view pode não existir ainda (migration não aplicada); nesse caso o card mostra aviso.
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("vw_precificacao")
        .select("custo_proporcional")
        .eq("sku", it.sku)
        .maybeSingle();
      if (!error && data) setCustoItem(data.custo_proporcional);
    })();
  }, [it.sku]);

  const idx = statusIdx(it.status);
  const next = idx >= 0 && idx < STATUS_FLOW.length - 1 ? STATUS_FLOW[idx + 1] : null;

  const gate = (() => {
    if (!next) return null;
    switch (next.id) {
      case "TRIADO": return it.estado ? null : "Defina o Estado do item para triar.";
      case "TESTADO":
        if (it.estado === "Novo") return null;
        return it.testado != null && it.funciona != null ? null : "Marque Testado? e Funciona?";
      case "FOTOGRAFADO": return fotos.length || it.foto_feita ? null : "Tire ao menos uma foto para avançar.";
      case "PRECIFICADO": return it.preco_min && it.preco_ideal ? null : "Preencha preço mínimo e ideal.";
      case "PRONTO": return null;
      case "ANUNCIADO": return it.anuncio_feito ? null : "Marque 'Anúncio publicado' para avançar.";
      case "VENDIDO": return it.valor_vendido ? null : "Informe o valor vendido.";
      default: return null;
    }
  })();

  const subirFoto = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${it.sku}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("fotos-produtos").upload(path, file, { upsert: false });
      if (error) throw error;
      const ordem = fotos.length;
      const { data: nova } = await supabase.from("fotos").insert({ sku: it.sku, storage_path: path, ordem }).select().single();
      const { data: signed } = await supabase.storage.from("fotos-produtos").createSignedUrl(path, 3600);
      setFotos((f) => [...f, { ...nova, url: signed?.signedUrl }]);
      if (!it.foto_feita) set({ foto_feita: true });
    } catch (e) {
      alert("Falha ao enviar a foto. Tente novamente.");
    } finally {
      setUploading(false);
    }
  };

  const apagarFoto = async (foto) => {
    await supabase.storage.from("fotos-produtos").remove([foto.storage_path]);
    await supabase.from("fotos").delete().eq("id", foto.id);
    setFotos((f) => f.filter((x) => x.id !== foto.id));
  };

  const salvar = async (novoStatus) => {
    const patch = {
      estado: it.estado, testado: it.testado, funciona: it.funciona, avaria: it.avaria,
      acessorios_ok: it.acessorios_ok, caixa_original: it.caixa_original,
      preco_min: it.preco_min || null, preco_ideal: it.preco_ideal || null,
      preco_sugerido: it.preco_sugerido || null, canal_principal: it.canal_principal || null,
      destino: it.destino, local_fisico: it.local_fisico, caixa_num: it.caixa_num,
      foto_feita: it.foto_feita || fotos.length > 0, anuncio_feito: it.anuncio_feito,
      valor_vendido: it.valor_vendido || null, obs: it.obs,
      // Categoria (casa com pricing_grupo p/ a âncora de preço)
      grupo: (it.grupo || "").trim() || null,
      // Campos para integrações (Amazon / ML / TikTok / Hiper)
      gtin: it.gtin?.trim() || null, marca: it.marca?.trim() || null, modelo: it.modelo?.trim() || null,
      voltagem: it.voltagem || null, cor: it.cor?.trim() || null, num_serie: it.num_serie?.trim() || null,
      comprimento_cm: it.comprimento_cm || null, largura_cm: it.largura_cm || null,
      altura_cm: it.altura_cm || null, peso_real_kg: it.peso_real_kg || null,
      ncm: it.ncm?.trim() || null, condicao_anuncio: it.condicao_anuncio || null,
      titulo_anuncio: it.titulo_anuncio?.trim() || null, descricao_anuncio: it.descricao_anuncio?.trim() || null,
      upd_by: user.email,
      ...(novoStatus ? { status: novoStatus } : {}),
    };
    const { data, error } = await supabase.from("itens").update(patch).eq("sku", it.sku).select().single();
    if (error) { alert("Erro ao salvar: " + error.message); return; }
    if (novoStatus) {
      await supabase.from("eventos").insert({ sku: it.sku, acao: "status:" + novoStatus, usuario: user.email });
      setIt((p) => ({ ...p, status: novoStatus }));
    }
    dirty.current = false;
    onSaved(data);
  };

  const fechar = async () => { if (dirty.current) await salvar(null); onClose(); };
  const sm = statusMeta(it.status);

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col">
      <div className="bg-gray-900 text-white px-4 pt-4 pb-3 shadow-md">
        <div className="flex items-center justify-between">
          <button onClick={fechar} className="flex items-center gap-1 text-gray-300 text-sm py-1">
            <ChevronLeft className="w-5 h-5" /> Voltar
          </button>
          <div className="flex items-center gap-2">
            <button onClick={() => setPrinting(true)}
              className="flex items-center gap-1 bg-gray-800 rounded-full pl-2.5 pr-3 py-1 text-xs font-semibold text-gray-100">
              <Printer className="w-3.5 h-3.5" /> Etiqueta
            </button>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${sm.color}`}>{sm.label}</span>
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-mono text-lg font-bold text-orange-400">{it.sku}</span>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${CLASSE_STYLE[it.classe] || "bg-gray-400 text-white"}`}>{it.classe}</span>
          <span className="text-xs text-gray-400">Lote {it.lote}</span>
        </div>
        <p className="text-sm text-gray-200 mt-1 leading-snug">{it.produto}</p>
      </div>

      {viaInfo?.vias > 0 && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-2">
          <Printer className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <p className="text-xs text-amber-800 leading-snug">
            <b>Etiqueta já impressa</b> · {viaInfo.vias} {viaInfo.vias === 1 ? "via" : "vias"}
            {viaInfo.ultima
              ? ` · última ${new Date(viaInfo.ultima).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`
              : ""}
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-32">
        {/* Fotos */}
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3 mb-4 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1">Fotos</h3>
          <p className="text-xs text-gray-400 mb-2">Sugestão: frente, etiqueta (marca/modelo), defeitos e acessórios. (Foto fundo branco p/ Amazon é tratada depois.)</p>
          <div className="flex gap-2 flex-wrap">
            {fotos.map((f) => (
              <div key={f.id} className="relative w-20 h-20 rounded-lg overflow-hidden bg-gray-100">
                {f.url && <img src={f.url} alt="" className="w-full h-full object-cover" />}
                <button onClick={() => apagarFoto(f)} className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5">
                  <X className="w-3 h-3 text-white" />
                </button>
              </div>
            ))}
            <button
              onClick={() => fileRef.current.click()} disabled={uploading}
              className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400"
            >
              {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Camera className="w-6 h-6" />}
            </button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => e.target.files[0] && subirFoto(e.target.files[0])} />
          </div>
        </div>

        {/* Checklist de condição */}
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-2 mb-4 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 pt-2 pb-1">Checklist de condição</h3>
          <Field label="Estado">
            <div className="flex flex-wrap gap-1.5">
              {ESTADOS.map((e) => (
                <button key={e} onClick={() => set({ estado: it.estado === e ? null : e })}
                  className={`px-3 py-1.5 rounded-lg text-sm border ${it.estado === e ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-300"}`}>
                  {e}
                </button>
              ))}
            </div>
          </Field>
          <TriToggle label="Testado?" value={it.testado} onChange={(v) => set({ testado: v })} />
          <TriToggle label="Funciona?" value={it.funciona} onChange={(v) => set({ funciona: v })} />
          <TriToggle label="Tem avaria?" value={it.avaria} onChange={(v) => set({ avaria: v })} />
          <TriToggle label="Acessórios completos?" value={it.acessorios_ok} onChange={(v) => set({ acessorios_ok: v })} />
          <TriToggle label="Caixa original?" value={it.caixa_original} onChange={(v) => set({ caixa_original: v })} />
        </div>

        {/* Dados para venda (integrações) — Tier 1 */}
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-2 mb-4 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 pt-2 pb-1 flex items-center gap-1.5">
            <Barcode className="w-3.5 h-3.5" /> Dados para venda
          </h3>
          <Field label="Código de barras (GTIN/EAN)">
            <div className="flex gap-2">
              <input className={`${inputCls} font-mono ${it.gtin && !gtinValido ? "border-red-400 ring-1 ring-red-300" : ""}`}
                inputMode="numeric" value={it.gtin ?? ""} onChange={(e) => set({ gtin: e.target.value })} placeholder="escaneie ou digite" />
              <button onClick={() => setScanning(true)}
                className="px-3 rounded-lg bg-gray-900 text-white flex items-center gap-1 text-sm font-semibold flex-shrink-0">
                <ScanLine className="w-4 h-4" /> Escanear
              </button>
            </div>
            {it.gtin
              ? <p className={`text-xs mt-1 ${gtinValido ? "text-emerald-600" : "text-red-600"}`}>{gtinValido ? "✓ código válido" : "✗ dígito verificador inválido — confira"}</p>
              : <p className="text-xs text-gray-400 mt-1">Opcional — nem todo item de leilão tem código.</p>}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Marca"><input className={inputCls} value={it.marca ?? ""} onChange={(e) => set({ marca: e.target.value })} placeholder="ex.: Britânia" /></Field>
            <Field label="Modelo"><input className={inputCls} value={it.modelo ?? ""} onChange={(e) => set({ modelo: e.target.value })} placeholder="ex.: BFR-2000" /></Field>
          </div>
          <Field label="Categoria">
            <CategoriaPicker value={it.grupo || ""} onChange={(g) => set({ grupo: g })} grupos={catList} />
          </Field>
          <Field label="Voltagem">
            <div className="flex flex-wrap gap-1.5">
              {VOLTAGENS.map((v) => (
                <button key={v} onClick={() => set({ voltagem: it.voltagem === v ? null : v })}
                  className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold border ${it.voltagem === v ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-300"}`}>{v}</button>
              ))}
            </div>
          </Field>
          <Field label="Cor"><input className={inputCls} value={it.cor ?? ""} onChange={(e) => set({ cor: e.target.value })} placeholder="ex.: Preto" /></Field>
        </div>

        {/* Dimensões & peso — pré-carregados, confirmar */}
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-2 mb-4 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 pt-2 pb-1">Dimensões & peso — confirme</h3>
          <p className="text-xs text-gray-400 mb-1">Pré-preenchido por categoria. Ajuste se o real for diferente (afeta o frete).</p>
          <div className="grid grid-cols-4 gap-2">
            <Field label="Comp cm"><input type="number" inputMode="decimal" className={inputCls} value={it.comprimento_cm ?? ""} onChange={(e) => set({ comprimento_cm: e.target.value })} /></Field>
            <Field label="Larg cm"><input type="number" inputMode="decimal" className={inputCls} value={it.largura_cm ?? ""} onChange={(e) => set({ largura_cm: e.target.value })} /></Field>
            <Field label="Alt cm"><input type="number" inputMode="decimal" className={inputCls} value={it.altura_cm ?? ""} onChange={(e) => set({ altura_cm: e.target.value })} /></Field>
            <Field label="Peso kg"><input type="number" inputMode="decimal" className={inputCls} value={it.peso_real_kg ?? ""} onChange={(e) => set({ peso_real_kg: e.target.value })} /></Field>
          </div>
        </div>

        {/* Precificação & venda — card único (motor + preço final + anúncio + destino + venda) */}
        <div className="mb-4">
          <PricingCard
            item={it}
            params={params}
            custoItem={custoItem}
            onChange={(patch) => set(patch)}
          />
        </div>

        {/* Observações */}
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-2 mb-4 shadow-sm">
          <Field label="Observações"><textarea className={inputCls} rows={2} value={it.obs ?? ""} onChange={(e) => set({ obs: e.target.value })} placeholder="Detalhes, defeitos, nº de série…" /></Field>
        </div>

        <button onClick={() => salvar("DESCARTE")} className="w-full flex items-center justify-center gap-2 text-red-600 border border-red-200 bg-red-50 rounded-xl py-3 text-sm font-semibold">
          <Trash2 className="w-4 h-4" /> Marcar como descarte / sucata
        </button>
      </div>

      <div className="absolute bottom-0 inset-x-0 bg-white border-t border-gray-200 px-4 py-3 shadow-lg">
        {gate && <p className="text-xs text-amber-700 flex items-center gap-1.5 mb-2"><AlertTriangle className="w-3.5 h-3.5" /> {gate}</p>}
        <div className="flex gap-2">
          <button onClick={fechar} className="flex-1 rounded-xl py-3.5 font-semibold border border-gray-300 text-gray-700 bg-white">Salvar</button>
          {next && (
            <button disabled={!!gate} onClick={() => salvar(next.id)}
              className="flex-1 rounded-xl py-3.5 font-bold bg-gray-900 text-white disabled:bg-gray-300 disabled:text-gray-500 flex items-center justify-center gap-2">
              Avançar: {next.short} <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {scanning && (
        <Suspense fallback={<div className="fixed inset-0 z-[60] bg-black flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>}>
          <BarcodeScanner
            onClose={() => setScanning(false)}
            onDetected={(code) => { set({ gtin: code }); setScanning(false); }}
          />
        </Suspense>
      )}

      {printing && (
        <Suspense fallback={<div className="fixed inset-0 z-[70] bg-white flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>}>
          <LabelPrint
            labels={[buildProductLabel(it)]}
            user={user}
            onPrinted={carregarVias}
            onClose={() => setPrinting(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
