// Catálogo rápido: gera o PDF de catálogo a partir de uma seleção (skus) ou de
// uma sala (salaId), sem passar pelos filtros da aba Catálogo. Só entram itens
// com preço de venda, condição mapeada e em estoque (regra do catálogo).
import React, { useEffect, useRef, useState } from "react";
import { X, Loader2, Printer, AlertTriangle, Share2, Download, Link2, MessageCircle, Instagram, FileSpreadsheet } from "lucide-react";
import { listarItensCatalogo, resumoSelecao } from "../lib/catalogo";
import { gerarCatalogoDeItens, gerarCatalogoPdfDeItens, gerarCardsDivulgacao } from "../lib/catalogoGerar";
import { compartilharArquivo, compartilharArquivos, compartilharTexto, baixarArquivo } from "../lib/compartilhar";
import { dedupCatalogo, agruparCatalogo, linkInteresseItem } from "../lib/catalogo";
import { publicarCatalogo } from "../lib/catalogoPublico";
import { textoWhatsApp, textoInstagram, csvCatalogo } from "../lib/divulgacao";
import { FORMATOS } from "../lib/cardCore";
import { normalizarSpec } from "../lib/catalogoSpec";
import { MODELOS, TEMAS } from "../lib/catalogoSpec";
import { imprimirPortfolio } from "../lib/portfolio";

const edicaoAtual = () =>
  new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

