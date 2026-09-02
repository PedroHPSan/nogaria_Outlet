import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { ALL_STATUS, LOTE_SEM, DESTINOS, STATUS_FORA_ESTOQUE_IN, fmtBRL } from "../lib/model";
import {
  COLUNAS_PLANILHA, COLUNAS_PADRAO, COLUNAS_FIXAS, GRUPOS_COLUNAS, CLASSES,
  colunasVisiveis, normalizarVisiveis, montarPatch, montarPlanilha, nomeArquivo,
  valorTexto, valorEdicao, filtrarPorTexto, ordenarItens,
} from "../lib/planilha";
import { gerarXlsx, baixarXlsx } from "../lib/xlsx";
import {
  Search, Filter, Columns3, FileSpreadsheet, Loader2, RefreshCw, X, Check,
  ArrowUpDown, ArrowUp, ArrowDown, Pencil, ExternalLink, AlertCircle,
} from "lucide-react";

const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base bg-white focus:outline-none focus:ring-2 focus:ring-orange-500";
const PAGE = 1000;
const CHAVE_LS = "nogaria:planilha:colunas"; // preferência de colunas por navegador
const PASSO_LINHAS = 60;                     // renderiza aos poucos; o export leva tudo

// SKU e Produto ficam presos à esquerda: com 60 colunas a rolagem horizontal é
// longa e sem âncora o operador perde de vista de qual item é a linha.
const ANCORA = [
  "sticky left-0 w-[116px] min-w-[116px] max-w-[116px]",
  "sticky left-[116px] w-[148px] min-w-[148px] max-w-[148px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.18)]",
];
const ancoraCls = (col, i) => (col.fixa && i < ANCORA.length ? ANCORA[i] : "");

// Preferência de colunas do operador (localStorage pode falhar em modo privativo).
const lerColunasSalvas = () => {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE_LS) || "null");
    return Array.isArray(bruto) && bruto.length ? normalizarVisiveis(bruto) : [...COLUNAS_PADRAO];
  } catch { return [...COLUNAS_PADRAO]; }
};
const salvarColunas = (keys) => { try { localStorage.setItem(CHAVE_LS, JSON.stringify(keys)); } catch { /* sem persistência */ } };

/**
 * Planilha de produtos: listagem tabular de TODOS os campos do item, com filtro,
 * escolha de colunas, edição na própria célula e exportação para Excel (.xlsx).
 * O nome do produto é um link para a ficha completa (ItemDetail).
 */
