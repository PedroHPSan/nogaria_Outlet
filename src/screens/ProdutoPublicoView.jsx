import React, { useEffect, useState } from "react";
import { buscarCatalogoPublico, registrarVisualizacao } from "../lib/catalogoPublico";
import { skusIndisponiveis } from "../lib/ofertaPublica";
import { linkInteresseOferta, linkWa } from "../lib/ofertaCore";
import { EMPRESA } from "../lib/empresa";
import { fmtBRL } from "../lib/model";
import { cotacaoEuro } from "../lib/cotacao";
import { precoMisto, fmtEUR, textoCotacao, mensagemInteresseEuro, idiomaDoNavegador, IDIOMAS, T } from "../lib/precoEuro";
import { Loader2, Boxes, MessageCircle } from "lucide-react";

const BADGE_CLS = {
  novo: "bg-emerald-100 text-emerald-700",
  aberta: "bg-amber-100 text-amber-700",
  semi: "bg-sky-100 text-sky-700",
  asis: "bg-gray-200 text-gray-700",
};

// Página PÚBLICA (sem login) de uma oferta: 1 produto (destaque) ou vários (grade).
// Renderiza só do snapshot do slug; "Quero este" abre o WhatsApp da Nogária.
export default function ProdutoPublicoView({ slug }) {
  const [estado, setEstado] = useState("carregando"); // carregando | ok | indisponivel
  const [dados, setDados] = useState(null);
  const [vendidos, setVendidos] = useState([]);
  const [lang, setLang] = useState(idiomaDoNavegador);
  const [confirmar, setConfirmar] = useState(null); // { item, cotacao } — pedido em confirmação (cotação recalculada)
  const [cotacao, setCotacao] = useState(null); // modo euro: cotação buscada a cada abertura do link

  useEffect(() => {
    let vivo = true;
    buscarCatalogoPublico(slug).then(async (d) => {
      if (!vivo) return;
      if (!d || !Array.isArray(d.payload?.itens)) { setEstado("indisponivel"); return; }
      setDados(d); setEstado("ok");
      registrarVisualizacao(slug);
      if (d.payload.euro) cotacaoEuro({ forcar: true }).then((c) => vivo && setCotacao(c)).catch(() => vivo && setCotacao(false));
      const v = await skusIndisponiveis(slug);
      if (vivo) setVendidos(v);
    });
    return () => { vivo = false; };
  }, [slug]);

  if (estado === "carregando") {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>;
  }
  if (estado === "indisponivel") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 text-center px-8">
        <Boxes className="w-12 h-12 text-gray-300 mb-3" />
        <p className="text-gray-700 font-bold">Oferta indisponível</p>
        <p className="text-sm text-gray-500 mt-1">Este link expirou ou não existe. Chame a Nogária Outlet para ver as ofertas do dia.</p>
      </div>
    );
  }

  const p = dados.payload;
  const numero = p.contato?.whatsapp || EMPRESA.whatsapp;
  const url = window.location.href;
  const euro = !!p.euro;
  const t = T[lang];

  // "Quero este": recalcula a cotação NESTE momento e mostra o valor final antes de abrir o WhatsApp.
  const abrirConfirmacao = async (item) => {
    setConfirmar({ item, cotacao: undefined });
    try { const c = await cotacaoEuro({ forcar: true }); setCotacao(c); setConfirmar({ item, cotacao: c }); }
    catch { setConfirmar({ item, cotacao: null }); }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#0b162d] text-white px-4 py-3 text-sm font-bold flex items-center justify-between">
        Nogária Outlet
        {euro && (
          <span className="flex gap-1">
            {IDIOMAS.map((l) => (
              <button key={l} onClick={() => setLang(l)} className={`px-2 py-0.5 rounded text-xs uppercase ${l === lang ? "bg-white text-[#0b162d]" : "bg-white/10"}`}>{l}</button>
            ))}
          </span>
        )}
      </header>
      <main className="max-w-xl mx-auto p-4 space-y-4">
        {p.itens.length > 1 && <h1 className="text-lg font-extrabold text-gray-900">{p.titulo}</h1>}
        {p.itens.map((it) => {
          const vendido = vendidos.includes(it.sku);
          const misto = euro && it.preco > 0 ? precoMisto(it.preco, cotacao?.taxa) : null;
          return (
            <article key={it.sku} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              {it.foto && <img src={it.foto} alt={it.produto} loading="lazy" className="w-full aspect-square object-contain bg-gray-50" />}
              <div className="p-4 space-y-2">
                {it.badge && <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full ${BADGE_CLS[it.badge.cls] || BADGE_CLS.asis}`}>{it.badge.txt}</span>}
                <h2 className="font-bold text-gray-900">{it.produto}</h2>
                {it.preco > 0 && !euro && <p className="text-3xl font-extrabold text-[#02477e]">{fmtBRL(it.preco)}</p>}
                {misto && (
                  <div>
                    {misto.eur
                      ? <p className="text-3xl font-extrabold text-[#02477e]">{fmtEUR(misto.eur)}</p>
                      : <Loader2 className="w-6 h-6 animate-spin text-gray-400" />}
                    <p className="text-lg font-bold text-gray-700">{fmtBRL(misto.brl)}</p>
                  </div>
                )}
                {it.condicao && <p className="text-sm text-gray-600">{it.condicao}</p>}
                <p className="text-xs text-gray-500">{[it.marca, it.medidas, it.cor].filter(Boolean).join(" · ")}</p>
                {vendido ? (
                  <p className="rounded-xl bg-gray-100 text-gray-500 text-center py-3 font-bold">{euro ? t.vendido : "Vendido"}</p>
                ) : (
                  euro && it.preco > 0 ? (
                    <button onClick={() => abrirConfirmacao(it)}
                      className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white py-3 font-bold">
                      <MessageCircle className="w-5 h-5" /> {t.quero}
                    </button>
                  ) : (
                    <a href={linkInteresseOferta(it, numero, url)} target="_blank" rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white py-3 font-bold">
                      <MessageCircle className="w-5 h-5" /> Quero este
                    </a>
                  )
                )}
              </div>
            </article>
          );
        })}
        {euro && (
          <p className="rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs p-3">
            {cotacao ? `${textoCotacao(cotacao, lang)}. ` : cotacao === false ? `${t.falhou} ` : `${t.buscando} `}
            {t.atualiza}
          </p>
        )}
        <p className="text-center text-xs text-gray-400">{euro ? t.rodape : "Preços e disponibilidade sujeitos a alteração. Peças de outlet, com condição descrita."}</p>
        {confirmar && (() => {
          const m = precoMisto(confirmar.item.preco, confirmar.cotacao?.taxa);
          return (
            <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
              <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-3">
                <h3 className="font-extrabold text-gray-900">{t.confirmaTitulo}</h3>
                <p className="text-sm text-gray-700">{confirmar.item.produto}</p>
                {confirmar.cotacao === undefined ? <Loader2 className="w-6 h-6 animate-spin text-gray-400" /> : m?.eur ? (
                  <div>
                    {m.eur && <p className="text-3xl font-extrabold text-[#02477e]">{fmtEUR(m.eur)}</p>}
                    <p className="text-lg font-bold text-gray-700">{fmtBRL(m.brl)}</p>
                    <p className="text-xs text-gray-500 mt-1">{textoCotacao(confirmar.cotacao, lang)}</p>
                  </div>
                ) : <p className="text-sm text-red-600">{t.falhou}</p>}
                <p className="text-xs text-amber-800 bg-amber-50 rounded-lg p-2">{t.confirmaAviso}</p>
                {m?.eur && (
                  <a href={linkWa(numero, mensagemInteresseEuro(confirmar.item, confirmar.cotacao, url, lang))} target="_blank" rel="noopener noreferrer"
                    onClick={() => setConfirmar(null)}
                    className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white py-3 font-bold">
                    <MessageCircle className="w-5 h-5" /> {t.confirmar}
                  </a>
                )}
                <button onClick={() => setConfirmar(null)} className="w-full text-sm text-gray-500 py-2">{t.voltar}</button>
              </div>
            </div>
          );
        })()}
      </main>
    </div>
  );
}
