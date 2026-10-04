import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react";
import { Loader2, Search, Filter, Boxes, BookOpen } from "lucide-react";
import { listarItensCatalogo, DESTINO_SEM, CATALOGO_ESTADO_BADGE } from "../lib/catalogo";
import { ordenarTamanhos, tamanhoLabel } from "../lib/portfolio";
import { precoVenda } from "../lib/export";
import { primeirasFotos } from "../lib/fotos";
import { listarCaixas } from "../lib/caixas";
import { fmtBRL, ALL_STATUS, DESTINOS, LOTE_SEM } from "../lib/model";

// Motor de catálogo único: o mesmo modal usado em Itens → Selecionar e em Salas.
const CatalogoRapidoModal = React.lazy(() => import("../components/CatalogoRapidoModal"));

const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base bg-white focus:outline-none focus:ring-2 focus:ring-orange-500";
const CLASSES = ["A+", "A", "B", "C", "D", "E"];
// Cor do selo de condição (rótulo de cliente) na galeria.
const BADGE_CLS = {
  novo: "bg-emerald-100 text-emerald-700",
  aberta: "bg-amber-100 text-amber-700",
  semi: "bg-sky-100 text-sky-700",
  asis: "bg-gray-200 text-gray-700",
};
// Catálogo de produtos: filtra com os mesmos filtros da aba Itens + filtro por
// caixa, mostra a galeria por item (tocável → abre a ficha) e gera o catálogo
// pelo motor novo (CatalogoRapidoModal): PDF, link público, textos e imagens.
export default function PortfolioScreen({ refreshKey, onOpen, user, params, lotes = [], onBarraAcao }) {
  // filtros (espelham o ItemsScreen) — aplicados no servidor
  const [q, setQ] = useState("");
  const [fLote, setFLote] = useState("");
  const [fClasse, setFClasse] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fGrupo, setFGrupo] = useState("");
  const [fDestino, setFDestino] = useState("");
  const [fCaixa, setFCaixa] = useState("");
  const [fPendMedida, setFPendMedida] = useState(false);
  const [fSemCaixa, setFSemCaixa] = useState(false);
  const [fSemEtiq, setFSemEtiq] = useState(false);
  const [fSemClasse, setFSemClasse] = useState(false);
  const [fSemFoto, setFSemFoto] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const [itens, setItens] = useState(null);     // resultado da busca (por item)
  const [fotos, setFotos] = useState({});       // { sku: url }
  const [loading, setLoading] = useState(true);
  const [caixas, setCaixas] = useState([]);
  const [catalogoAberto, setCatalogoAberto] = useState(false);
  const agrupar = "categoria"; // a galeria agrupa por categoria; o PDF tem o seu próprio agrupamento
  const debounce = useRef();

  const catList = useMemo(
    () => Object.keys(params?.grupos || {}).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [params]
  );

  // caixas para o dropdown (todas, abertas e fechadas)
  useEffect(() => { listarCaixas().then((cs) => setCaixas(cs || [])); }, [refreshKey]);

  const buscar = useCallback(async () => {
    setLoading(true);
    const lista = await listarItensCatalogo({
      q, lote: fLote, classe: fClasse, status: fStatus, grupo: fGrupo, destino: fDestino,
      caixaId: fCaixa, pendMedida: fPendMedida, semCaixa: fSemCaixa, semEtiq: fSemEtiq,
      semClasse: fSemClasse, semFoto: fSemFoto,
    });
    setItens(lista);
    setLoading(false);
    primeirasFotos(lista.map((i) => i.sku)).then(setFotos);
  }, [q, fLote, fClasse, fStatus, fGrupo, fDestino, fCaixa, fPendMedida, fSemCaixa, fSemEtiq, fSemClasse, fSemFoto]);

  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(buscar, 250);
    return () => clearTimeout(debounce.current);
  }, [buscar, refreshKey]);

  const nActive = [fLote, fClasse, fStatus, fGrupo, fDestino, fCaixa, fPendMedida, fSemCaixa, fSemEtiq, fSemClasse, fSemFoto].filter(Boolean).length;
  const limpar = () => {
    setFLote(""); setFClasse(""); setFStatus(""); setFGrupo(""); setFDestino(""); setFCaixa("");
    setFPendMedida(false); setFSemCaixa(false); setFSemEtiq(false); setFSemClasse(false); setFSemFoto(false);
  };

  // Agrupamento da galeria on-screen (por item; espelha as dimensões do PDF).
  const grupos = useMemo(() => {
    const lista = itens || [];
    const chaveDe = (it) =>
      agrupar === "tamanho" ? tamanhoLabel(it.tamanho)
      : agrupar === "lote" ? (it.lote != null ? String(it.lote) : "Sem lote")
      : agrupar === "marca" ? ((it.marca || "").trim() || "Sem marca")
      : ((it.grupo || "").trim() || "Sem categoria");
    const tituloDe = (k) => (agrupar === "tamanho" ? `Nº ${k}` : agrupar === "lote" && k !== "Sem lote" ? `Lote ${k}` : k);

    const mapa = new Map();
    for (const it of lista) {
      const k = chaveDe(it);
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(it);
    }
    let chaves = [...mapa.keys()];
    if (agrupar === "tamanho") chaves = ordenarTamanhos(chaves);
    else chaves.sort((a, b) => {
      const va = mapa.get(a).reduce((s, it) => s + (precoVenda(it) || 0), 0);
      const vb = mapa.get(b).reduce((s, it) => s + (precoVenda(it) || 0), 0);
      return vb - va;
    });
    return chaves.map((k) => ({ chave: k, titulo: tituloDe(k), itens: mapa.get(k) }));
  }, [itens, agrupar]);

  const total = itens?.length || 0;

  // Enquanto a barra de geração estiver visível, o App esconde os botões
  // flutuantes (mesmo canto — eles cobriam o botão "PDF").
  useEffect(() => {
    onBarraAcao?.(total > 0);
    return () => onBarraAcao?.(false);
  }, [total, onBarraAcao]);

  return (
    <div className="pb-28">
      {/* Barra de busca + filtros */}
      <div className="sticky top-14 z-10 bg-gray-50 px-4 pt-3 pb-2 border-b border-gray-200">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar SKU, produto, marca…"
              className="w-full rounded-xl border border-gray-300 pl-9 pr-3 py-2.5 text-base bg-white focus:outline-none focus:ring-2 focus:ring-orange-500" />
          </div>
          <button onClick={() => setShowFilters(!showFilters)}
            className={`px-3 rounded-xl border flex items-center gap-1 text-sm font-semibold ${nActive ? "bg-orange-500 text-white border-orange-500" : "bg-white border-gray-300 text-gray-600"}`}>
            <Filter className="w-4 h-4" />{nActive || ""}
          </button>
        </div>

        {showFilters && (
          <div className="mt-2 space-y-2">
            <select value={fLote} onChange={(e) => setFLote(e.target.value)} className={inputCls}>
              <option value="">Todos os lotes</option>
              <option value={LOTE_SEM}>Sem lote</option>
              {lotes.map((l) => <option key={l.lote} value={String(l.lote)}>Lote {l.lote} — {l.referencia || ""}</option>)}
            </select>
            <div className="flex gap-2">
              <select value={fClasse} onChange={(e) => setFClasse(e.target.value)} className={inputCls}>
                <option value="">Todas as classes</option>
                {CLASSES.map((c) => <option key={c} value={c}>Classe {c}</option>)}
              </select>
              <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={inputCls}>
                <option value="">Status (padrão)</option>
                {ALL_STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            {catList.length > 0 && (
              <select value={fGrupo} onChange={(e) => setFGrupo(e.target.value)} className={inputCls}>
                <option value="">Todas as categorias</option>
                {catList.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            )}
            <div className="flex gap-2">
              <select value={fDestino} onChange={(e) => setFDestino(e.target.value)} className={inputCls}>
                <option value="">Todos os destinos</option>
                <option value={DESTINO_SEM}>Sem destino</option>
                {DESTINOS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <select value={fCaixa} onChange={(e) => setFCaixa(e.target.value)} className={inputCls}>
                <option value="">Todas as caixas</option>
                {caixas.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo}{c.destino ? ` · ${c.destino}` : ""}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              {[
                ["Pendente medição", fPendMedida, setFPendMedida],
                ["Sem caixa", fSemCaixa, setFSemCaixa],
                ["Sem etiqueta", fSemEtiq, setFSemEtiq],
                ["Sem classe", fSemClasse, setFSemClasse],
                ["Sem foto", fSemFoto, setFSemFoto],
              ].map(([label, val, set]) => (
                <label key={label} className="flex items-center gap-2 text-gray-700">
                  <input type="checkbox" checked={val} onChange={(e) => set(e.target.checked)} className="w-4 h-4 accent-orange-500" />
                  {label}
                </label>
              ))}
            </div>
            {nActive > 0 && (
              <button onClick={limpar} className="text-sm font-semibold text-orange-600 active:text-orange-700">Limpar filtros</button>
            )}
          </div>
        )}
      </div>

      {/* Como usar */}
      <div className="px-4 pt-3">
        <p className="text-xs text-gray-500">
          Filtre os produtos, confira a galeria e toque em <b>Gerar catálogo</b>. Para escolher itens específicos, use <b>Itens → Selecionar</b>.
        </p>
      </div>

      {/* Galeria */}
      {loading || itens === null ? (
        <div className="py-16 text-center"><Loader2 className="w-7 h-7 animate-spin text-orange-500 mx-auto" /></div>
      ) : !total ? (
        <div className="text-center py-16 text-gray-400">
          <Boxes className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Nenhum produto pronto com esses filtros.</p>
          <p className="text-xs mt-1">O catálogo mostra produtos prontos: com <b>preço de venda</b> e <b>condição</b> definidos.</p>
        </div>
      ) : (
        <div className="px-4 pt-3 space-y-5">
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2">
            <Boxes className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <p className="text-xs text-emerald-800">
              <b>{total}</b> {total === 1 ? "produto pronto" : "produtos prontos"} para catálogo
              <span className="text-emerald-600"> · {grupos.length} {grupos.length === 1 ? "grupo" : "grupos"}</span>
            </p>
          </div>
          {grupos.map((g) => (
            <section key={g.chave}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-bold bg-gray-900 text-white rounded-lg px-2.5 py-1">{g.titulo}</span>
                <span className="text-xs text-gray-400">{g.itens.length} {g.itens.length === 1 ? "item" : "itens"}</span>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {g.itens.map((it) => {
                  const preco = precoVenda(it);
                  const badge = CATALOGO_ESTADO_BADGE[(it.estado || "").trim()];
                  return (
                    <button key={it.sku} onClick={() => onOpen?.(it)}
                      className="text-left bg-white rounded-xl border border-gray-200 overflow-hidden active:opacity-80 flex flex-col">
                      <div className="aspect-square bg-gray-100 relative">
                        {fotos[it.sku] ? (
                          <img src={fotos[it.sku]} alt="" loading="lazy" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">sem foto</div>
                        )}
                        {badge && <span className={`absolute top-1.5 left-1.5 inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold ${BADGE_CLS[badge.cls] || "bg-white/90 text-gray-700"}`}>{badge.txt}</span>}
                      </div>
                      <div className="p-2 flex-1 flex flex-col">
                        <p className="text-xs font-bold text-gray-900 leading-tight line-clamp-2">{it.produto || it.sku}</p>
                        <p className="text-[11px] text-gray-500 mt-0.5 truncate">{[it.marca, it.cor].filter(Boolean).join(" · ") || "—"}</p>
                        <p className="text-sm font-extrabold text-emerald-600 mt-auto pt-1">{preco != null ? fmtBRL(preco) : "—"}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Barra de geração (acima da navegação inferior) */}
      {total > 0 && (
        <div className="fixed bottom-14 inset-x-0 z-40 px-3">
          <div className="max-w-lg mx-auto">
            <button onClick={() => setCatalogoAberto(true)}
              className="w-full flex items-center justify-center gap-2 bg-orange-500 text-white rounded-2xl py-3.5 font-bold shadow-lg active:bg-orange-600">
              <BookOpen className="w-5 h-5" /> Gerar catálogo ({total})
            </button>
          </div>
        </div>
      )}
      {catalogoAberto && (
        <Suspense fallback={<div className="fixed inset-0 z-[75] bg-white flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>}>
          <CatalogoRapidoModal itens={itens} user={user} titulo="Catálogo Nogária Outlet" onClose={() => setCatalogoAberto(false)} />
        </Suspense>
      )}
    </div>
  );
}
