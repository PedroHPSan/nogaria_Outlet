import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react";
import { supabase } from "../lib/supabase";
import { STATUS_FLOW, statusIdx, statusMeta, CLASSE_STYLE, ESTADOS, EMBALAGENS, VOLTAGENS, validarEAN, fmtBRL, CANAIS_VENDA } from "../lib/model";
import {
  ChevronLeft, ChevronRight, ZoomIn, Camera, AlertTriangle, ArrowRight, Trash2, Loader2, X, ScanLine, Barcode, Printer, Undo2, RefreshCw, Layers, Sparkles, ImageIcon, Check, CheckCircle2, Smartphone, Ruler, ExternalLink, Receipt, Package, Images, Star
} from "lucide-react";
import { buildProductLabel, genQrDataUrl } from "../lib/labels";
import { enviarFoto, definirFotoPrincipal } from "../lib/fotos";
import { moverEtapa, desmembrarItem, testeObrigatorio, registrarSemTeste, propagarCategoriaIrmaos, propagarEnriquecimentoIrmaos } from "../lib/conferencia";
import { MEDIDAS_FONTE, fonteLabel, estimarPorCategoria, registrarMedida } from "../lib/medidas";
import { diagnosticarPorCanal } from "../lib/export";
import { buscarViasImpressao } from "../lib/printLog";
import { buscarCaixa, CAIXA_STATUS } from "../lib/caixas";
import PricingCard from "../components/PricingCard";
import PublishPanel from "../components/PublishPanel";
import CategoriaPicker from "../components/CategoriaPicker";
import FotoInputs from "../components/FotoInputs";
import { sugerirCategoria } from "../lib/categorizar";
import { DEFAULT_PARAMS } from "../lib/pricing";
import { derivarPreco } from "../lib/precoView";
import { construirSugestoes, separarSugestoes, patchVazios, montarAnalise } from "../lib/iaAnalise";
import { salvarAnaliseIA } from "../lib/ia";
import { classificarItem } from "../lib/classificacao";

// Lazy: a lib de leitura de código de barras (@zxing) só carrega ao abrir o scanner.
const BarcodeScanner = React.lazy(() => import("./BarcodeScanner"));
// Lazy: a tela de etiquetas só carrega (qrcode/jspdf) ao imprimir.
const LabelPrint = React.lazy(() => import("../components/labels/LabelPrint"));
const AnuncioModal = React.lazy(() => import("../components/AnuncioModal"));

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white";

