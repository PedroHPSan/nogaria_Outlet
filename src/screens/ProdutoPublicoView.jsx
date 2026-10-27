import React, { useEffect, useState } from "react";
import { buscarCatalogoPublico, registrarVisualizacao } from "../lib/catalogoPublico";
import { skusIndisponiveis } from "../lib/ofertaPublica";
import { linkInteresseOferta } from "../lib/ofertaCore";
import { EMPRESA } from "../lib/empresa";
import { fmtBRL } from "../lib/model";
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

  useEffect(() => {
    let vivo = true;
    buscarCatalogoPublico(slug).then(async (d) => {
      if (!vivo) return;
      if (!d || !Array.isArray(d.payload?.itens)) { setEstado("indisponivel"); return; }
      setDados(d); setEstado("ok");
      registrarVisualizacao(slug);
      const v = await skusIndisponiveis(d.payload.itens.map((i) => i.sku));
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

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#0b162d] text-white px-4 py-3 text-sm font-bold">Nogária Outlet</header>
      <main className="max-w-xl mx-auto p-4 space-y-4">
        {p.itens.length > 1 && <h1 className="text-lg font-extrabold text-gray-900">{p.titulo}</h1>}
        {p.itens.map((it) => {
          const vendido = vendidos.includes(it.sku);
          return (
            <article key={it.sku} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              {it.foto && <img src={it.foto} alt={it.produto} loading="lazy" className="w-full aspect-square object-contain bg-gray-50" />}
              <div className="p-4 space-y-2">
                {it.badge && <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full ${BADGE_CLS[it.badge.cls] || BADGE_CLS.asis}`}>{it.badge.txt}</span>}
                <h2 className="font-bold text-gray-900">{it.produto}</h2>
                {it.preco > 0 && <p className="text-3xl font-extrabold text-[#02477e]">{fmtBRL(it.preco)}</p>}
                {it.condicao && <p className="text-sm text-gray-600">{it.condicao}</p>}
                <p className="text-xs text-gray-500">{[it.marca, it.medidas, it.cor].filter(Boolean).join(" · ")}</p>
                {vendido ? (
                  <p className="rounded-xl bg-gray-100 text-gray-500 text-center py-3 font-bold">Vendido</p>
                ) : (
                  <a href={linkInteresseOferta(it, numero, url)} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white py-3 font-bold">
                    <MessageCircle className="w-5 h-5" /> Quero este
                  </a>
                )}
              </div>
            </article>
          );
        })}
        <p className="text-center text-xs text-gray-400">Preços e disponibilidade sujeitos a alteração. Peças de outlet, com condição descrita.</p>
      </main>
    </div>
  );
}