export default function PlanilhaScreen({ lotes, params, user, onOpen, refreshKey, onBarraAcao }) {
  const [q, setQ] = useState("");
  const [fLote, setFLote] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fClasse, setFClasse] = useState("");
  const [fGrupo, setFGrupo] = useState("");
  const [fDestino, setFDestino] = useState("");
  const [incluirFora, setIncluirFora] = useState(false); // vendidos/entregues/descartados
  const [painel, setPainel] = useState(null); // "filtros" | "colunas" | null
  const [visiveis, setVisiveis] = useState(lerColunasSalvas);
  const [ordem, setOrdem] = useState({ key: "sku", dir: "asc" });
  const [itens, setItens] = useState(null); // null = carregando
  const [limite, setLimite] = useState(PASSO_LINHAS);
  const [edicao, setEdicao] = useState(null); // { sku, key, valor }
  const [salvando, setSalvando] = useState(null); // sku em gravação
  const [msg, setMsg] = useState(null); // { tom: "erro" | "ok", texto }
  const [recarga, setRecarga] = useState(0);

  // A grade ocupa a largura toda; os botões flutuantes do App atrapalhariam.
  useEffect(() => { onBarraAcao?.(true); return () => onBarraAcao?.(false); }, [onBarraAcao]);

  const cols = useMemo(() => colunasVisiveis(visiveis), [visiveis]);
  const catList = useMemo(
    () => Object.keys(params?.grupos || {}).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [params]
  );

  // Busca TODOS os itens que batem com os filtros (paginado: o PostgREST corta
  // em 1.000 linhas). A tela renderiza aos poucos, mas o export precisa do total.
  useEffect(() => {
    let cancelado = false;
    (async () => {
      setItens(null);
      let data = [];
      for (let from = 0; ; from += PAGE) {
        let query = supabase.from("itens").select("*");
        if (fLote === LOTE_SEM) query = query.is("lote", null);
        else if (fLote) query = query.eq("lote", Number(fLote));
        if (fStatus) query = query.eq("status", fStatus);
        else if (!incluirFora) query = query.not("status", "in", STATUS_FORA_ESTOQUE_IN);
        if (fClasse) query = query.eq("classe", fClasse);
        if (fGrupo) query = query.eq("grupo", fGrupo);
        if (fDestino) query = query.eq("destino", fDestino);
        const { data: parte, error } = await query.order("sku").range(from, from + PAGE - 1);
        if (error || !parte) break;
        data = data.concat(parte);
        if (parte.length < PAGE) break;
      }
      if (!cancelado) { setItens(data); setLimite(PASSO_LINHAS); }
    })();
    return () => { cancelado = true; };
  }, [fLote, fStatus, fClasse, fGrupo, fDestino, incluirFora, recarga]);

  // Recarrega quando algo muda fora da tela (ex.: o item editado na ficha), mas
  // nunca no meio de uma edição — a célula aberta perderia o que está sendo digitado.
  const primeiroRefresh = useRef(true);
  useEffect(() => {
    if (primeiroRefresh.current) { primeiroRefresh.current = false; return; }
    if (edicao) return;
    const t = setTimeout(() => setRecarga((r) => r + 1), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Busca textual e ordenação rodam sobre o conjunto já carregado (instantâneas).
  const lista = useMemo(() => {
    const base = filtrarPorTexto(itens || [], q);
    const col = COLUNAS_PLANILHA.find((c) => c.key === ordem.key);
    return ordenarItens(base, col, ordem.dir);
  }, [itens, q, ordem]);

  const visao = useMemo(() => lista.slice(0, limite), [lista, limite]);
  const totalVenda = useMemo(
    () => lista.reduce((s, it) => s + (Number(it.preco_ideal) || 0), 0),
    [lista]
  );

  const alternarOrdem = (key) =>
    setOrdem((o) => (o.key === key ? { key, dir: o.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  const trocarColuna = (key) => {
    if (COLUNAS_FIXAS.includes(key)) return; // SKU e Produto ancoram a linha
    setVisiveis((atual) => {
      const set = new Set(atual);
      if (set.has(key)) set.delete(key); else set.add(key);
      const novo = normalizarVisiveis([...set]);
      salvarColunas(novo);
      return novo;
    });
  };
  const definirColunas = (keys) => { const n = normalizarVisiveis(keys); salvarColunas(n); setVisiveis(n); };

  // --- Edição na célula -----------------------------------------------------

  const abrirEdicao = (it, col) => {
    if (!col.editavel || salvando) return;
    setMsg(null);
    setEdicao({ sku: it.sku, key: col.key, valor: valorEdicao(col, it) });
  };

  const salvarCelula = useCallback(async (it, col, texto) => {
    const { patch, erro, aviso } = montarPatch(col, texto);
    if (erro) { setMsg({ tom: "erro", texto: `${col.header}: ${erro}` }); return; }
    if (aviso) setMsg({ tom: "erro", texto: aviso });
    const campo = Object.keys(patch)[0];
    setEdicao(null);
    if (!campo) return;
    if (patch[campo] === (it[campo] ?? null)) return; // nada mudou

    setSalvando(it.sku);
    const corpo = { ...patch, upd_by: user?.email };
    // Carimbos de pós-venda ao mudar o status pela planilha (espelha ItemDetail).
    if (campo === "status" && patch.status === "VENDIDO" && !it.vendido_em) corpo.vendido_em = new Date().toISOString();
    if (campo === "status" && patch.status === "ENTREGUE") corpo.entregue_em = new Date().toISOString();

    const { data, error } = await supabase.from("itens").update(corpo).eq("sku", it.sku).select().single();
    setSalvando(null);
    if (error) { setMsg({ tom: "erro", texto: `Erro ao salvar: ${error.message}` }); return; }
    if (campo === "status") {
      // Auditoria do fluxo, igual à da ficha (best-effort: não desfaz o salvamento).
      await supabase.from("eventos")
        .insert({ sku: it.sku, acao: `status:${patch.status}`, detalhe: "planilha", usuario: user?.email })
        .then(null, () => {});
    }
    setItens((arr) => (arr || []).map((x) => (x.sku === it.sku ? data : x)));
    setMsg({ tom: "ok", texto: `${it.sku} · ${col.header} atualizado.` });
  }, [user]);

  const aoTeclar = (e, it, col) => {
    if (e.key === "Enter" && col.tipo !== "texto_longo") { e.preventDefault(); salvarCelula(it, col, e.target.value); }
    if (e.key === "Escape") { e.preventDefault(); setEdicao(null); }
  };

  // --- Exportação -----------------------------------------------------------

  const exportar = (todasAsColunas) => {
    if (!lista.length) return;
    const usar = todasAsColunas ? COLUNAS_PLANILHA : cols;
    const { colunas, linhas } = montarPlanilha(lista, usar);
    const arquivo = nomeArquivo({ lote: fLote && fLote !== LOTE_SEM ? fLote : null, status: fStatus, grupo: fGrupo });
    baixarXlsx(arquivo, gerarXlsx({ aba: "Produtos", colunas, linhas }));
    setMsg({ tom: "ok", texto: `${lista.length.toLocaleString("pt-BR")} produto(s) exportado(s) para ${arquivo}.` });
  };

  const nFiltros = [fLote, fStatus, fClasse, fGrupo, fDestino, incluirFora].filter(Boolean).length;

  return (
    <div className="pb-24">
      <div className="px-4 pt-4">
        <h2 className="text-lg font-bold text-gray-900">Planilha de produtos</h2>
        <p className="text-sm text-gray-500">
          Consulte, edite na própria célula e exporte para Excel. Toque no nome do produto para abrir a ficha.
        </p>
      </div>

      {/* Busca + painéis */}
      <div className="px-4 pt-3 space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar SKU, produto, marca, GTIN…"
              className="w-full rounded-xl border border-gray-300 pl-9 pr-3 py-2.5 text-base bg-white focus:outline-none focus:ring-2 focus:ring-orange-500" />
          </div>
          <button onClick={() => setPainel(painel === "filtros" ? null : "filtros")}
            className={`px-3 rounded-xl border flex items-center gap-1 text-sm font-semibold ${nFiltros ? "bg-orange-500 text-white border-orange-500" : "bg-white border-gray-300 text-gray-600"}`}>
            <Filter className="w-4 h-4" />{nFiltros || ""}
          </button>
          <button onClick={() => setPainel(painel === "colunas" ? null : "colunas")}
            className={`px-3 rounded-xl border flex items-center gap-1 text-sm font-semibold ${painel === "colunas" ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-300 text-gray-600"}`}>
            <Columns3 className="w-4 h-4" />{cols.length}
          </button>
          <button onClick={() => setRecarga((r) => r + 1)} aria-label="Atualizar"
            className="px-3 rounded-xl border border-gray-300 bg-white text-gray-600">
            <RefreshCw className={`w-4 h-4 ${itens === null ? "animate-spin" : ""}`} />
          </button>
        </div>

        {painel === "filtros" && (
          <div className="bg-white rounded-2xl border border-gray-200 p-3 space-y-2">
            <select value={fLote} onChange={(e) => setFLote(e.target.value)} className={inputCls}>
              <option value="">Todos os lotes</option>
              <option value={LOTE_SEM}>Sem lote</option>
              {(lotes || []).map((l) => <option key={l.lote} value={String(l.lote)}>Lote {l.lote} — {l.referencia || ""}</option>)}
            </select>
            <div className="flex gap-2">
              <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={inputCls}>
                <option value="">Todos os status</option>
                {ALL_STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <select value={fClasse} onChange={(e) => setFClasse(e.target.value)} className={inputCls}>
                <option value="">Todas as classes</option>
                {CLASSES.map((c) => <option key={c} value={c}>Classe {c}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <select value={fGrupo} onChange={(e) => setFGrupo(e.target.value)} className={inputCls}>
                <option value="">Todas as categorias</option>
                {catList.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <select value={fDestino} onChange={(e) => setFDestino(e.target.value)} className={inputCls}>
                <option value="">Todos os destinos</option>
                {DESTINOS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 pt-1 text-sm font-medium text-gray-700">
              <input type="checkbox" checked={incluirFora} onChange={(e) => setIncluirFora(e.target.checked)}
                className="w-4 h-4 rounded accent-orange-500" />
              Incluir vendidos, entregues e descartados
            </label>
            {nFiltros > 0 && (
              <button onClick={() => { setFLote(""); setFStatus(""); setFClasse(""); setFGrupo(""); setFDestino(""); setIncluirFora(false); }}
                className="text-sm font-semibold text-orange-600">Limpar filtros</button>
            )}
          </div>
        )}

        {painel === "colunas" && (
          <div className="bg-white rounded-2xl border border-gray-200 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">
                Colunas ({cols.length} de {COLUNAS_PLANILHA.length})
              </h3>
              <div className="flex gap-2 text-xs font-semibold">
                <button onClick={() => definirColunas(COLUNAS_PLANILHA.map((c) => c.key))} className="text-gray-700">Todas</button>
                <button onClick={() => definirColunas(COLUNAS_PADRAO)} className="text-orange-600">Padrão</button>
                <button onClick={() => definirColunas(COLUNAS_FIXAS)} className="text-gray-500">Mínimo</button>
              </div>
            </div>
            {GRUPOS_COLUNAS.map((g) => (
              <div key={g}>
                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1">{g}</p>
                <div className="flex flex-wrap gap-1.5">
                  {COLUNAS_PLANILHA.filter((c) => c.grupo === g).map((c) => {
                    const ativa = visiveis.includes(c.key);
                    return (
                      <button key={c.key} onClick={() => trocarColuna(c.key)} disabled={c.fixa}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                          ativa ? "bg-orange-50 border-orange-300 text-orange-700" : "bg-white border-gray-300 text-gray-500"
                        } ${c.fixa ? "opacity-60" : ""}`}>
                        {ativa && <Check className="w-3 h-3 inline mr-1 -mt-0.5" />}{c.header}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Resumo + exportação */}
      <div className="px-4 pt-3 flex items-center justify-between text-sm">
        <p className="text-gray-600">
          {itens === null ? "Carregando…" : (
            <>
              <b className="text-gray-900">{lista.length.toLocaleString("pt-BR")}</b> produto(s)
              {lista.length ? <> · {fmtBRL(totalVenda)} em venda</> : null}
            </>
          )}
        </p>
        {itens !== null && lista.length > visao.length && (
          <span className="text-xs text-gray-400">mostrando {visao.length.toLocaleString("pt-BR")}</span>
        )}
      </div>

      {msg && (
        <div className={`mx-4 mt-2 rounded-xl px-3 py-2 text-sm flex items-start gap-2 ${
          msg.tom === "erro" ? "bg-red-50 text-red-700 border border-red-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"
        }`}>
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1">{msg.texto}</span>
          <button onClick={() => setMsg(null)} aria-label="Fechar aviso"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Grade */}
      <div className="mt-3 border-y border-gray-200 bg-white overflow-auto max-h-[62vh]">
        {itens === null ? (
          <div className="py-16 text-center"><Loader2 className="w-7 h-7 animate-spin text-orange-500 mx-auto" /></div>
        ) : !lista.length ? (
          <div className="py-16 text-center text-gray-400">
            <FileSpreadsheet className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Nenhum produto com esses filtros.</p>
          </div>
        ) : (
          <table className="text-xs border-collapse">
            <thead className="sticky top-0 z-20">
              <tr className="bg-gray-900 text-white">
                {cols.map((c, i) => (
                  <th key={c.key}
                    className={`text-left font-semibold px-2.5 py-2 whitespace-nowrap border-r border-gray-700 last:border-r-0 bg-gray-900 ${ancoraCls(c, i) ? `z-30 ${ancoraCls(c, i)}` : "max-w-[15rem]"}`}>
                    <button onClick={() => alternarOrdem(c.key)} className="flex items-center gap-1">
                      {c.header}
                      {ordem.key === c.key
                        ? (ordem.dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
                        : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visao.map((it) => (
                <tr key={it.sku} className={`border-b border-gray-100 ${salvando === it.sku ? "opacity-50" : ""}`}>
                  {cols.map((c, i) => {
                    const editando = edicao && edicao.sku === it.sku && edicao.key === c.key;
                    return (
                      <td key={c.key}
                        className={`align-top border-r border-gray-100 last:border-r-0 bg-white ${ancoraCls(c, i) ? `z-10 ${ancoraCls(c, i)}` : "max-w-[15rem]"}`}>
                        {editando ? (
                          <div className="px-1.5 py-1">
                            <CampoEdicao col={c} item={it} edicao={edicao} setEdicao={setEdicao}
                              catList={catList} onSalvar={salvarCelula} onTeclar={aoTeclar} />
                          </div>
                        ) : c.key === "produto" ? (
                          <div className="flex items-start gap-1 px-2.5 py-1.5">
                            <button onClick={() => onOpen?.(it)}
                              className="text-left font-medium text-orange-700 underline decoration-orange-300 underline-offset-2 line-clamp-2">
                              {it.produto || "(sem nome)"}
                              <ExternalLink className="w-3 h-3 inline ml-1 -mt-0.5 opacity-60" />
                            </button>
                            <button onClick={() => abrirEdicao(it, c)} aria-label="Editar nome" className="text-gray-300 hover:text-gray-600 pt-0.5">
                              <Pencil className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => abrirEdicao(it, c)} disabled={!c.editavel}
                            title={valorTexto(c, it)}
                            className={`text-left block w-full px-2.5 py-1.5 truncate ${
                              c.editavel ? "text-gray-800 hover:bg-orange-50" : "text-gray-500 cursor-default"
                            }`}>
                            {valorTexto(c, it)}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {lista.length > visao.length && (
        <div className="px-4 pt-3">
          <button onClick={() => setLimite((n) => n + PASSO_LINHAS)}
            className="w-full bg-white border border-gray-300 rounded-xl py-2.5 text-sm font-semibold text-gray-700">
            Mostrar mais {Math.min(PASSO_LINHAS, lista.length - visao.length)} de {lista.length.toLocaleString("pt-BR")}
          </button>
        </div>
      )}

      <div className="px-4 pt-4 space-y-2">
        <button onClick={() => exportar(false)} disabled={!lista.length}
          className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white rounded-2xl py-3.5 font-bold shadow-sm active:bg-emerald-700 disabled:opacity-40">
          <FileSpreadsheet className="w-5 h-5" />
          Exportar Excel ({cols.length} colunas · {lista.length.toLocaleString("pt-BR")} itens)
        </button>
        <button onClick={() => exportar(true)} disabled={!lista.length}
          className="w-full flex items-center justify-center gap-2 bg-white text-gray-700 border border-gray-300 rounded-2xl py-3 font-semibold active:bg-gray-50 disabled:opacity-40">
          <FileSpreadsheet className="w-4 h-4" />
          Exportar com TODAS as {COLUNAS_PLANILHA.length} colunas
        </button>
        <p className="text-xs text-gray-400 text-center">
          O arquivo .xlsx sai com cabeçalho fixo e filtro automático, respeitando os filtros e a ordenação da tela.
        </p>
      </div>
    </div>
  );
}

// Campo de edição da célula: select (opções fixas / booleano), datalist de
// categorias ou input livre. Salva ao sair do campo (blur) ou no Enter.
function CampoEdicao({ col, item, edicao, setEdicao, catList, onSalvar, onTeclar }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const cls = "w-full min-w-[8rem] rounded border border-orange-400 px-1.5 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-orange-300";
  const set = (valor) => setEdicao((e) => ({ ...e, valor }));

  if (col.tipo === "select" || col.tipo === "bool") {
    const opcoes = col.tipo === "bool"
      ? [{ v: "", label: "—" }, { v: "true", label: "Sim" }, { v: "false", label: "Não" }]
      : [{ v: "", label: "—" }, ...col.opcoes];
    return (
      <select ref={ref} className={cls} value={edicao.valor}
        onChange={(e) => { set(e.target.value); onSalvar(item, col, e.target.value); }}
        onBlur={() => setEdicao(null)}>
        {opcoes.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>
    );
  }

  const listaId = col.opcoesDe === "grupos" ? `planilha-${col.key}` : undefined;
  return (
    <>
      <input ref={ref} className={cls} value={edicao.valor} list={listaId}
        inputMode={["inteiro", "decimal", "moeda"].includes(col.tipo) ? "decimal" : undefined}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => onTeclar(e, item, col)}
        onBlur={(e) => onSalvar(item, col, e.target.value)} />
      {listaId && (
        <datalist id={listaId}>{(catList || []).map((g) => <option key={g} value={g} />)}</datalist>
      )}
    </>
  );
}