// Marquinha "IA" para rotular um campo preenchido pela IA (usa iaFez(k) do ItemDetail).
function IaTag({ on }) {
  if (!on) return null;
  return (
    <span title="Preenchido pela IA" className="ml-1 inline-flex items-center gap-0.5 align-middle px-1 py-0.5 rounded text-[9px] font-bold bg-violet-100 text-violet-700">
      <Sparkles className="w-2.5 h-2.5" /> IA
    </span>
  );
}

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
  const [lightbox, setLightbox] = useState(null); // índice da foto ampliada (ou null)
  const [uploading, setUploading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [anuncio, setAnuncio] = useState(false);
  const [custoItem, setCustoItem] = useState(null); // custo_proporcional do rateio do lote (vw_precificacao)
  const [viaInfo, setViaInfo] = useState(null); // { vias, ultima } — controle de impressão
  const [caixaInfo, setCaixaInfo] = useState(null); // dados da caixa em que o item está
  const [refreshing, setRefreshing] = useState(false);
  const [iaLoading, setIaLoading] = useState(false); // "texto" | "foto" | false
  const [iaProgresso, setIaProgresso] = useState(0); // 0-100, barra durante a run
  const iaProgRef = useRef(null);
  const [forcarIA, setForcarIA] = useState(false); // override p/ refazer item já completado
  const [iaErro, setIaErro] = useState(null);
  const [qrCelular, setQrCelular] = useState(null); // { url, data } — QR p/ abrir no celular
  const dirty = useRef(false);
  const fotoRef = useRef();

  // Gera um QR que codifica o link direto desta ficha (?item=SKU). Lendo o QR na
  // tela do notebook, o celular abre exatamente este cadastro para adicionar fotos.
  const abrirQrCelular = async () => {
    const url = `${window.location.origin}/?item=${encodeURIComponent(it.sku)}`;
    setQrCelular({ url, data: await genQrDataUrl(url) });
  };

  const catList = useMemo(
    () => Object.keys(params.grupos || {}).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [params]
  );
  const sugCat = useMemo(() => sugerirCategoria(it.produto, catList), [it.produto, catList]);

  // Vias de etiqueta já impressas deste item (aviso de "já impresso").
  const carregarVias = useCallback(async () => {
    const m = await buscarViasImpressao([it.sku]);
    setViaInfo(m[it.sku] || { vias: 0, ultima: null });
  }, [it.sku]);
  useEffect(() => { carregarVias(); }, [carregarVias]);

  // Carrega os dados da caixa do item (para o cartão informativo). Best-effort.
  useEffect(() => {
    let cancel = false;
    if (!it.caixa_id) { setCaixaInfo(null); return; }
    buscarCaixa(it.caixa_id).then((c) => { if (!cancel) setCaixaInfo(c); }).catch(() => {});
    return () => { cancel = true; };
  }, [it.caixa_id]);

  const gtinValido = !it.gtin || validarEAN(it.gtin);

  const set = (patch) => { dirty.current = true; setIt((p) => ({ ...p, ...patch })); };

  // Origem da medida no momento em que a ficha abriu (p/ registrar no histórico só se mudar).
  const fonteAbertura = useRef(item.medidas_fonte || null);
  const [estimando, setEstimando] = useState(false);

  // Edição manual de dimensão/peso = medição real → marca a fonte como MEDIDO.
  const setMedida = (patch) => set({ ...patch, medidas_fonte: MEDIDAS_FONTE.MEDIDO });

  // Estima dimensões/peso pela mediana da categoria (sem IA). Só preenche campos vazios
  // e marca a fonte como ESTIMADO para rastrear que ainda falta medir.
  const estimarCategoria = async () => {
    if (!it.grupo) return;
    setEstimando(true);
    try {
      const d = await estimarPorCategoria(it.grupo);
      if (!d) { alert("Sem amostra suficiente nesta categoria para estimar."); return; }
      set({
        comprimento_cm: it.comprimento_cm ?? d.comprimento_cm,
        largura_cm: it.largura_cm ?? d.largura_cm,
        altura_cm: it.altura_cm ?? d.altura_cm,
        peso_real_kg: it.peso_real_kg ?? d.peso_kg,
        medidas_fonte: MEDIDAS_FONTE.ESTIMADO,
      });
    } finally {
      setEstimando(false);
    }
  };

  // carregar fotos do item
  const carregarFotos = useCallback(async () => {
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
  }, [it.sku]);
  useEffect(() => { carregarFotos(); }, [carregarFotos]);

  // Lightbox: Esc fecha, setas navegam (desktop). No mobile, usa os toques/botões.
  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (e) => {
      if (e.key === "Escape") setLightbox(null);
      else if (e.key === "ArrowLeft") setLightbox((i) => (i - 1 + fotos.length) % fotos.length);
      else if (e.key === "ArrowRight") setLightbox((i) => (i + 1) % fotos.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, fotos.length]);

  // Limpa o timer da barra de progresso da IA ao desmontar.
  useEffect(() => () => clearInterval(iaProgRef.current), []);

  // custo proporcional do item (rateio do lote) — usado pelo PricingCard p/ o piso de custo.
  // A view pode não existir ainda (migration não aplicada); nesse caso o card mostra aviso.
  const carregarCusto = useCallback(async () => {
    const { data, error } = await supabase
      .from("vw_precificacao")
      .select("custo_proporcional")
      .eq("sku", it.sku)
      .maybeSingle();
    if (!error && data) setCustoItem(data.custo_proporcional);
  }, [it.sku]);
  useEffect(() => { carregarCusto(); }, [carregarCusto]);

  // Recarrega os dados do item do servidor sem sair da página (substitui o F5,
  // que reinicia a SPA). Útil no desktop quando o celular atualiza o item.
  const recarregar = async () => {
    if (dirty.current && !window.confirm("Há alterações não salvas. Atualizar vai recarregar do servidor e descartá-las. Continuar?")) return;
    setRefreshing(true);
    try {
      const { data } = await supabase.from("itens").select("*").eq("sku", it.sku).single();
      if (data) { setIt({ ...data }); dirty.current = false; }
      await Promise.all([carregarFotos(), carregarCusto(), carregarVias()]);
    } catch (e) {
      alert("Falha ao atualizar: " + (e?.message || e));
    } finally {
      setRefreshing(false);
    }
  };

  const idx = statusIdx(it.status);
  const next = idx >= 0 && idx < STATUS_FLOW.length - 1 ? STATUS_FLOW[idx + 1] : null;
  const prev = idx > 0 ? STATUS_FLOW[idx - 1] : null;

  // Volta o item para a etapa anterior, com registro no histórico (rastreabilidade).
  const voltarEtapa = async () => {
    if (!prev) return;
    if (!window.confirm(`Voltar este item para "${prev.label}"?`)) return;
    try {
      await moverEtapa(it.sku, prev.id, user, statusMeta(it.status).label);
      setIt((p) => ({ ...p, status: prev.id }));
      onSaved();
    } catch (e) {
      alert("Falha ao voltar etapa: " + (e.message || e));
    }
  };

  // As sugestões da IA (construção, separação vazio/preenchido e snapshot durável) vivem
  // em lib/iaAnalise.js; a persistência (backfill + snapshot) em lib/ia.js.

  // Enriquecimento por IA (edge function enriquecer-produto). Texto-primeiro;
  // comFoto=true reenvia as URLs assinadas das fotos (custo ~2x).
  const enriquecer = async (comFoto) => {
    setIaLoading(comFoto ? "foto" : "texto");
    setIaErro(null);
    // Barra de progresso: a chamada à IA é única (sem % real), então avançamos até
    // ~90% num timer e completamos ao retornar. Dá ao operador o status da run.
    setIaProgresso(8);
    clearInterval(iaProgRef.current);
    iaProgRef.current = setInterval(() => {
      setIaProgresso((p) => (p < 90 ? p + Math.max(1, Math.round((90 - p) / 14)) : p));
    }, 600);
    try {
      const body = {
        produto: it.produto, marca: it.marca, modelo: it.modelo, grupo: it.grupo,
        gtin: it.gtin, ncm: it.ncm, estado: it.estado, voltagem: it.voltagem,
        dimensoes: {
          comprimento_cm: it.comprimento_cm, largura_cm: it.largura_cm,
          altura_cm: it.altura_cm, peso_kg: it.peso_real_kg ?? it.peso_kg,
        },
        categorias: catList,
        ...(comFoto ? { fotos_urls: fotos.map((f) => f.url).filter(Boolean) } : {}),
      };
      const { data, error } = await supabase.functions.invoke("enriquecer-produto", { body });
      if (error) {
        let msg = error.message;
        try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch {}
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      setIaProgresso(100);
      // Sugestões campo a campo + preço ideal derivado das novas referências.
      const sugeridas = construirSugestoes(data, it);
      const grupoBase = params.grupos?.[(data.grupo ?? it.grupo)] || {};
      const dp = derivarPreco(
        { ...it, preco_ref_novo: data.preco_ref_novo ?? it.preco_ref_novo, preco_ref_usado: data.preco_ref_usado ?? it.preco_ref_usado },
        grupoBase, params, custoItem
      );
      if (dp.recomendado > 0) {
        sugeridas.push({ k: "preco_ideal", label: "Preço ideal (recomendado)", val: fmtBRL(dp.recomendado), patch: { preco_ideal: dp.recomendado } });
      }
      // Não-destrutivo: auto-aplica só os campos vazios; o resto fica como sugestão.
      const { vazias } = separarSugestoes(sugeridas, it);
      const patch = patchVazios(vazias);
      const aplicados = vazias.map((s) => s.k);
      const iaAnalise = montarAnalise(data, sugeridas, aplicados, { em: new Date().toISOString(), por: user.email });
      // Persiste o backfill dos vazios + o quadro durável numa escrita; atualiza a ficha.
      const linha = await salvarAnaliseIA(it.sku, patch, iaAnalise, user);
      setIt(linha);
      dirty.current = false;
      onSaved(linha);
    } catch (e) {
      setIaErro(e?.message || String(e));
    } finally {
      clearInterval(iaProgRef.current);
      setIaLoading(false);
      setTimeout(() => setIaProgresso(0), 800);
    }
  };

  // Link de busca no Mercado Livre a partir da descrição do produto (sem IA).
  // Usa o título do anúncio; se vazio, cai para produto + marca + modelo.
  const termoBuscaML = () => {
    const t = (it.titulo_anuncio || "").trim();
    if (t) return t;
    return [it.produto, it.marca, it.modelo].filter(Boolean).join(" ").trim();
  };
  const buscarNoML = () => {
    const termo = termoBuscaML();
    if (!termo) return;
    const url = `https://lista.mercadolivre.com.br/${encodeURIComponent(termo)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  // Item já analisado pela IA (snapshot durável). Desabilita os botões salvo "refazer".
  const jaIA = !!it.ia_analise;
  const iaFez = (k) => !!it.ia_analise?.aplicados?.includes(k);
  const aplicarSugestao = (s) => {
    set(s.patch);
    setIt((p) => (p.ia_analise
      ? { ...p, ia_analise: { ...p.ia_analise, aplicados: [...new Set([...(p.ia_analise.aplicados || []), s.k])] } }
      : p));
  };
  const iaBloqueado = (jaIA && !forcarIA) || !!iaLoading;
  const statusIA = iaProgresso < 30 ? "Enviando dados do produto…"
    : iaProgresso < 65 ? "IA analisando o produto…"
    : iaProgresso < 100 ? "Gerando título, ficha técnica e preço…" : "Pronto!";

  // Item de baixo risco/valor sem teste obrigatório: oferecer marcar como
  // "Usado sem teste" (preço conservador) em vez de exigir teste físico.
  const podeDispensarTeste =
    it.estado && !["Novo", "Embalagem aberta/avariada", "Usado sem teste"].includes(it.estado) &&
    !testeObrigatorio(it, params);
  const marcarSemTeste = async () => {
    set({ estado: "Usado sem teste" });
    try { await registrarSemTeste(it.sku, user); } catch { /* auditoria best-effort */ }
  };

  // Classificação automática (tabela de negócio): condição + faixa de valor + volume.
  // Sugestão (não sobrescreve sozinha); aplicada com 1 clique. Recalcula ao vivo de `it`.
  const sugestaoClasse = useMemo(() => classificarItem(it, params), [it, params]);
  const aplicarClasse = async () => {
    const s = sugestaoClasse;
    if (!s?.classe) return;
    set({
      classe: s.classe,
      ...(it.destino ? {} : { destino: s.destino }),
      ...(it.canal_principal ? {} : { canal_principal: s.canal }),
    });
    // Auditoria best-effort (igual a registrarMedida/registrarSemTeste).
    try {
      await supabase.from("eventos").insert({
        sku: it.sku, acao: "classe:auto", detalhe: s.motivo, usuario: user.email,
      });
    } catch { /* auditoria best-effort */ }
  };

  const gate = (() => {
    if (!next) return null;
    switch (next.id) {
      case "TRIADO": return it.estado ? null : "Defina o Estado do item para triar.";
      case "TESTADO":
        if (it.estado === "Novo" || it.estado === "Embalagem aberta/avariada") return null;
        // Política de risco/valor: teste só é obrigatório para itens ALTO risco / valor alto.
        if (!testeObrigatorio(it, params)) return null;
        return it.testado != null && it.funciona != null
          ? null
          : "Item de risco/valor alto: marque Testado? e Funciona? (ou registre 'Usado sem teste').";
      case "FOTOGRAFADO": return fotos.length || it.foto_feita ? null : "Tire ao menos uma foto para avançar.";
      case "PRECIFICADO": return it.preco_min && it.preco_ideal ? null : "Preencha preço mínimo e ideal.";
      case "PRONTO": return null;
      case "ANUNCIADO": return it.anuncio_feito ? null : "Marque 'Anúncio publicado' para avançar.";
      case "VENDIDO": return it.valor_vendido ? null : "Informe o valor vendido.";
      case "ENTREGUE": return null; // entrega não trava: só carimba a data
      default: return null;
    }
  })();

  // Lucro líquido ao vivo da venda = bruto − taxa − frete − custo do item (rateio do lote).
  const lucroVenda = it.valor_vendido
    ? Number(it.valor_vendido) - (Number(it.taxa_venda) || 0) - (Number(it.frete_pago) || 0) - (Number(custoItem) || 0)
    : null;

  const subirFotos = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading(true);
    try {
      let ordem = fotos.length;
      for (const file of files) {
        const nova = await enviarFoto(it.sku, file, ordem++);
        setFotos((f) => [...f, nova]);
      }
      if (!it.foto_feita) set({ foto_feita: true });
    } catch {
      alert("Falha ao enviar a(s) foto(s). Tente novamente.");
    } finally {
      setUploading(false);
    }
  };

  const apagarFoto = async (foto) => {
    await supabase.storage.from("fotos-produtos").remove([foto.storage_path]);
    await supabase.from("fotos").delete().eq("id", foto.id);
    setFotos((f) => f.filter((x) => x.id !== foto.id));
  };

  // Define a foto como principal (capa do catálogo/anúncio). Recarrega para que
  // a escolhida — agora de menor ordem — suba para o topo da galeria.
  const tornarPrincipal = async (foto) => {
    try {
      await definirFotoPrincipal(it.sku, foto.id);
      await carregarFotos();
    } catch {
      alert("Não foi possível definir a foto principal. Tente novamente.");
    }
  };

  const salvar = async (novoStatus) => {
    const patch = {
      estado: it.estado, testado: it.testado, funciona: it.funciona, avaria: it.avaria,
      acessorios_ok: it.acessorios_ok, caixa_original: it.caixa_original,
      cond_embalagem: it.cond_embalagem || null,
      // Classe pode ser reclassificada na triagem (lib/classificacao.js).
      classe: it.classe || null,
      preco_min: it.preco_min || null, preco_ideal: it.preco_ideal || null,
      preco_sugerido: it.preco_sugerido || null, canal_principal: it.canal_principal || null,
      destino: it.destino, local_fisico: it.local_fisico, caixa_num: it.caixa_num,
      // Nome do produto — editável p/ catalogar itens importados como "A CATALOGAR".
      // Nunca grava vazio (coluna obrigatória): mantém o nome atual se ficar em branco.
      produto: (it.produto || "").trim() || item.produto,
      foto_feita: it.foto_feita || fotos.length > 0, anuncio_feito: it.anuncio_feito,
      // Venda: valor bruto + detalhe (canal real, taxa, frete, comprador, nº do pedido).
      valor_vendido: it.valor_vendido || null,
      canal_venda: it.canal_venda || null, taxa_venda: it.taxa_venda || null,
      frete_pago: it.frete_pago || null, comprador: it.comprador?.trim() || null,
      pedido_ref: it.pedido_ref?.trim() || null,
      obs: it.obs,
      // Categoria (casa com pricing_grupo p/ a âncora de preço)
      grupo: (it.grupo || "").trim() || null,
      // Campos para integrações (Amazon / ML / TikTok / Hiper)
      gtin: it.gtin?.trim() || null, marca: it.marca?.trim() || null, modelo: it.modelo?.trim() || null,
      voltagem: it.voltagem || null, cor: it.cor?.trim() || null, num_serie: it.num_serie?.trim() || null,
      tamanho: it.tamanho?.trim() || null,
      comprimento_cm: it.comprimento_cm || null, largura_cm: it.largura_cm || null,
      altura_cm: it.altura_cm || null, peso_real_kg: it.peso_real_kg || null,
      medidas_fonte: it.medidas_fonte || null,
      ncm: it.ncm?.trim() || null, condicao_anuncio: it.condicao_anuncio || null,
      titulo_anuncio: it.titulo_anuncio?.trim() || null, descricao_anuncio: it.descricao_anuncio?.trim() || null,
      // Referência de preço (da IA) — durável p/ o PricingCard após reload.
      preco_ref_novo: it.preco_ref_novo ?? null, preco_ref_usado: it.preco_ref_usado ?? null,
      preco_ref_fonte: it.preco_ref_fonte || null, preco_ref_confianca: it.preco_ref_confianca || null,
      // Conteúdo de listagem da IA (jsonb) — bullets/palavras-chave/ficha (flat file Amazon).
      bullet_points: it.bullet_points ?? null, palavras_chave: it.palavras_chave ?? null,
      ficha_tecnica: it.ficha_tecnica ?? null,
      // Snapshot durável da análise da IA (inclui `aplicados` atualizado por aplicações manuais).
      ia_analise: it.ia_analise ?? null,
      upd_by: user.email,
      ...(novoStatus ? { status: novoStatus } : {}),
      // Carimbos de pós-venda na transição (vendido_em só se ainda vazio).
      ...(novoStatus === "VENDIDO" && !it.vendido_em ? { vendido_em: new Date().toISOString() } : {}),
      ...(novoStatus === "ENTREGUE" ? { entregue_em: new Date().toISOString() } : {}),
    };
    const { data, error } = await supabase.from("itens").update(patch).eq("sku", it.sku).select().single();
    if (error) { alert("Erro ao salvar: " + error.message); return; }
    // Categoria recém-definida → herda nas unidades-irmãs do desmembramento (best-effort).
    if (patch.grupo && patch.grupo !== item.grupo) {
      try { await propagarCategoriaIrmaos(it.sku, user); } catch { /* best-effort */ }
    }
    // Enriquecimento da IA recém-aplicado (ou refeito) → propaga p/ as unidades-irmãs do
    // desmembramento, preenchendo só os campos vazios delas (best-effort).
    if (it.preco_ref_fonte === "IA:claude" && (item.preco_ref_fonte !== "IA:claude" || forcarIA)) {
      try { await propagarEnriquecimentoIrmaos(it.sku, user); } catch { /* best-effort */ }
    }
    if (novoStatus) {
      await supabase.from("eventos").insert({ sku: it.sku, acao: "status:" + novoStatus, usuario: user.email });
      setIt((p) => ({ ...p, status: novoStatus }));
    }
    // Histórico de medição: registra só quando a origem mudou nesta sessão (best-effort).
    if (it.medidas_fonte && it.medidas_fonte !== fonteAbertura.current) {
      const det = `${it.comprimento_cm ?? "–"}×${it.largura_cm ?? "–"}×${it.altura_cm ?? "–"}cm · ${it.peso_real_kg ?? "–"}kg`;
      try { await registrarMedida(it.sku, it.medidas_fonte, det, user); } catch { /* auditoria best-effort */ }
      fonteAbertura.current = it.medidas_fonte;
    }
    dirty.current = false;
    onSaved(data);
  };

  const fechar = async () => { if (dirty.current) await salvar(null); onClose(); };

  // Venda direta (atalho): conclui a venda a partir de qualquer etapa (ex.: direto da
  // triagem), sem passar por Fotografado/Precificado/Anunciado. Reusa salvar("VENDIDO"),
  // que grava os campos de venda, carimba vendido_em e registra o evento.
  const venderDireto = () => {
    if (!it.valor_vendido) { alert("Informe o valor vendido no card Venda antes de concluir."); return; }
    salvar("VENDIDO");
  };

  // Desmembra o item em N unidades individuais (1 SKU cada). Salva antes para que
  // as cópias herdem os dados atuais.
  const desmembrar = async () => {
    const resp = window.prompt("Quantas unidades este item tem no total? (cria 1 SKU por unidade)", "2");
    if (resp == null) return;
    const total = Math.floor(Number(resp));
    if (!total || total < 2) { alert("Informe um número maior que 1."); return; }
    try {
      if (dirty.current) await salvar(null);
      const novos = await desmembrarItem({ ...it }, total, user);
      onSaved();
      alert(`${novos.length} unidade(s) criada(s) neste lote${fotos.length ? " — fotos replicadas" : ""}.`);
    } catch (e) {
      alert("Falha ao desmembrar: " + (e?.message || e));
    }
  };
  const sm = statusMeta(it.status);

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col">
      <div className="bg-gray-900 text-white px-4 pt-4 pb-3 shadow-md">
        <div className="flex items-center justify-between">
          <button onClick={fechar} className="flex items-center gap-1 text-gray-300 text-sm py-1">
            <ChevronLeft className="w-5 h-5" /> Voltar
          </button>
          <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5">
            <button onClick={recarregar} disabled={refreshing}
              className="flex items-center gap-1 bg-gray-800 rounded-full pl-2.5 pr-3 py-1 text-xs font-semibold text-gray-100 disabled:opacity-60"
              title="Atualizar dados do servidor">
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} /> Atualizar
            </button>
            <button onClick={abrirQrCelular}
              className="flex items-center gap-1 bg-gray-800 rounded-full pl-2.5 pr-3 py-1 text-xs font-semibold text-gray-100"
              title="Abrir esta ficha no celular (QR)">
              <Smartphone className="w-3.5 h-3.5" /> Celular
            </button>
            <button onClick={() => setPrinting(true)}
              className="flex items-center gap-1 bg-gray-800 rounded-full pl-2.5 pr-3 py-1 text-xs font-semibold text-gray-100">
              <Printer className="w-3.5 h-3.5" /> Etiqueta
            </button>
            <button onClick={() => setAnuncio(true)}
              className="flex items-center gap-1 bg-gray-800 rounded-full pl-2.5 pr-3 py-1 text-xs font-semibold text-gray-100"
              title="Gerar orçamento/anúncio (PDF)">
              <Receipt className="w-3.5 h-3.5" /> Orçamento
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
        {it.caixa_id && (
          <div className="bg-white rounded-2xl border border-indigo-200 px-4 py-3 mb-4 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 pb-1.5 flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5 text-indigo-500" /> Caixa
            </h3>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm font-bold text-gray-900">{it.caixa_id}</span>
              {caixaInfo && (
                <span className={`text-[10px] font-bold uppercase rounded px-1.5 py-0.5 ${caixaInfo.status === CAIXA_STATUS.FECHADA ? "bg-gray-200 text-gray-600" : "bg-emerald-100 text-emerald-700"}`}>
                  {caixaInfo.status === CAIXA_STATUS.FECHADA ? "Fechada" : "Aberta"}
                </span>
              )}
              {caixaInfo?.tipo && <span className="text-xs text-gray-500">{caixaInfo.tipo === "MALA" ? "Mala" : "Caixa"}</span>}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {(caixaInfo?.destino || it.destino) || "sem destino"}
              {(caixaInfo?.local_fisico || it.local_fisico) ? ` · ${caixaInfo?.local_fisico || it.local_fisico}` : ""}
            </p>
          </div>
        )}
        {/* Assistente de IA — completa dados, sugere preço e diagnostica */}
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3 mb-4 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 pb-2 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-violet-500" /> Assistente de IA
            {jaIA && (
              <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-100 text-violet-700 normal-case tracking-normal">
                <CheckCircle2 className="w-3 h-3" /> Completado via IA
              </span>
            )}
          </h3>
          <div className="flex gap-2">
            <button onClick={() => enriquecer(false)} disabled={iaBloqueado}
              className="flex-1 inline-flex items-center justify-center gap-1.5 text-sm font-semibold text-white bg-violet-600 rounded-lg px-3 py-2.5 active:bg-violet-700 disabled:opacity-50">
              {iaLoading === "texto" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Completar com IA
            </button>
            <button onClick={() => enriquecer(true)} disabled={iaBloqueado || fotos.length === 0}
              title={fotos.length === 0 ? "Adicione uma foto primeiro" : "Usa as fotos (custo maior)"}
              className="inline-flex items-center justify-center gap-1.5 text-sm font-semibold text-violet-700 border border-violet-300 bg-violet-50 rounded-lg px-3 py-2.5 disabled:opacity-40">
              {iaLoading === "foto" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
              Com foto
            </button>
          </div>

          {/* Já completado: explica e oferece refazer (gasta crédito Claude de novo). */}
          {jaIA && !forcarIA && !iaLoading && (
            <p className="text-[11px] text-gray-500 mt-1.5">
              Este item já foi completado pela IA.{" "}
              <button type="button" onClick={() => setForcarIA(true)} className="font-semibold text-violet-700">Refazer com IA</button>
            </p>
          )}

          {/* Barra de progresso da run (chamada única → progresso animado + status). */}
          {iaLoading && (
            <div className="mt-2">
              <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full bg-violet-500 transition-all duration-500" style={{ width: `${iaProgresso}%` }} />
              </div>
              <p className="text-[11px] text-gray-500 mt-1 flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" /> {statusIA}
              </p>
            </div>
          )}
          <button
            onClick={buscarNoML}
            disabled={!termoBuscaML()}
            title={!termoBuscaML() ? "Preencha título, produto, marca ou modelo" : "Abre a busca no Mercado Livre (sem IA)"}
            className="mt-2 w-full inline-flex items-center justify-center gap-1.5 text-sm font-semibold text-amber-900 bg-amber-300 rounded-lg px-3 py-2.5 active:bg-amber-400 disabled:opacity-40">
            <ExternalLink className="w-4 h-4" />
            Buscar no Mercado Livre
          </button>
          <p className="text-[11px] text-gray-400 mt-1.5">A IA preenche os campos automaticamente; revise e clique em Salvar. Preços são estimativa de mercado (não cotação real).</p>

          {iaErro && (
            <p className="text-xs text-red-600 mt-2 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {iaErro}</p>
          )}

          {it.ia_analise && (() => {
            const a = it.ia_analise;
            const aplicados = a.aplicados || [];
            const sugestoes = a.sugestoes || [];
            const preenchidos = sugestoes.filter((s) => aplicados.includes(s.k));
            const pendentes = sugestoes.filter((s) => !aplicados.includes(s.k));
            return (
              <div className="mt-3 border-t border-gray-100 pt-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700">
                    <Sparkles className="w-3.5 h-3.5" /> Análise da IA{a.usou_foto ? " (com foto)" : ""}
                  </span>
                  <span className="text-[11px] text-gray-400">
                    {a.em ? new Date(a.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : ""}
                    {a.confianca ? ` · ${a.confianca}` : ""}
                  </span>
                </div>

                {preenchidos.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 mb-1 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Preenchidos pela IA
                    </p>
                    <div className="space-y-1">
                      {preenchidos.map((s) => (
                        <div key={s.k} className="text-sm">
                          <span className="text-[11px] uppercase tracking-wide text-gray-400">{s.label}</span>
                          <p className="text-gray-800 leading-snug break-words">{s.val}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {pendentes.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 mb-1">Sugestões (revisar — você já tinha valor)</p>
                    <div className="space-y-1.5">
                      {pendentes.map((s) => (
                        <div key={s.k} className="flex items-start gap-2 text-sm">
                          <div className="flex-1 min-w-0">
                            <span className="text-[11px] uppercase tracking-wide text-gray-400">{s.label}</span>
                            <p className="text-gray-800 leading-snug break-words">{s.val}</p>
                          </div>
                          {s.patch && (
                            <button onClick={() => aplicarSugestao(s)}
                              className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-violet-700 border border-violet-200 rounded-lg px-2 py-1 active:bg-violet-50">
                              <Check className="w-3 h-3" /> Aplicar
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {a.campos_faltantes?.length > 0 && (
                  <p className="text-xs text-gray-600 leading-snug">
                    <b className="text-gray-700">A IA não conseguiu:</b> {a.campos_faltantes.join(", ")}
                  </p>
                )}
                {a.observacoes && <p className="text-xs text-gray-500 leading-snug"><b>Dica:</b> {a.observacoes}</p>}
              </div>
            );
          })()}
        </div>

        {/* Fotos */}
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3 mb-4 shadow-sm">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">Fotos</h3>
            <button onClick={() => fotoRef.current?.abrirCamera()} disabled={uploading}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-orange-500 rounded-lg px-2.5 py-1.5 active:bg-orange-600 disabled:opacity-50">
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
              {uploading ? "Enviando…" : "Adicionar fotos"}
            </button>
          </div>
          <p className="text-xs text-gray-400 mb-2">Sugestão: frente, etiqueta (marca/modelo), defeitos e acessórios. Dá para enviar várias de uma vez.</p>
          {fotos[0]?.url && (
            <button onClick={() => setLightbox(0)} className="block w-full mb-2 relative" title="Toque para ampliar">
              <img src={fotos[0].url} alt="" className="w-full h-48 object-cover rounded-xl bg-gray-100" />
              <span className="absolute top-1.5 left-1.5 bg-amber-500 text-white rounded-lg px-2 py-1 text-[11px] font-semibold flex items-center gap-1">
                <Star className="w-3.5 h-3.5 fill-white" /> Principal
              </span>
              <span className="absolute bottom-1.5 right-1.5 bg-black/55 text-white rounded-lg p-1.5">
                <ZoomIn className="w-4 h-4" />
              </span>
            </button>
          )}
          <div className="flex gap-2 flex-wrap">
            {fotos.map((f, i) => (
              <div key={f.id} className="relative w-20 h-20 rounded-lg overflow-hidden bg-gray-100">
                {f.url && (
                  <button onClick={() => setLightbox(i)} className="block w-full h-full" title="Toque para ampliar">
                    <img src={f.url} alt="" className="w-full h-full object-cover" />
                  </button>
                )}
                <button onClick={(e) => { e.stopPropagation(); apagarFoto(f); }} className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5" title="Apagar foto">
                  <X className="w-3 h-3 text-white" />
                </button>
                {i === 0 ? (
                  <span className="absolute top-0.5 left-0.5 bg-amber-500 rounded-full p-0.5" title="Foto principal">
                    <Star className="w-3 h-3 text-white fill-white" />
                  </span>
                ) : (
                  <button onClick={(e) => { e.stopPropagation(); tornarPrincipal(f); }} className="absolute top-0.5 left-0.5 bg-black/60 rounded-full p-0.5" title="Definir como principal">
                    <Star className="w-3 h-3 text-white" />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => fotoRef.current?.abrirCamera()} disabled={uploading}
              className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-0.5 text-gray-400"
              title="Tirar foto"
            >
              {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Camera className="w-6 h-6" />}
              <span className="text-[10px] font-semibold">Câmera</span>
            </button>
            <button
              onClick={() => fotoRef.current?.abrirGaleria()} disabled={uploading}
              className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-0.5 text-gray-400"
              title="Escolher da galeria"
            >
              {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Images className="w-6 h-6" />}
              <span className="text-[10px] font-semibold">Galeria</span>
            </button>
            <FotoInputs ref={fotoRef} onFiles={subirFotos} />
          </div>
        </div>

        {/* Lightbox de fotos: toque na foto p/ ampliar; toca fora/X fecha; setas navegam. */}
        {lightbox !== null && fotos[lightbox]?.url && (
          <div className="fixed inset-0 z-[80] bg-black/90 flex flex-col" onClick={() => setLightbox(null)}>
            <div className="flex items-center justify-between px-4 py-3 text-white/90">
              <span className="text-sm font-semibold">{lightbox + 1} / {fotos.length}</span>
              <button onClick={(e) => { e.stopPropagation(); setLightbox(null); }}
                className="p-2 rounded-lg bg-white/10 active:bg-white/20" aria-label="Fechar">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 min-h-0 flex items-center justify-center px-2 pb-6">
              <img src={fotos[lightbox].url} alt="" onClick={(e) => e.stopPropagation()}
                className="max-h-full max-w-full object-contain rounded-lg" />
            </div>
            {fotos.length > 1 && (
              <>
                <button aria-label="Anterior"
                  onClick={(e) => { e.stopPropagation(); setLightbox((i) => (i - 1 + fotos.length) % fotos.length); }}
                  className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 text-white active:bg-white/20">
                  <ChevronLeft className="w-7 h-7" />
                </button>
                <button aria-label="Próxima"
                  onClick={(e) => { e.stopPropagation(); setLightbox((i) => (i + 1) % fotos.length); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 text-white active:bg-white/20">
                  <ChevronRight className="w-7 h-7" />
                </button>
              </>
            )}
          </div>
        )}

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
          {/* Embalagem: eixo independente do Estado (corte pequeno só p/ produto novo). */}
          {["Novo", "Embalagem aberta/avariada"].includes(it.estado) && (
            <Field label="Embalagem">
              <div className="flex flex-wrap gap-1.5">
                {EMBALAGENS.map(([v, t]) => (
                  <button key={v} onClick={() => set({ cond_embalagem: v })}
                    className={`px-3 py-1.5 rounded-lg text-sm border ${(it.cond_embalagem || "PERFEITA") === v ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-300"}`}>
                    {t}
                  </button>
                ))}
              </div>
            </Field>
          )}
          <TriToggle label="Testado?" value={it.testado} onChange={(v) => set({ testado: v })} />
          <TriToggle label="Funciona?" value={it.funciona} onChange={(v) => set({ funciona: v })} />
          <TriToggle label="Tem avaria?" value={it.avaria} onChange={(v) => set({ avaria: v })} />
          <TriToggle label="Acessórios completos?" value={it.acessorios_ok} onChange={(v) => set({ acessorios_ok: v })} />
          <TriToggle label="Caixa original?" value={it.caixa_original} onChange={(v) => set({ caixa_original: v })} />
          {podeDispensarTeste && (
            <button onClick={marcarSemTeste}
              className="mt-2 mb-1 w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-gray-600 border border-gray-300 bg-gray-50 rounded-lg py-2">
              Não vou testar → marcar como “Usado sem teste”
            </button>
          )}

          {/* Classificação sugerida (condição + valor + volume) */}
          <div className="mt-2 mb-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-gray-500">Classe sugerida</span>
              <span className="text-xs text-gray-400">
                Atual:{" "}
                {it.classe
                  ? <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${CLASSE_STYLE[it.classe] || "bg-gray-200 text-gray-700"}`}>{it.classe}</span>
                  : "—"}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {sugestaoClasse.classe
                  ? <span className={`px-2 py-1 rounded-lg text-sm font-bold ${CLASSE_STYLE[sugestaoClasse.classe] || "bg-gray-200 text-gray-700"}`}>{sugestaoClasse.classe}</span>
                  : <span className="text-sm text-gray-400 font-semibold">—</span>}
                <span className="text-xs text-gray-500 truncate">{sugestaoClasse.motivo}</span>
              </div>
              {sugestaoClasse.classe && sugestaoClasse.classe !== it.classe && (
                <button onClick={aplicarClasse}
                  className="flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-bold text-white bg-gray-900 rounded-lg px-3 py-1.5">
                  <Check className="w-3.5 h-3.5" /> Aplicar
                </button>
              )}
            </div>
            {sugestaoClasse.classe && !it.destino && !it.canal_principal && (
              <p className="mt-1.5 text-[11px] text-gray-400">
                Aplicar também sugere destino <b>{sugestaoClasse.destino}</b> e canal <b>{sugestaoClasse.canal}</b> (campos vazios).
              </p>
            )}
          </div>
        </div>

        {/* Dados para venda (integrações) — Tier 1 */}
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-2 mb-4 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 pt-2 pb-1 flex items-center gap-1.5">
            <Barcode className="w-3.5 h-3.5" /> Dados para venda
          </h3>
          <Field label="Nome do produto">
            <input className={inputCls} value={it.produto ?? ""} onChange={(e) => set({ produto: e.target.value })}
              placeholder="Descrição do produto" />
            {(it.produto || "").trim().toUpperCase().startsWith("A CATALOGAR") && (
              <p className="text-xs text-amber-600 mt-1 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Item ainda não catalogado — dê um nome para avançar na triagem.
              </p>
            )}
          </Field>
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
            <Field label={<>Marca<IaTag on={iaFez("marca")} /></>}><input className={inputCls} value={it.marca ?? ""} onChange={(e) => set({ marca: e.target.value })} placeholder="ex.: Britânia" /></Field>
            <Field label={<>Modelo<IaTag on={iaFez("modelo")} /></>}><input className={inputCls} value={it.modelo ?? ""} onChange={(e) => set({ modelo: e.target.value })} placeholder="ex.: BFR-2000" /></Field>
          </div>
          <Field label={<>Categoria<IaTag on={iaFez("grupo")} /></>}>
            <CategoriaPicker value={it.grupo || ""} onChange={(g) => set({ grupo: g })} grupos={catList} sugestao={sugCat} />
          </Field>
          <Field label={<>Voltagem<IaTag on={iaFez("voltagem")} /></>}>
            <div className="flex flex-wrap gap-1.5">
              {VOLTAGENS.map((v) => (
                <button key={v} onClick={() => set({ voltagem: it.voltagem === v ? null : v })}
                  className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold border ${it.voltagem === v ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-300"}`}>{v}</button>
              ))}
            </div>
          </Field>
          <Field label={<>Cor<IaTag on={iaFez("cor")} /></>}><input className={inputCls} value={it.cor ?? ""} onChange={(e) => set({ cor: e.target.value })} placeholder="ex.: Preto" /></Field>
          {/cal[çc]ado/i.test(it.grupo || "") && (
            <Field label="Tamanho / numeração (opcional)">
              <input className={inputCls} value={it.tamanho ?? ""} onChange={(e) => set({ tamanho: e.target.value })} placeholder="ex.: 42, 38 BR, M" />
            </Field>
          )}
        </div>

        {/* Dimensões & peso — pré-carregados, confirmar. Rastreia se foi medido ou só estimado. */}
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-2 mb-4 shadow-sm">
          <div className="flex items-center justify-between pt-2 pb-1">
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">Dimensões & peso<IaTag on={iaFez("dimensoes")} /></h3>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${fonteLabel(it).cls}`}>{fonteLabel(it).texto}</span>
          </div>
          <p className="text-xs text-gray-400 mb-1">Digitar = medido. Sem balança/trena? Use a estimativa e deixe p/ medir depois (afeta o frete).</p>
          <div className="grid grid-cols-4 gap-2">
            <Field label="Comp cm"><input type="number" inputMode="decimal" className={inputCls} value={it.comprimento_cm ?? ""} onChange={(e) => setMedida({ comprimento_cm: e.target.value })} /></Field>
            <Field label="Larg cm"><input type="number" inputMode="decimal" className={inputCls} value={it.largura_cm ?? ""} onChange={(e) => setMedida({ largura_cm: e.target.value })} /></Field>
            <Field label="Alt cm"><input type="number" inputMode="decimal" className={inputCls} value={it.altura_cm ?? ""} onChange={(e) => setMedida({ altura_cm: e.target.value })} /></Field>
            <Field label="Peso kg"><input type="number" inputMode="decimal" className={inputCls} value={it.peso_real_kg ?? ""} onChange={(e) => setMedida({ peso_real_kg: e.target.value })} /></Field>
          </div>
          <div className="flex flex-wrap gap-2 pb-2">
            <button onClick={estimarCategoria} disabled={!it.grupo || estimando}
              className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 bg-gray-100 rounded-lg px-3 py-1.5 disabled:opacity-40"
              title={it.grupo ? "Preencher pela média da categoria" : "Defina a categoria primeiro"}>
              {estimando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ruler className="w-3.5 h-3.5" />} Estimar pela categoria
            </button>
            <button onClick={() => set({ medidas_fonte: MEDIDAS_FONTE.A_MEDIR })}
              className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 rounded-lg px-3 py-1.5">
              Marcar p/ medir depois
            </button>
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

        {/* Publicar em marketplace (Amazon) — após revisão; gate de preço/GTIN no PublishPanel */}
        <PublishPanel item={it} />

        {/* Venda — detalhe da venda real (a partir de Triado, p/ vendas diretas) p/ apurar o lucro líquido */}
        {statusIdx(it.status) >= statusIdx("TRIADO") && (
          <div className="bg-white rounded-2xl border border-gray-200 px-4 py-2 mb-4 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 pt-2 pb-1 flex items-center gap-1.5">
              <Receipt className="w-3.5 h-3.5" /> Venda
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Valor vendido (R$)">
                <input type="number" inputMode="decimal" className={inputCls} value={it.valor_vendido ?? ""}
                  onChange={(e) => set({ valor_vendido: e.target.value })} placeholder="bruto recebido" />
              </Field>
              <Field label="Canal da venda">
                <select className={inputCls} value={it.canal_venda || ""}
                  onChange={(e) => set({ canal_venda: e.target.value || null })}>
                  <option value="">Selecione…</option>
                  {CANAIS_VENDA.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Taxa / comissão (R$)">
                <input type="number" inputMode="decimal" className={inputCls} value={it.taxa_venda ?? ""}
                  onChange={(e) => set({ taxa_venda: e.target.value })} placeholder="0" />
              </Field>
              <Field label="Frete pago (R$)">
                <input type="number" inputMode="decimal" className={inputCls} value={it.frete_pago ?? ""}
                  onChange={(e) => set({ frete_pago: e.target.value })} placeholder="0" />
              </Field>
              <Field label="Comprador">
                <input className={inputCls} value={it.comprador ?? ""}
                  onChange={(e) => set({ comprador: e.target.value })} placeholder="nome / usuário" />
              </Field>
              <Field label="Nº do pedido">
                <input className={inputCls} value={it.pedido_ref ?? ""}
                  onChange={(e) => set({ pedido_ref: e.target.value })} placeholder="ref. no canal" />
              </Field>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 mt-1 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Lucro líquido da venda</span>
              <span className={`text-base font-bold ${lucroVenda != null && lucroVenda < 0 ? "text-red-600" : "text-emerald-600"}`}>
                {lucroVenda == null ? "—" : fmtBRL(lucroVenda)}
              </span>
            </div>
            {it.valor_vendido && custoItem == null && (
              <p className="text-[11px] text-amber-600 flex items-center gap-1 pb-2">
                <AlertTriangle className="w-3 h-3" /> Custo do lote não carregado — lucro sem o custo do item.
              </p>
            )}
          </div>
        )}

        {/* Diagnóstico de anúncio — prontidão por canal */}
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3 mb-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Diagnóstico de anúncio
            </h3>
            {diagnosticarPorCanal(it).some((c) => c.faltando.length > 0) && (
              <button onClick={() => enriquecer(false)} disabled={!!iaLoading}
                className="text-xs font-semibold text-violet-700 disabled:opacity-50">Completar com IA</button>
            )}
          </div>
          <div className="space-y-1.5">
            {diagnosticarPorCanal(it).map((c) => (
              <div key={c.canal} className="flex items-start gap-2 text-sm">
                {c.pronto
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                  : <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <span className="font-semibold text-gray-800">{c.canal}</span>
                  {c.pronto
                    ? <span className="text-emerald-600 text-xs ml-1">pronto</span>
                    : <span className="text-gray-500 text-xs"> — falta: {c.faltando.join(", ")}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Observações */}
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-2 mb-4 shadow-sm">
          <Field label="Observações"><textarea className={inputCls} rows={2} value={it.obs ?? ""} onChange={(e) => set({ obs: e.target.value })} placeholder="Detalhes, defeitos, nº de série…" /></Field>
        </div>

        <button onClick={desmembrar} className="w-full flex items-center justify-center gap-2 text-gray-700 border border-gray-300 bg-white rounded-xl py-3 text-sm font-semibold mb-2">
          <Layers className="w-4 h-4" /> Desmembrar em várias unidades
        </button>

        {statusIdx(it.status) >= statusIdx("TRIADO") && statusIdx(it.status) < statusIdx("VENDIDO") && it.status !== "DESCARTE" && (
          <button onClick={venderDireto} className="w-full flex items-center justify-center gap-2 text-emerald-700 border border-emerald-200 bg-emerald-50 rounded-xl py-3 text-sm font-semibold mb-2">
            <Receipt className="w-4 h-4" /> Marcar como vendido (venda direta)
          </button>
        )}

        <button onClick={() => salvar("DESCARTE")} className="w-full flex items-center justify-center gap-2 text-red-600 border border-red-200 bg-red-50 rounded-xl py-3 text-sm font-semibold">
          <Trash2 className="w-4 h-4" /> Marcar como descarte / sucata
        </button>
      </div>

      <div className="absolute bottom-0 inset-x-0 bg-white border-t border-gray-200 px-4 py-3 shadow-lg">
        {gate && <p className="text-xs text-amber-700 flex items-center gap-1.5 mb-2"><AlertTriangle className="w-3.5 h-3.5" /> {gate}</p>}
        <div className="flex gap-2">
          {prev && (
            <button onClick={voltarEtapa} title={`Voltar para ${prev.label}`} aria-label={`Voltar para ${prev.label}`}
              className="rounded-xl py-3.5 px-3 font-semibold border border-gray-300 text-gray-600 bg-white flex items-center justify-center">
              <Undo2 className="w-4 h-4" />
            </button>
          )}
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
      {anuncio && (
        <Suspense fallback={<div className="fixed inset-0 z-[75] bg-white flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>}>
          <AnuncioModal item={it} onClose={() => setAnuncio(false)} />
        </Suspense>
      )}

      {qrCelular && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-6" onClick={() => setQrCelular(null)}>
          <div className="bg-white rounded-2xl p-5 max-w-xs w-full text-center" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-800 flex items-center gap-1.5"><Smartphone className="w-4 h-4 text-orange-500" /> Abrir no celular</h3>
              <button onClick={() => setQrCelular(null)} aria-label="Fechar"><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            {qrCelular.data
              ? <img src={qrCelular.data} alt="QR para abrir no celular" className="w-56 h-56 mx-auto" />
              : <div className="w-56 h-56 mx-auto flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>}
            <p className="text-sm text-gray-700 mt-3 leading-snug">
              Aponte a câmera do celular para este QR. Ele abre <b>esta mesma ficha</b> ({it.sku}) no celular para você adicionar as fotos.
            </p>
            <p className="text-[11px] text-gray-400 mt-2 break-all">{qrCelular.url}</p>
            <p className="text-[11px] text-gray-400 mt-2">O celular precisa estar logado no app.</p>
          </div>
        </div>
      )}
    </div>
  );
}