export default function CatalogoRapidoModal({ skus, salaId, titulo: tituloInicial = "Catálogo de Produtos", onClose }) {
  const [itens, setItens] = useState(null);
  const [resumo, setResumo] = useState(null);
  const [erro, setErro] = useState(null);
  const [titulo, setTitulo] = useState(tituloInicial);
  const [comFoto, setComFoto] = useState(true);
  const [mostrarPreco, setMostrarPreco] = useState(true);
  const [comQr, setComQr] = useState(true);
  const [modelo, setModelo] = useState("catalogo");
  const [tema, setTema] = useState("noite");
  const [colunas, setColunas] = useState(2);
  const [contatoNome, setContatoNome] = useState("");
  const [validade, setValidade] = useState("");
  const [aviso, setAviso] = useState(null);
  const [formatoCard, setFormatoCard] = useState("feed");
  const [link, setLink] = useState(null);
  const [gerando, setGerando] = useState(false);
  const [progresso, setProgresso] = useState(null);
  const abortRef = useRef(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const lista = await listarItensCatalogo(salaId ? { salaId } : { skus });
        if (cancel) return;
        setItens(lista);
        if (skus) setResumo(resumoSelecao(skus, lista));
      } catch (e) {
        if (!cancel) setErro(e.message || "Falha ao carregar os itens.");
      }
    })();
    return () => { cancel = true; };
  }, [skus, salaId]);

  const gerar = async () => {
    if (!itens?.length) return;
    setGerando(true);
    setErro(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const html = await gerarCatalogoDeItens(itens, {
        titulo, edicao: edicaoAtual(), comFoto, mostrarPreco, comQr,
        signal: ctrl.signal, onProgress: setProgresso,
      });
      await imprimirPortfolio(html);
    } catch (e) {
      if (e?.message !== "cancelado") setErro(e.message || "Falha ao gerar o catálogo.");
    } finally {
      abortRef.current = null;
      setProgresso(null);
      setGerando(false);
    }
  };

  // PDF como ARQUIVO (jsPDF): compartilha (WhatsApp etc.) ou baixa.
  const gerarPdf = async (acao) => {
    if (!itens?.length) return;
    setGerando(true); setErro(null); setAviso(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const { blob, resumo: r } = await gerarCatalogoPdfDeItens(itens, {
        modelo, tema, colunas, titulo, edicao: edicaoAtual(), validade,
        campos: { foto: modelo === "lista" ? comFoto : comFoto, preco: mostrarPreco, qr: comQr },
        contato: { nome: contatoNome },
      }, { signal: ctrl.signal, onProgress: setProgresso });
      const nome = `${(titulo || "catalogo").replace(/[^\w]+/g, "_").slice(0, 40)}.pdf`;
      const mb = (blob.size / 1048576).toFixed(1);
      if (acao === "baixar") { baixarArquivo(blob, nome); setAviso(`PDF baixado · ${r.paginas} páginas · ${mb} MB`); }
      else {
        const res = await compartilharArquivo(blob, nome, { titulo });
        if (res !== "cancelado") setAviso(`${res === "baixado" ? "PDF baixado" : "PDF compartilhado"} · ${r.paginas} páginas · ${mb} MB`);
      }
    } catch (e) {
      if (e?.message !== "cancelado") setErro(e.message || "Falha ao gerar o PDF.");
    } finally {
      abortRef.current = null; setProgresso(null); setGerando(false);
    }
  };

  // ── Divulgação: tudo a partir dos MESMOS itens/contato/validade do catálogo ──
  const contato = () => normalizarSpec({ contato: { nome: contatoNome } }).contato;
  const rotuloContato = () => { const c = contato(); return [c.nome, c.whatsappLabel].filter(Boolean).join(" · "); };
  const executar = async (fn) => {
    setGerando(true); setErro(null); setAviso(null);
    const ctrl = new AbortController(); abortRef.current = ctrl;
    try { await fn(ctrl.signal); }
    catch (e) { if (e?.message !== "cancelado") setErro(e.message || "Falha ao gerar."); }
    finally { abortRef.current = null; setProgresso(null); setGerando(false); }
  };

  const gerarLinkPublico = () => executar(async () => {
    const secoes = agruparCatalogo(dedupCatalogo(itens), "categoria");
    const c = contato();
    const res = await publicarCatalogo(secoes, { titulo, edicao: edicaoAtual(), comFoto, mostrarPreco, contato: { nome: c.nome, whatsapp: c.whatsapp, label: c.whatsappLabel, extras: c.extras } });
    setLink(res.url);
    try { await navigator.clipboard.writeText(res.url); } catch { /* sem clipboard */ }
    setAviso("Link copiado (vale 30 dias).");
  });

  const textoWpp = () => executar(async () => {
    const msg = textoWhatsApp(itens, { titulo, link, validade, contato: rotuloContato(), mostrarPreco });
    const r = await compartilharTexto(msg, titulo);
    setAviso(r === "copiado" ? "Texto copiado — cole no WhatsApp." : r === "compartilhado" ? "Compartilhado." : null);
  });

  const legendaIg = () => executar(async () => {
    await navigator.clipboard.writeText(textoInstagram(itens, { titulo, validade, contato: rotuloContato(), mostrarPreco }));
    setAviso("Legenda copiada (≤ 2.200 caracteres, com hashtags).");
  });

  const cardsPng = () => executar(async (signal) => {
    const c = contato();
    const arqs = await gerarCardsDivulgacao(itens, { formato: formatoCard, titulo, tema, contato: { nome: c.nome, whatsapp: c.whatsapp, whatsappLabel: c.whatsappLabel }, mostrarPreco }, { signal, onProgress: setProgresso });
    const r = await compartilharArquivos(arqs, { titulo });
    if (r !== "cancelado") setAviso(`${arqs.length} imagens ${r === "baixado" ? "baixadas" : "compartilhadas"}.`);
  });

  const baixarCsv = () => executar(async () => {
    const blob = new Blob([csvCatalogo(itens, { linkDe: (it) => linkInteresseItem(it, contato().whatsapp) })], { type: "text/csv;charset=utf-8" });
    baixarArquivo(blob, "catalogo-nogaria.csv");
    setAviso("CSV baixado (nome, preço, descrição, código, link).");
  });

  const fechar = () => { abortRef.current?.abort(); onClose(); };

  const Opcao = ({ valor, onChange, children }) => (
    <label className="flex items-center gap-2 text-sm text-gray-700">
      <input type="checkbox" checked={valor} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 accent-orange-500" />
      {children}
    </label>
  );

  return (
    <div className="fixed inset-0 z-[75] bg-black/50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl p-4 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Catálogo em PDF</h2>
          <button onClick={fechar} aria-label="Fechar"><X className="w-6 h-6 text-gray-400" /></button>
        </div>

        {!itens && !erro && (
          <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando itens…</p>
        )}

        {itens && (
          <>
            <p className="text-sm text-gray-700">
              <b>{itens.length}</b> {itens.length === 1 ? "item entra" : "itens entram"} no catálogo.
            </p>
            {resumo?.fora.length > 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 flex gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{resumo.fora.length} ficou de fora (sem preço de venda, sem condição ou fora de estoque): {resumo.fora.slice(0, 8).join(", ")}{resumo.fora.length > 8 ? "…" : ""}</span>
              </p>
            )}
            {itens.length === 0 && (
              <p className="text-sm text-gray-500">Nenhum item elegível. O catálogo exige preço de venda e condição definidos.</p>
            )}

            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título do catálogo"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            <div className="space-y-1.5">
              <Opcao valor={comFoto} onChange={setComFoto}>Incluir fotos</Opcao>
              <Opcao valor={mostrarPreco} onChange={setMostrarPreco}>Mostrar preço</Opcao>
              <Opcao valor={comQr} onChange={setComQr}>QR de WhatsApp em cada item</Opcao>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <select value={modelo} onChange={(e) => setModelo(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-2 text-sm">
                {MODELOS.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
              </select>
              <select value={tema} onChange={(e) => setTema(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-2 text-sm">
                {Object.entries(TEMAS).map(([id, t]) => <option key={id} value={id}>Tema {t.nome}</option>)}
              </select>
              {modelo === "catalogo" && (
                <select value={colunas} onChange={(e) => setColunas(Number(e.target.value))} className="rounded-lg border border-gray-300 px-2 py-2 text-sm">
                  <option value={2}>2 colunas</option><option value={3}>3 colunas</option>
                </select>
              )}
              <input value={validade} onChange={(e) => setValidade(e.target.value)} placeholder="Preços válidos até (dd/mm)" className="rounded-lg border border-gray-300 px-2 py-2 text-sm" />
              <input value={contatoNome} onChange={(e) => setContatoNome(e.target.value)} placeholder="Nome do vendedor" className="col-span-2 rounded-lg border border-gray-300 px-2 py-2 text-sm" />
            </div>

            {progresso && <p className="text-xs text-gray-500">Comprimindo {progresso.feitas} de {progresso.total} fotos</p>}
            <div className="flex gap-2">
              <button onClick={() => gerarPdf("compartilhar")} disabled={gerando || !itens.length}
                className="flex-1 rounded-xl py-3 font-bold bg-orange-500 text-white flex items-center justify-center gap-2 disabled:bg-gray-300 disabled:text-gray-500">
                {gerando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
                {gerando ? "Gerando…" : "Compartilhar PDF"}
              </button>
              <button onClick={() => gerarPdf("baixar")} disabled={gerando || !itens.length} aria-label="Baixar PDF"
                className="rounded-xl px-4 border border-gray-300 text-gray-700 disabled:opacity-50"><Download className="w-4 h-4" /></button>
              <button onClick={gerar} disabled={gerando || !itens.length} aria-label="Imprimir"
                className="rounded-xl px-4 border border-gray-300 text-gray-700 disabled:opacity-50"><Printer className="w-4 h-4" /></button>
            </div>
            {aviso && <p className="text-xs text-emerald-700">{aviso}</p>}

            <div className="border-t border-gray-100 pt-3 space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Divulgar</p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={gerarLinkPublico} disabled={gerando || !itens.length} className="rounded-lg border border-gray-300 py-2 text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"><Link2 className="w-4 h-4" /> Link público</button>
                <button onClick={textoWpp} disabled={gerando || !itens.length} className="rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 py-2 text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"><MessageCircle className="w-4 h-4" /> Texto WhatsApp</button>
                <button onClick={legendaIg} disabled={gerando || !itens.length} className="rounded-lg border border-pink-200 bg-pink-50 text-pink-700 py-2 text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"><Instagram className="w-4 h-4" /> Legenda Instagram</button>
                <button onClick={baixarCsv} disabled={gerando || !itens.length} className="rounded-lg border border-gray-300 py-2 text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"><FileSpreadsheet className="w-4 h-4" /> CSV</button>
              </div>
              <div className="flex gap-2">
                <select value={formatoCard} onChange={(e) => setFormatoCard(e.target.value)} className="flex-1 rounded-lg border border-gray-300 px-2 py-2 text-sm">
                  {Object.entries(FORMATOS).map(([id, f]) => <option key={id} value={id}>{f.nome}</option>)}
                </select>
                <button onClick={cardsPng} disabled={gerando || !itens.length} className="rounded-lg bg-gray-900 text-white px-3 py-2 text-sm font-bold disabled:opacity-50">Cards (PNG)</button>
              </div>
              {link && <p className="text-xs text-gray-500 break-all">{link}</p>}
            </div>
          </>
        )}

        {erro && <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {erro}</p>}
      </div>
    </div>
  );
}
