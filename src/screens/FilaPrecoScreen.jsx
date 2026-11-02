// Fila de preço: peças em Foto OK+ que faltam para entrar no catálogo, por motivo. Preço em lote pelo motor v2
// (RevisaoPrecosModal: só grava o que o operador marcar, nunca abaixo do piso). Começa por um lote piloto.
import React, { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import { X, Loader2, Tag } from "lucide-react";
import { lazySeguro } from "../lib/lazySeguro";
import { elegiveisNaoPublicados, publicarLote } from "../lib/catalogoMeta";
import { excluirDoCatalogo } from "../lib/canais";
import { fmtBRL } from "../lib/model";
import { listarIncompletas, carregarItens, MOTIVOS_FILA, MOTIVO_ROTULO, TAMANHOS_LOTE } from "../lib/filaPreco";

const RevisaoPrecosModal = lazySeguro(() => import("../components/RevisaoPrecosModal"));

export default function FilaPrecoScreen({ params, user, onClose, onOpen }) {
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState(null);
  const [filtro, setFiltro] = useState("sem_preco");
  const [tamanho, setTamanho] = useState(TAMANHOS_LOTE[0]);
  const [revisao, setRevisao] = useState(null);
  const [abrindo, setAbrindo] = useState(false);
  const [pendentesCat, setPendentesCat] = useState(null); // SKUs elegíveis ainda fora do catálogo
  const [pub, setPub] = useState(null); // { ok, falhas, total, erros? } do lote em andamento/concluído

  const contarPendentes = useCallback(() => elegiveisNaoPublicados().then(setPendentesCat).catch(() => setPendentesCat(null)), []);
  useEffect(() => { contarPendentes(); }, [contarPendentes]);
  const [revPub, setRevPub] = useState(null); // { itens, marcados:Set } — revisão da Bárbara antes de publicar
  const revisarPublicacao = async () => {
    setErro(null);
    try {
      const itens = await carregarItens(pendentesCat.slice(0, 100)); // lotes de 100
      setRevPub({ itens, marcados: new Set(itens.map((i) => i.sku)) });
    } catch (e) { setErro(e.message || String(e)); }
  };
  const alternar = (sku) => setRevPub((r) => { const m = new Set(r.marcados); m.has(sku) ? m.delete(sku) : m.add(sku); return { ...r, marcados: m }; });
  const publicar = async () => {
    const { itens, marcados } = revPub;
    const sim = itens.filter((i) => marcados.has(i.sku)), nao = itens.filter((i) => !marcados.has(i.sku));
    setRevPub(null); setPub({ ok: 0, falhas: 0, total: sim.length }); setErro(null);
    try {
      if (nao.length) await excluirDoCatalogo(nao.map((i) => i.sku), user); // retirada deliberada: não volta a ser oferecida
      const r = await publicarLote(sim, { onProgresso: (p) => setPub((a) => ({ ...a, ...p })) });
      setPub((a) => ({ ...a, erros: r.erros }));
    } catch (e) { setErro(e.message || String(e)); setPub(null); }
    contarPendentes();
  };

  const carregar = useCallback(async () => {
    try { setErro(null); setLista(await listarIncompletas()); } catch (e) { setErro(e.message || String(e)); setLista([]); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const contagem = useMemo(() => Object.fromEntries(MOTIVOS_FILA.map((m) => [m, (lista || []).filter((i) => i.motivos.includes(m)).length])), [lista]);
  const visiveis = (lista || []).filter((i) => i.motivos.includes(filtro));
  // Prioriza quem já tem sugestão (o motor tem de onde partir) e fica estável por SKU.
  const lote = useMemo(() => [...visiveis].sort((a, b) => (b.preco_sugerido > 0) - (a.preco_sugerido > 0)).slice(0, tamanho), [visiveis, tamanho]);

  const precificar = async () => {
    setAbrindo(true); setErro(null);
    try { setRevisao(await carregarItens(lote.map((i) => i.sku))); } catch (e) { setErro(e.message || String(e)); } finally { setAbrindo(false); }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-gray-50 flex flex-col">
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-2">
        <Tag className="w-5 h-5 text-emerald-600" />
        <h2 className="font-bold text-gray-900">Fila de preço do catálogo</h2>
        <button onClick={onClose} aria-label="Fechar" className="ml-auto"><X className="w-6 h-6 text-gray-400" /></button>
      </div>
      <div className="px-4 py-2 flex gap-1.5 overflow-x-auto">
        {MOTIVOS_FILA.map((m) => (
          <button key={m} onClick={() => setFiltro(m)} className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${filtro === m ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-600"}`}>
            {MOTIVO_ROTULO[m]} ({lista ? contagem[m] : "…"})
          </button>
        ))}
      </div>
      {pendentesCat && pendentesCat.length > 0 && (
        <div className="mx-4 mb-2 bg-white border border-gray-200 rounded-xl p-3 text-xs space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-gray-700"><b>{pendentesCat.length}</b> peça(s) elegível(is) ainda fora do catálogo.</span>
            <button onClick={revisarPublicacao} disabled={pub && !pub.erros} className="ml-auto px-3 py-1.5 rounded-lg bg-sky-600 text-white font-bold disabled:opacity-50">
              {pub && !pub.erros ? `Publicando ${pub.ok + pub.falhas}/${pub.total}…` : `Revisar ${Math.min(100, pendentesCat.length)} para o catálogo`}
            </button>
          </div>
          {pub?.erros && <p className={pub.erros.length ? "text-red-600" : "text-emerald-700"}>
            {pub.ok} publicada(s){pub.erros.length ? `, ${pub.erros.length} com erro: ${pub.erros.slice(0, 3).map((e) => `${e.sku} (${e.erro})`).join("; ")}` : "."}</p>}
        </div>
      )}
      {(filtro === "sem_preco" || filtro === "preco_nao_validado") && lista && visiveis.length > 0 && (
        <div className="mx-4 mb-2 bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-600">Lote:</span>
          {TAMANHOS_LOTE.map((t) => (
            <button key={t} onClick={() => setTamanho(t)} className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${tamanho === t ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-700"}`}>{t === TAMANHOS_LOTE[0] ? `${t} (piloto)` : t}</button>
          ))}
          <button onClick={precificar} disabled={abrindo} className="ml-auto px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold disabled:opacity-50">
            {abrindo ? <Loader2 className="w-4 h-4 animate-spin" /> : `${filtro === "sem_preco" ? "Precificar" : "Validar preço de"} ${Math.min(tamanho, visiveis.length)} peças`}
          </button>
        </div>
      )}
      {erro && <p className="mx-4 mb-2 text-xs text-red-600">{erro}</p>}
      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-1.5">
        {!lista && <Loader2 className="w-6 h-6 animate-spin text-gray-400 mx-auto mt-10" />}
        {lista && visiveis.length === 0 && !erro && <p className="text-sm text-gray-500 text-center mt-10">Nada pendente aqui.</p>}
        {visiveis.map((i) => (
          <button key={i.sku} onClick={() => onOpen?.(i)} className="w-full text-left bg-white rounded-lg border border-gray-200 px-3 py-2">
            <p className="text-sm font-semibold text-gray-900 truncate">{i.produto || i.sku}</p>
            <p className="text-[11px] text-gray-400 font-mono">{i.sku}{i.lote ? ` · lote ${i.lote}` : ""}{i.preco_sugerido > 0 ? " · tem sugestão" : ""}</p>
            <div className="flex gap-1 mt-1 flex-wrap">
              {i.motivos.filter((m) => MOTIVOS_FILA.includes(m)).map((m) => <span key={m} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">{MOTIVO_ROTULO[m]}</span>)}
            </div>
          </button>
        ))}
      </div>
      {revPub && (
        <div className="fixed inset-0 z-[85] bg-black/50 flex items-end sm:items-center justify-center">
          <div className="bg-white w-full max-w-2xl rounded-t-2xl sm:rounded-2xl p-4 space-y-3 max-h-[92vh] flex flex-col">
            <p className="font-bold text-gray-900">Revisar ofertas antes de publicar</p>
            <p className="text-xs text-gray-600">Esta é a última etapa: ao publicar, os produtos marcados ficam <b>disponíveis para os clientes</b>, com o preço atual da ficha. Desmarque o que NÃO deve ir ao catálogo: a peça fica de fora e não volta a ser oferecida.</p>
            <div className="flex-1 overflow-y-auto space-y-1">
              {revPub.itens.map((i) => (
                <label key={i.sku} className="flex items-center gap-2 text-xs bg-gray-50 rounded px-2 py-1.5">
                  <input type="checkbox" checked={revPub.marcados.has(i.sku)} onChange={() => alternar(i.sku)} />
                  <span className="flex-1 truncate">{i.produto || i.sku}</span>
                  <span className="font-mono text-gray-400">{i.sku}</span>
                  <b>{fmtBRL(i.preco_ideal)}</b>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setRevPub(null)} className="px-3 py-2 rounded-lg border border-gray-300 text-sm font-semibold">Cancelar</button>
              <button onClick={publicar} className="ml-auto px-3 py-2 rounded-lg bg-sky-600 text-white text-sm font-bold">
                Publicar {revPub.marcados.size}{revPub.itens.length - revPub.marcados.size ? ` · tirar ${revPub.itens.length - revPub.marcados.size}` : ""}
              </button>
            </div>
          </div>
        </div>
      )}
      {revisao && (
        <Suspense fallback={null}>
          <RevisaoPrecosModal itens={revisao} params={params} user={user} onClose={() => setRevisao(null)} onAplicado={carregar} />
        </Suspense>
      )}
    </div>
  );
}
