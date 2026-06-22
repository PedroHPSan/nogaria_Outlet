import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Footprints, Loader2, Search, Printer, Tag, TagsIcon, Eye, EyeOff,
} from "lucide-react";
import {
  listarCalcados, agruparPorTamanho, tamanhosDisponiveis, marcasDisponiveis,
  tamanhoLabel, gerarPortfolioHTML, imprimirPortfolio,
} from "../lib/portfolio";
import { precoVenda } from "../lib/export";
import { primeirasFotos } from "../lib/fotos";
import { fmtBRL, statusMeta } from "../lib/model";

const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base bg-white focus:outline-none focus:ring-2 focus:ring-orange-500";

// Catálogo/portfólio de calçados para apresentar a clientes: filtra por tamanho
// e marca, mostra a galeria com fotos e preço (com opção de ocultar) e gera um
// PDF/impressão limpo agrupado por numeração.
export default function PortfolioScreen({ refreshKey, onOpen }) {
  const [todos, setTodos] = useState(null);     // todos os calçados carregados
  const [fotos, setFotos] = useState({});       // { sku: url }
  const [fTamanho, setFTamanho] = useState("");
  const [fMarca, setFMarca] = useState("");
  const [q, setQ] = useState("");
  const [mostrarPreco, setMostrarPreco] = useState(true);
  const [imprimindo, setImprimindo] = useState(false);

  const carregar = useCallback(async () => {
    setTodos(null);
    const lista = await listarCalcados();
    setTodos(lista);
    primeirasFotos(lista.map((i) => i.sku)).then(setFotos);
  }, []);
  useEffect(() => { carregar(); }, [carregar, refreshKey]);

  const tamanhos = useMemo(() => (todos ? tamanhosDisponiveis(todos) : []), [todos]);
  const marcas = useMemo(() => (todos ? marcasDisponiveis(todos) : []), [todos]);

  // Itens após os filtros de tamanho/marca/busca.
  const filtrados = useMemo(() => {
    if (!todos) return [];
    const t = q.trim().toLowerCase();
    return todos.filter((it) => {
      if (fTamanho && tamanhoLabel(it.tamanho) !== fTamanho) return false;
      if (fMarca && (it.marca || "").trim() !== fMarca) return false;
      if (t) {
        const alvo = `${it.produto || ""} ${it.marca || ""} ${it.modelo || ""} ${it.cor || ""} ${it.sku}`.toLowerCase();
        if (!alvo.includes(t)) return false;
      }
      return true;
    });
  }, [todos, fTamanho, fMarca, q]);

  const grupos = useMemo(() => agruparPorTamanho(filtrados), [filtrados]);

  const imprimir = () => {
    if (!filtrados.length) return;
    setImprimindo(true);
    try {
      const titulo = fTamanho ? `Calçados Nº ${fTamanho}` : "Catálogo de Calçados";
      const html = gerarPortfolioHTML(grupos, { mostrarPreco, fotos, titulo });
      imprimirPortfolio(html);
    } finally {
      // o diálogo de impressão é assíncrono; liberamos o botão logo após disparar
      setTimeout(() => setImprimindo(false), 1200);
    }
  };

  const limpar = () => { setFTamanho(""); setFMarca(""); setQ(""); };
  const temFiltro = fTamanho || fMarca || q.trim();

  return (
    <div className="pb-28">
      <div className="px-4 pt-4 space-y-3">
        <div className="flex items-center gap-2">
          <Footprints className="w-5 h-5 text-orange-500" />
          <h2 className="font-bold text-gray-900">Portfólio de calçados</h2>
        </div>
        <p className="text-sm text-gray-500">
          Filtre por tamanho e gere um catálogo (PDF/impressão) com fotos e preços para mostrar ao cliente.
        </p>

        {/* Filtros */}
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar produto, marca, cor…"
            className={`${inputCls} pl-9`} />
        </div>
        <div className="flex gap-2">
          <label className="flex-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1"><Tag className="w-3 h-3" /> Tamanho</span>
            <select value={fTamanho} onChange={(e) => setFTamanho(e.target.value)} className={`${inputCls} mt-1`}>
              <option value="">Todos</option>
              {tamanhos.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="flex-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1"><TagsIcon className="w-3 h-3" /> Marca</span>
            <select value={fMarca} onChange={(e) => setFMarca(e.target.value)} className={`${inputCls} mt-1`}>
              <option value="">Todas</option>
              {marcas.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        </div>

        <div className="flex items-center justify-between gap-2">
          <button onClick={() => setMostrarPreco((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-semibold text-gray-600 active:text-gray-900">
            {mostrarPreco ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            {mostrarPreco ? "Mostrando preços" : "Preços ocultos"}
          </button>
          {temFiltro && (
            <button onClick={limpar} className="text-sm font-semibold text-orange-600 active:text-orange-700">Limpar filtros</button>
          )}
        </div>
      </div>

      {/* Galeria agrupada por tamanho */}
      {todos === null ? (
        <div className="py-16 text-center"><Loader2 className="w-7 h-7 animate-spin text-orange-500 mx-auto" /></div>
      ) : !filtrados.length ? (
        <div className="text-center py-16 text-gray-400">
          <Footprints className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">{todos.length ? "Nenhum calçado com esses filtros." : "Nenhum calçado catalogado ainda."}</p>
        </div>
      ) : (
        <div className="px-4 pt-2 space-y-5">
          <p className="text-xs text-gray-400">{filtrados.length} {filtrados.length === 1 ? "calçado" : "calçados"} · {grupos.length} {grupos.length === 1 ? "tamanho" : "tamanhos"}</p>
          {grupos.map((g) => (
            <section key={g.tamanho}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-bold bg-gray-900 text-white rounded-lg px-2.5 py-1">Nº {g.tamanho}</span>
                <span className="text-xs text-gray-400">{g.itens.length} {g.itens.length === 1 ? "par" : "pares"}</span>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {g.itens.map((it) => {
                  const sm = statusMeta(it.status);
                  const preco = precoVenda(it);
                  return (
                    <button key={it.sku} onClick={() => onOpen?.(it)}
                      className="text-left bg-white rounded-xl border border-gray-200 overflow-hidden active:opacity-80 flex flex-col">
                      <div className="aspect-square bg-gray-100 relative">
                        {fotos[it.sku] ? (
                          <img src={fotos[it.sku]} alt="" loading="lazy" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">sem foto</div>
                        )}
                        <span className={`absolute top-1.5 left-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold ${sm.color}`}>{sm.short}</span>
                      </div>
                      <div className="p-2 flex-1 flex flex-col">
                        <p className="text-xs font-bold text-gray-900 leading-tight line-clamp-2">{it.produto || it.sku}</p>
                        <p className="text-[11px] text-gray-500 mt-0.5 truncate">{[it.marca, it.cor].filter(Boolean).join(" · ") || "—"}</p>
                        {mostrarPreco && (
                          <p className="text-sm font-extrabold text-emerald-600 mt-auto pt-1">{preco != null ? fmtBRL(preco) : "—"}</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Barra de impressão (acima da navegação inferior) */}
      {filtrados.length > 0 && (
        <div className="fixed bottom-14 inset-x-0 z-30 px-3">
          <div className="max-w-lg mx-auto">
            <button onClick={imprimir} disabled={imprimindo}
              className="w-full flex items-center justify-center gap-2 bg-gray-900 text-white rounded-2xl py-3.5 font-bold shadow-lg active:bg-gray-800 disabled:opacity-60">
              {imprimindo ? <Loader2 className="w-5 h-5 animate-spin" /> : <Printer className="w-5 h-5" />}
              Imprimir / Salvar PDF ({filtrados.length})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
