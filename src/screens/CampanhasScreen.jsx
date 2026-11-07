// Campanhas de promoção (equipe): lista, editor de regras, simulação/previsibilidade e publicar/encerrar.
// Preço sempre calculado no servidor (RPC campanha_simular); aqui só se mostra. Spec: docs/superpowers/specs/2026-11-07-campanhas-promocao-design.md
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { X, Loader2, Plus, Trash2, Megaphone, AlertTriangle, Copy, Send, Ban } from "lucide-react";
import { ESTADOS } from "../lib/model";
import {
  listarCampanhas, regrasDe, listarOpcoes, salvarRascunho, excluirRascunho, simular, publicar, encerrar, duplicar, margensDaSimulacao, resultadoCampanha,
} from "../lib/campanhas";
import {
  TIPOS_REGRA, ARREDONDAMENTOS, ROTULO_STATUS, regraVazia, validarCampanha, statusCampanha, rotuloRegra,
  isoParaBrasilia, conflitosDoErro, resumoSimulacao, contagem, resumoResultado, ROTULO_DECISAO,
} from "../lib/campanhasCore";

const money = (v) => (v == null || !Number.isFinite(Number(v)) ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const fmtData = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const COR = { rascunho: "bg-gray-100 text-gray-700", agendada: "bg-sky-100 text-sky-800", ativa: "bg-emerald-100 text-emerald-800", encerrada: "bg-gray-200 text-gray-600", cancelada: "bg-red-100 text-red-700" };
const inp = "w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white";

function Selo({ c }) {
  const st = statusCampanha(c);
  const resta = st === "ativa" ? contagem(new Date(c.fim_em) - new Date()) : null;
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${COR[st]}`}>{ROTULO_STATUS[st]}{resta ? ` · ${resta}` : ""}</span>;
}

export default function CampanhasScreen({ user, params, lotes = [], onClose }) {
  const [lista, setLista] = useState(null);
  const [editando, setEditando] = useState(null); // null = lista · "nova" · campanha
  const [opcoes, setOpcoes] = useState({ grupos: [], canais: [] });
  const [erro, setErro] = useState(null);

  const carregar = useCallback(async () => {
    try { setErro(null); setLista(await listarCampanhas()); } catch (e) { setErro(e.message || String(e)); setLista([]); }
  }, []);
  useEffect(() => { carregar(); listarOpcoes().then(setOpcoes).catch(() => {}); }, [carregar]);

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 overflow-y-auto">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <h2 className="font-extrabold text-gray-900 flex items-center gap-2"><Megaphone className="w-4 h-4 text-orange-500" /> Campanhas de promoção</h2>
        <button onClick={editando ? () => { setEditando(null); carregar(); } : onClose} aria-label="Fechar"><X className="w-5 h-5" /></button>
      </div>
      <div className="p-4 max-w-2xl mx-auto space-y-3">
        {erro && <p className="text-sm text-red-600">{erro}</p>}
        {!editando && (
          <>
            <button onClick={() => setEditando("nova")} className="w-full flex items-center justify-center gap-2 rounded-xl py-3 font-bold bg-orange-500 text-white">
              <Plus className="w-4 h-4" /> Nova campanha
            </button>
            {lista === null && <Loader2 className="w-6 h-6 animate-spin text-orange-500" />}
            {lista && lista.length === 0 && <p className="text-sm text-gray-500">Nenhuma campanha ainda.</p>}
            {(lista || []).map((c) => (
              <button key={c.id} onClick={() => setEditando(c)} className="w-full text-left bg-white rounded-xl border border-gray-200 p-3 space-y-1">
                <div className="flex items-center justify-between gap-2"><b className="text-gray-900">{c.nome}</b><Selo c={c} /></div>
                <p className="text-xs text-gray-500">{fmtData(c.inicio_em)} → {fmtData(c.fim_em)} (Brasília)</p>
              </button>
            ))}
          </>
        )}
        {editando && (
          <Editor key={editando.id || "nova"} campanha={editando === "nova" ? null : editando} user={user} params={params} lotes={lotes}
            opcoes={opcoes} onVoltar={() => { setEditando(null); carregar(); }} onAbrir={(c) => setEditando(c)} />
        )}
      </div>
    </div>
  );
}

function Editor({ campanha, user, params, lotes, opcoes, onVoltar, onAbrir }) {
  const rascunho = !campanha || campanha.status === "RASCUNHO";
  const [id, setId] = useState(campanha?.id || null);
  const [form, setForm] = useState({
    nome: campanha?.nome || "", inicio: isoParaBrasilia(campanha?.inicio_em) || "", fim: isoParaBrasilia(campanha?.fim_em) || "",
    arredondamento: campanha?.arredondamento || "centavos",
  });
  const [regras, setRegras] = useState(campanha ? null : [regraVazia()]);
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [canalSim, setCanalSim] = useState("*");
  const [sim, setSim] = useState(null); // { linhas, margens }
  const [simBusy, setSimBusy] = useState(false);

  useEffect(() => { if (campanha) regrasDe(campanha.id).then((r) => setRegras(r.map((x) => ({ ...x, alvo: x.alvo || "", canal: x.canal || "", desconto_pct: String(Number(x.desconto_pct)) })))).catch((e) => setMsgs([e.message])); }, [campanha]);

  const nomes = useMemo(() => Object.fromEntries(opcoes.canais.map((c) => [c.codigo, c.nome])), [opcoes.canais]);
  const macros = useMemo(() => [...new Set(opcoes.grupos.map((g) => g.macro).filter(Boolean))].sort(), [opcoes.grupos]);
  const setRegra = (i, patch) => setRegras((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const salvar = async () => {
    const erros = validarCampanha(form, regras);
    if (erros.length) { setMsgs(erros); return null; }
    setBusy(true); setMsgs([]);
    try { const cid = await salvarRascunho(id, form, regras, user); setId(cid); return cid; }
    catch (e) { setMsgs([e.message || String(e)]); return null; } finally { setBusy(false); }
  };

  const rodarSimulacao = async (cid = id, canal = canalSim) => {
    if (!cid) return;
    setSimBusy(true);
    try {
      const linhas = await simular(cid, canal);
      setSim({ linhas, margens: new Map() });
      const margens = await margensDaSimulacao(linhas, params);
      setSim({ linhas, margens });
    } catch (e) { setMsgs([e.message || String(e)]); } finally { setSimBusy(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (campanha?.id) rodarSimulacao(campanha.id, canalSim); }, [campanha?.id, canalSim]);

  const resumo = useMemo(() => (sim ? resumoSimulacao(sim.linhas, sim.margens) : null), [sim]);

  const salvarESimular = async () => { const cid = await salvar(); if (cid) await rodarSimulacao(cid); };

  const doPublicar = async () => {
    const cid = await salvar();
    if (!cid) return;
    if (!window.confirm(`Publicar "${form.nome}"? Os preços "de" ficam congelados e a promoção vale de ${fmtData(form.inicio && new Date(`${form.inicio}:00-03:00`))} a ${fmtData(form.fim && new Date(`${form.fim}:00-03:00`))}.`)) return;
    setBusy(true);
    try {
      await publicar(cid, false, user);
      onVoltar();
    } catch (e) {
      const conf = conflitosDoErro(e);
      if (conf) {
        const txt = conf.map((c) => `• ${c.campanha}: ${c.skus.length} item(ns) (${c.skus.slice(0, 5).join(", ")}${c.skus.length > 5 ? "…" : ""})`).join("\n");
        if (window.confirm(`Estes itens já estão em outra campanha no mesmo período:\n${txt}\n\nPublicar SEM esses itens?`)) {
          try { await publicar(cid, true, user); onVoltar(); } catch (e2) { setMsgs([e2.message || String(e2)]); }
        }
      } else setMsgs([e.message || String(e)]);
    } finally { setBusy(false); }
  };

  const doEncerrar = async () => {
    const st = statusCampanha(campanha);
    const aviso = st === "ativa" ? "Encerrar agora? O desconto some na hora." : st === "agendada" ? "Cancelar esta campanha agendada?" : "Cancelar este rascunho?";
    if (!window.confirm(aviso)) return;
    setBusy(true);
    try { await encerrar(campanha.id, user); onVoltar(); } catch (e) { setMsgs([e.message || String(e)]); setBusy(false); }
  };
  const doDuplicar = async () => {
    setBusy(true);
    try { const nid = await duplicar(campanha.id, user); const nova = (await listarCampanhas()).find((c) => c.id === nid); onAbrir(nova); }
    catch (e) { setMsgs([e.message || String(e)]); setBusy(false); }
  };
  const doExcluir = async () => {
    if (!window.confirm("Apagar este rascunho?")) return;
    try { await excluirRascunho(campanha.id); onVoltar(); } catch (e) { setMsgs([e.message || String(e)]); }
  };

  const alvoInput = (r, i) => {
    if (r.tipo === "geral") return <span className="text-xs text-gray-400 self-center">—</span>;
    const dis = !rascunho;
    if (r.tipo === "grupo") return <select disabled={dis} className={inp} value={r.alvo} onChange={(e) => setRegra(i, { alvo: e.target.value })}><option value="">Categoria…</option>{opcoes.grupos.map((g) => <option key={g.grupo}>{g.grupo}</option>)}</select>;
    if (r.tipo === "macro") return <select disabled={dis} className={inp} value={r.alvo} onChange={(e) => setRegra(i, { alvo: e.target.value })}><option value="">Macro…</option>{macros.map((m) => <option key={m}>{m}</option>)}</select>;
    if (r.tipo === "estado") return <select disabled={dis} className={inp} value={r.alvo} onChange={(e) => setRegra(i, { alvo: e.target.value })}><option value="">Condição…</option>{ESTADOS.map((m) => <option key={m}>{m}</option>)}</select>;
    if (r.tipo === "lote") return <select disabled={dis} className={inp} value={r.alvo} onChange={(e) => setRegra(i, { alvo: e.target.value })}><option value="">Lote…</option>{lotes.map((l) => <option key={l.lote} value={String(l.lote)}>{l.lote}{l.referencia ? ` · ${l.referencia}` : ""}</option>)}</select>;
    return <input disabled={dis} className={inp} placeholder="SKU" value={r.alvo} onChange={(e) => setRegra(i, { alvo: e.target.value.trim() })} />;
  };

  return (
    <div className="space-y-3">
      <button onClick={onVoltar} className="text-sm text-orange-600 font-bold">← Voltar</button>
      {campanha && <div className="flex items-center gap-2"><Selo c={campanha} /><span className="text-xs text-gray-500">{campanha.fim_previsto ? `Encerrada antes do prazo (previsto ${fmtData(campanha.fim_previsto)})` : ""}</span></div>}

      <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
        <label className="block text-xs font-bold text-gray-600">Nome
          <input disabled={!rascunho} className={inp} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex.: Semana do Cliente" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs font-bold text-gray-600">Início (Brasília)
            <input type="datetime-local" disabled={!rascunho} className={inp} value={form.inicio} onChange={(e) => setForm({ ...form, inicio: e.target.value })} />
          </label>
          <label className="block text-xs font-bold text-gray-600">Fim (Brasília)
            <input type="datetime-local" disabled={!rascunho} className={inp} value={form.fim} onChange={(e) => setForm({ ...form, fim: e.target.value })} />
          </label>
        </div>
        <label className="block text-xs font-bold text-gray-600">Arredondamento do preço
          <select disabled={!rascunho} className={inp} value={form.arredondamento} onChange={(e) => setForm({ ...form, arredondamento: e.target.value })}>
            {ARREDONDAMENTOS.map(([k, r]) => <option key={k} value={k}>{r}</option>)}
          </select>
        </label>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">Regras de desconto</h3>
        <p className="text-[11px] text-gray-500">Vale a mais específica: item › categoria › macro › lote/condição › canal › geral. 0% tira o alvo da campanha. Empate: menor desconto.</p>
        {regras === null && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
        {(regras || []).map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_1.4fr_1fr_4.5rem_auto] gap-1.5 items-start">
            <select disabled={!rascunho} className={inp} value={r.tipo} onChange={(e) => setRegra(i, { tipo: e.target.value, alvo: "" })}>{TIPOS_REGRA.map(([k, rot]) => <option key={k} value={k}>{rot}</option>)}</select>
            {alvoInput(r, i)}
            <select disabled={!rascunho} className={inp} value={r.canal} onChange={(e) => setRegra(i, { canal: e.target.value })}><option value="">Todos os canais</option>{opcoes.canais.map((c) => <option key={c.codigo} value={c.codigo}>{c.nome}</option>)}</select>
            <div className="relative"><input disabled={!rascunho} inputMode="decimal" className={`${inp} pr-5`} value={r.desconto_pct} onChange={(e) => setRegra(i, { desconto_pct: e.target.value.replace(",", ".") })} /><span className="absolute right-1.5 top-1.5 text-xs text-gray-400">%</span></div>
            {rascunho ? <button aria-label="Remover regra" onClick={() => setRegras((rs) => rs.filter((_, k) => k !== i))} className="p-1.5 text-gray-400"><Trash2 className="w-4 h-4" /></button> : <span />}
          </div>
        ))}
        {rascunho && <button onClick={() => setRegras((rs) => [...(rs || []), regraVazia()])} className="text-sm font-bold text-orange-600 flex items-center gap-1"><Plus className="w-4 h-4" /> Adicionar regra</button>}
        {!rascunho && regras && <ul className="text-xs text-gray-600 list-disc pl-4">{regras.map((r, i) => <li key={i}>{rotuloRegra(r, nomes)}</li>)}</ul>}
      </div>

      {msgs.length > 0 && <ul className="text-sm text-red-600 bg-red-50 rounded-lg p-2 list-disc pl-6">{msgs.map((m, i) => <li key={i}>{m}</li>)}</ul>}

      {rascunho && (
        <div className="flex flex-wrap gap-2">
          <button disabled={busy} onClick={salvarESimular} className="px-4 py-2 rounded-lg font-bold bg-white border border-gray-300 text-gray-800 disabled:opacity-50">{busy ? "Salvando…" : "Salvar e simular"}</button>
          <button disabled={busy || !regras?.length} onClick={doPublicar} className="px-4 py-2 rounded-lg font-bold bg-orange-500 text-white flex items-center gap-1 disabled:opacity-50"><Send className="w-4 h-4" /> Publicar</button>
          {campanha && <button onClick={doExcluir} className="px-3 py-2 text-sm text-red-600 font-bold">Apagar rascunho</button>}
        </div>
      )}
      {campanha && !rascunho && (
        <div className="flex flex-wrap gap-2">
          <button onClick={doDuplicar} disabled={busy} className="px-4 py-2 rounded-lg font-bold bg-white border border-gray-300 flex items-center gap-1"><Copy className="w-4 h-4" /> Duplicar</button>
          {["ativa", "agendada"].includes(statusCampanha(campanha)) && (
            <button onClick={doEncerrar} disabled={busy} className="px-4 py-2 rounded-lg font-bold bg-red-600 text-white flex items-center gap-1"><Ban className="w-4 h-4" /> {statusCampanha(campanha) === "ativa" ? "Encerrar agora" : "Cancelar"}</button>
          )}
        </div>
      )}

      {campanha && !rascunho && <Resultado id={campanha.id} />}

      {(sim || simBusy) && (
        <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">Previsibilidade {simBusy && <Loader2 className="inline w-3 h-3 animate-spin" />}</h3>
            <select className="rounded-lg border border-gray-300 px-2 py-1 text-xs" value={canalSim} onChange={(e) => setCanalSim(e.target.value)}>
              <option value="*">Todos os canais</option>{opcoes.canais.map((c) => <option key={c.codigo} value={c.codigo}>{c.nome}</option>)}
            </select>
          </div>
          {resumo && <Resumo r={resumo} />}
          {sim && <Tabela linhas={sim.linhas} margens={sim.margens} />}
        </div>
      )}
    </div>
  );
}

function Resumo({ r }) {
  const caixa = (rot, val, sub) => <div className="rounded-lg bg-gray-50 p-2"><p className="text-[11px] text-gray-500">{rot}</p><p className="font-extrabold text-gray-900">{val}</p>{sub && <p className="text-[11px] text-gray-500">{sub}</p>}</div>;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {caixa("Itens na campanha", r.itens, r.excluidos ? `${r.excluidos} fora (0%)` : null)}
        {caixa("Desconto médio", `${String(r.descontoMedioPct).replace(".", ",")}%`)}
        {caixa("Receita a preço cheio", money(r.cheio))}
        {caixa("Receita com desconto", money(r.promo), `desconto total ${money(r.desconto)}`)}
      </div>
      <div className="rounded-lg bg-gray-50 p-2 text-sm">
        <p className="text-[11px] text-gray-500">Lucro estimado ({r.comCusto} itens com custo)</p>
        <p className="font-bold text-gray-900">{money(r.lucroAntes)} → <span className={r.lucroDepois < 0 ? "text-red-600" : ""}>{money(r.lucroDepois)}</span></p>
        {r.semCusto > 0 && <p className="text-[11px] text-amber-700">{r.semCusto} itens sem custo cadastrado — margem parcial.</p>}
      </div>
      {r.abaixoPiso.length > 0 && <p className="text-xs text-red-700 bg-red-50 rounded-lg p-2 flex gap-1"><AlertTriangle className="w-4 h-4 shrink-0" /> {r.abaixoPiso.length} itens ficam com prejuízo (abaixo do piso): {r.abaixoPiso.slice(0, 8).join(", ")}{r.abaixoPiso.length > 8 ? "…" : ""}. É só um aviso; a publicação não é bloqueada.</p>}
      {r.conflitos > 0 && <p className="text-xs text-amber-800 bg-amber-50 rounded-lg p-2 flex gap-1"><AlertTriangle className="w-4 h-4 shrink-0" /> {r.conflitos} itens já estão em outra campanha no mesmo período e ficarão de fora se você publicar assim.</p>}
      <div>
        <p className="text-[11px] text-gray-500 mb-1">Se vender…</p>
        <div className="grid grid-cols-3 gap-2">{r.cenarios.map((c) => <div key={c.pct} className="rounded-lg bg-gray-50 p-2 text-center"><p className="text-[11px] text-gray-500">{c.pct}% dos itens</p><p className="text-sm font-bold">{money(c.receita)}</p><p className="text-[11px] text-gray-500">−{money(c.descontoDado)}</p></div>)}</div>
      </div>
    </div>
  );
}

function Tabela({ linhas, margens }) {
  const [todos, setTodos] = useState(false);
  const vis = todos ? linhas : linhas.slice(0, 50);
  if (!linhas.length) return <p className="text-sm text-gray-500">Nenhum item elegível (com preço e à venda) casa com essas regras.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead><tr className="text-left text-gray-500"><th className="py-1">SKU</th><th>De</th><th>Por</th><th>%</th><th>Regra</th></tr></thead>
        <tbody>
          {vis.map((l) => {
            const m = margens.get(l.sku); const prej = m && !m.semCusto && m.depois < 0;
            return (
              <tr key={l.sku} className={`border-t border-gray-100 ${prej ? "bg-red-50" : ""}`}>
                <td className="py-1 font-mono">{l.sku}{l.conflito_campanha && <span title={`Já está em "${l.conflito_nome}"`}> ⚠️</span>}</td>
                <td className="text-gray-400 line-through">{money(l.preco_cheio)}</td>
                <td className="font-bold">{money(l.preco)}</td>
                <td>{Number(l.desconto_pct) > 0 ? `${Number(l.desconto_pct)}%` : "fora"}</td>
                <td className="text-gray-500">{l.regra_tipo}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!todos && linhas.length > 50 && <button onClick={() => setTodos(true)} className="text-xs font-bold text-orange-600 mt-1">Ver todos os {linhas.length}</button>}
    </div>
  );
}

function Resultado({ id }) {
  const [r, setR] = useState(undefined); // undefined = carregando · null = falhou
  const carregar = useCallback(() => resultadoCampanha(id).then(setR).catch(() => setR(null)), [id]);
  useEffect(() => { carregar(); }, [carregar]);
  const x = resumoResultado(r);
  const caixa = (rot, val, sub) => <div className="rounded-lg bg-gray-50 p-2"><p className="text-[11px] text-gray-500">{rot}</p><p className="font-extrabold text-gray-900">{val}</p>{sub && <p className="text-[11px] text-gray-500">{sub}</p>}</div>;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">Resultado {r === undefined && <Loader2 className="inline w-3 h-3 animate-spin" />}</h3>
        <button onClick={carregar} className="text-xs font-bold text-orange-600">Atualizar</button>
      </div>
      {r === null && <p className="text-sm text-red-600">Não foi possível carregar o resultado.</p>}
      {x && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {caixa("Vendidos", `${x.vendidos} de ${x.total}`, `${String(x.conversaoPct).replace(".", ",")}% da campanha`)}
            {caixa("Receita", money(x.receita), `desconto concedido ${money(x.desconto)}`)}
          </div>
          <ul className="text-sm space-y-1">
            {x.decisoes.filter((d) => Number(d.itens) > 0).map((d) => (
              <li key={d.k} className="flex justify-between gap-2"><span className="text-gray-700">{ROTULO_DECISAO[d.k]}</span><b>{d.itens} · {money(d.receita)}</b></li>
            ))}
            {x.vendidos === 0 && <li className="text-gray-500">Nenhuma venda registrada ainda.</li>}
          </ul>
          {x.depoisDoFim > 0 && <p className="text-xs text-amber-800 bg-amber-50 rounded-lg p-2">{x.depoisDoFim} venda(s) fechada(s) depois do fim da campanha.</p>}
          <div className="rounded-lg bg-gray-50 p-2 text-sm space-y-0.5">
            <p><b>{x.sacolasAbertas}</b> sacola(s) a pagar com {x.itensEmSacola} item(ns) da campanha — desconto ainda comprometido: <b>{money(x.comprometido)}</b></p>
            <p><b>{x.naoVendidos}</b> item(ns) da campanha ainda à venda, fora de sacola</p>
            {x.foraDaSacola > 0 && <p><b>{x.foraDaSacola}</b> item(ns) vendido(s) na janela por outro caminho ({money(x.receitaFora)}), sem registro de campanha</p>}
          </div>
          {r.vendas?.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-gray-500"><th className="py-1">Item</th><th>De</th><th>Vendido</th><th>Quando</th></tr></thead>
                <tbody>{r.vendas.map((v) => (
                  <tr key={v.sku} className="border-t border-gray-100"><td className="py-1">{v.produto || v.sku}<span className="block text-[10px] text-gray-400">{ROTULO_DECISAO[v.decisao]} · {v.sacola}</span></td><td className="text-gray-400 line-through">{money(v.preco_cheio)}</td><td className="font-bold">{money(v.valor_vendido)}</td><td className="text-gray-500">{fmtData(v.fechado_em)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
