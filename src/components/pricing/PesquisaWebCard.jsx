// Pesquisa de preço na web (Edge Function pesquisa-preco-web) + "como chegamos a este valor":
// anúncios usados (com link), descartados (com o motivo), mediana e a regra de confiança.
// Só sugere — não altera o preço do item.
import React, { useEffect, useState } from "react";
import { Search, Loader2, ExternalLink } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { fmtBRL } from "../../lib/model";

const CONF = {
  ALTA: { cls: "bg-emerald-100 text-emerald-700", regra: "4 ou mais anúncios e preços próximos (diferença entre o menor e o maior até 50% da mediana)." },
  MEDIA: { cls: "bg-amber-100 text-amber-700", regra: "3 ou mais anúncios, com preços razoavelmente próximos." },
  BAIXA: { cls: "bg-red-100 text-red-700", regra: "menos de 3 anúncios ou preços muito diferentes entre si — confira os links antes de usar." },
  NENHUMA: { cls: "bg-gray-100 text-gray-600", regra: "nenhum anúncio comparável foi encontrado." },
};

const doBanco = (r) => ({
  mediana: r.mediana, n: r.n, min: r.preco_min, max: r.preco_max, confianca: r.confianca, condicao: r.condicao,
  anuncios: r.anuncios ?? [], descartados: r.descartados ?? [], obs: r.obs,
  regra: { modelo: r.modelo_ia, pesquisado_em: r.created_at },
});
const dataBR = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "");

export default function PesquisaWebCard({ item }) {
  const [s, setS] = useState(null);
  const [faltando, setFaltando] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);

  // mostra a última pesquisa já feita (sem custo)
  useEffect(() => {
    let vivo = true;
    setS(null); setFaltando(null); setErro(null);
    if (!supabase || !item?.sku) return undefined;
    supabase.from("pesquisa_preco_web").select("*").eq("sku", item.sku)
      .order("created_at", { ascending: false }).limit(1)
      .then(({ data }) => { if (vivo && data?.[0]) setS(doBanco(data[0])); });
    return () => { vivo = false; };
  }, [item?.sku]);

  async function pesquisar(force) {
    setCarregando(true); setErro(null); setFaltando(null);
    try {
      const { data, error } = await supabase.functions.invoke("pesquisa-preco-web", { body: { sku: item.sku, force } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.pronto === false) setFaltando(data.faltando || []);
      else setS(data.sugestao);
    } catch (e) {
      setErro(e?.message || "falha na pesquisa");
    } finally {
      setCarregando(false);
    }
  }

  const ideal = Number(item?.preco_ideal) > 0 ? Number(item.preco_ideal) : null;
  const razao = s?.mediana && ideal ? ideal / s.mediana : null;
  const conf = s ? CONF[s.confianca] || CONF.NENHUMA : null;

  return (
    <div className="rounded-xl border border-gray-100 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase text-gray-500 flex items-center gap-1">
          <Search className="w-3.5 h-3.5" /> Preço na web (anúncios reais)
        </span>
        <button type="button" disabled={carregando} onClick={() => pesquisar(!!s)}
          className="text-xs px-2.5 py-1 rounded-lg bg-gray-900 text-white disabled:opacity-50 flex items-center gap-1">
          {carregando && <Loader2 className="w-3 h-3 animate-spin" />}
          {s ? "Pesquisar de novo" : "Pesquisar"}
        </button>
      </div>

      {erro && <p className="text-xs text-red-600">{erro}</p>}
      {faltando && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2">
          Item ainda não está pronto para a pesquisa. Falta: {faltando.join(", ")}.
        </p>
      )}

      {s && (
        <details className="text-xs text-gray-600" open>
          <summary className="cursor-pointer list-none flex items-center justify-between gap-2">
            <span>
              Mediana de mercado <b className="text-gray-900 tabular-nums">{s.mediana != null ? fmtBRL(s.mediana) : "—"}</b>
              <span className={`ml-1.5 text-[10px] px-1.5 rounded-full ${conf.cls}`}>{s.confianca}</span>
            </span>
            <span className="text-[10px] text-gray-400">como chegamos ▾</span>
          </summary>

          <ol className="mt-2 space-y-2 list-decimal pl-4">
            <li>
              Pesquisamos o item como <b>{s.condicao === "NOVO" ? "novo" : "usado"}</b> em Mercado Livre, Amazon, Magalu e Shopee
              {s.regra?.pesquisado_em ? <> ({dataBR(s.regra.pesquisado_em)}{s.regra?.modelo ? `, ${s.regra.modelo}` : ""})</> : null}.
            </li>
            <li>
              Anúncios usados no cálculo ({s.anuncios.length}):
              {s.anuncios.length === 0 && <span> nenhum.</span>}
              <ul className="mt-1 space-y-0.5">
                {s.anuncios.map((a, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <a href={/^https:\/\//i.test(a.url) ? a.url : undefined} target="_blank" rel="noreferrer noopener" className="truncate text-blue-600 hover:underline flex items-center gap-1 min-w-0">
                      <ExternalLink className="w-3 h-3 flex-shrink-0" /><span className="truncate">{a.loja ? `${a.loja} — ` : ""}{a.titulo}</span>
                    </a>
                    <span className="tabular-nums flex-shrink-0">{fmtBRL(a.preco)}</span>
                  </li>
                ))}
              </ul>
            </li>
            {s.descartados?.length > 0 && (
              <li>
                Anúncios descartados ({s.descartados.length}):
                <ul className="mt-1 space-y-0.5 text-gray-500">
                  {s.descartados.map((a, i) => (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <span className="truncate">{a.titulo || a.url || "anúncio"} — <i>{a.motivo}</i></span>
                      <span className="tabular-nums flex-shrink-0">{a.preco != null ? fmtBRL(a.preco) : "—"}</span>
                    </li>
                  ))}
                </ul>
              </li>
            )}
            <li>
              Mediana dos preços usados = <b>{s.mediana != null ? fmtBRL(s.mediana) : "—"}</b>
              {s.min != null && <> (menor {fmtBRL(s.min)}, maior {fmtBRL(s.max)})</>}. A mediana evita que um anúncio muito caro ou muito barato puxe o valor.
            </li>
            <li>
              Confiança <b>{s.confianca}</b>: {conf.regra}
            </li>
            {razao != null && (
              <li>
                O preço definido ({fmtBRL(ideal)}) está {razao.toFixed(2).replace(".", ",")}× a mediana
                {razao > 1.5 ? " — bem acima do mercado; confira se é outra edição/versão." : razao < 0.67 ? " — abaixo do mercado; pode haver margem a mais." : " — dentro de uma faixa normal."}
              </li>
            )}
          </ol>
          {s.obs && <p className="mt-2 text-[11px] text-gray-500 bg-gray-50 rounded-lg p-2">Observação da pesquisa: {s.obs}</p>}
          <p className="mt-1.5 text-[10px] text-gray-400">Sugestão de apoio: não altera o preço do item.</p>
        </details>
      )}
    </div>
  );
}
