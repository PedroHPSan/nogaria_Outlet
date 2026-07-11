import React, { useEffect, useState } from "react";
import { buscarCatalogoPublico } from "../lib/catalogoPublico";
import { fmtBRL } from "../lib/model";
import { Loader2, Boxes } from "lucide-react";

// Selos de condição → cor (mesma paleta da galeria interna).
const BADGE_CLS = {
  novo: "bg-emerald-100 text-emerald-700",
  aberta: "bg-amber-100 text-amber-700",
  semi: "bg-sky-100 text-sky-700",
  asis: "bg-gray-200 text-gray-700",
};

// Página PÚBLICA (sem login) de um catálogo compartilhado. Lê só o snapshot do
// slug; renderiza a partir do payload autocontido.
export default function CatalogoPublicoView({ slug }) {
  const [estado, setEstado] = useState("carregando"); // carregando | ok | indisponivel
  const [dados, setDados] = useState(null);

  useEffect(() => {
    let vivo = true;
    buscarCatalogoPublico(slug).then((d) => {
      if (!vivo) return;
      if (!d) { setEstado("indisponivel"); return; }
      setDados(d); setEstado("ok");
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
        <p className="text-gray-700 font-bold">Catálogo indisponível</p>
        <p className="text-sm text-gray-500 mt-1">Este link expirou ou não existe. Peça um novo à Nogária Outlet.</p>
      </div>
    );
  }

  const p = dados.payload;
  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      <header className="bg-gray-900 text-white px-4 py-4 sticky top-0 z-10">
        <h1 className="text-lg font-bold"><span className="text-orange-400">NOGÁRIA</span> OUTLET</h1>
        <p className="text-sm text-gray-200">{p.titulo}{p.edicao ? ` · ${p.edicao}` : ""}</p>
        {p.subtitulo && <p className="text-xs text-gray-400 mt-0.5">{p.subtitulo}</p>}
      </header>
      <div className="px-4 pt-4 space-y-5 max-w-3xl mx-auto">
        {p.secoes.map((sec, si) => (
          <section key={si}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-bold bg-gray-900 text-white rounded-lg px-2.5 py-1">{sec.titulo}</span>
              <span className="text-xs text-gray-400">{sec.cards.length} {sec.cards.length === 1 ? "item" : "itens"}</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
              {sec.cards.map((c, ci) => (
                <div key={ci} className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
                  <div className="aspect-square bg-gray-100 relative">
                    {c.foto ? (
                      <img src={c.foto} alt="" loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">sem foto</div>
                    )}
                    {c.badge && <span className={`absolute top-1.5 left-1.5 inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold ${BADGE_CLS[c.badge.cls] || "bg-white/90 text-gray-700"}`}>{c.badge.txt}</span>}
                    {c.qtd > 1 && <span className="absolute top-1.5 right-1.5 bg-black/60 text-white rounded-full px-2 py-0.5 text-[9px] font-bold">{c.qtd}un</span>}
                  </div>
                  <div className="p-2 flex-1 flex flex-col">
                    <p className="text-xs font-bold text-gray-900 leading-tight line-clamp-2">{c.produto}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5 truncate">{[c.marca, c.cor].filter(Boolean).join(" · ") || "—"}</p>
                    {p.mostrarPreco && c.preco != null && (
                      <p className="text-sm font-extrabold text-emerald-600 mt-auto pt-1">{fmtBRL(c.preco)}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
        <footer className="text-center text-xs text-gray-400 pt-4">NOGÁRIA OUTLET · {p.totalItens} {p.totalItens === 1 ? "item" : "itens"}</footer>
      </div>
    </div>
  );
}
