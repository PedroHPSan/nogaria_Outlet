import React, { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { ALL_STATUS, CLASSE_STYLE, fmtBRL, statusIdx, LOTE_SEM } from "../lib/model";
import { pendenteMedida } from "../lib/medidas";
import { carregarResultadoLotes } from "../lib/vendas";
import {
  Loader2, Ruler, ChevronRight, Package, TrendingUp, Gauge, ListChecks,
  Users, MapPin, Boxes, Coins, Tag, Camera, Sparkles,
} from "lucide-react";

const DEST_ORDER = ["Belém", "SP storage", "Venda local SP", "A definir"];
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtDia = (d) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const nomeUsuario = (email) => (email || "—").split("@")[0];

// Linha de "fila de trabalho": some quando não há nada pendente.
function QueueRow({ icon: Icon, color, label, hint, n, onClick }) {
  if (!n) return null;
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 py-2 text-left active:opacity-70">
      <span className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}><Icon className="w-4.5 h-4.5" /></span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800">{n.toLocaleString("pt-BR")} {label}</p>
        {hint && <p className="text-xs text-gray-400">{hint}</p>}
      </div>
      <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
    </button>
  );
}

export default function Dashboard({ lotes, onGoFiltered, refreshKey }) {
  const [stats, setStats] = useState(null);
  const [resultado, setResultado] = useState(null); // vw_lote_resultado (lucro realizado por lote)
  const [throughput, setThroughput] = useState(null); // vw_throughput_dia (ritmo)
  const [prod, setProd] = useState(null);             // vw_produtividade_dia (equipe)
  const [fin, setFin] = useState(null);               // vw_precificacao_resumo (financeiro)
  const [caixas, setCaixas] = useState(null);         // vw_caixas_abertas

  useEffect(() => {
    (async () => {
      // Busca todos os itens (colunas leves) para agregar no cliente.
      // O PostgREST limita cada resposta a 1.000 linhas, então paginamos
      // com .range() até trazer tudo (senão o total trava em 1.000).
      const PAGE = 1000;
      let data = [];
      for (let from = 0; ; from += PAGE) {
        const { data: chunk, error } = await supabase
          .from("itens").select("lote,classe,status,destino,preco_sugerido,valor_vendido,medidas_fonte,caixa_id,etiqueta_impressa,foto_feita")
          .order("sku").range(from, from + PAGE - 1);
        if (error || !chunk) break;
        data = data.concat(chunk);
        if (chunk.length < PAGE) break;
      }
      if (!data.length) return;
      const byStatus = {}, byClasse = {}, byLote = {}, byDestino = {};
      let valSug = 0, valVendido = 0, pendMedida = 0, semCaixa = 0;
      let semClasse = 0, destinoADefinir = 0, triSemEtiq = 0, triSemFoto = 0, triSemCaixa = 0;
      for (const it of data) {
        byStatus[it.status] = (byStatus[it.status] || 0) + 1;
        if (pendenteMedida(it)) pendMedida++;
        if (!it.caixa_id) semCaixa++;
        if (it.classe == null) semClasse++;
        const c = (byClasse[it.classe] = byClasse[it.classe] || { n: 0, val: 0, done: 0 });
        c.n++; c.val += Number(it.preco_sugerido) || 0;
        const done = statusIdx(it.status) >= 1 || it.status === "DESCARTE";
        if (done) c.done++;
        const l = (byLote[it.lote] = byLote[it.lote] || { n: 0, done: 0, val: 0 });
        l.n++; l.val += Number(it.preco_sugerido) || 0; if (done) l.done++;
        // Destino logístico (null/legado vira "A definir").
        const dest = it.destino || "A definir";
        const dd = (byDestino[dest] = byDestino[dest] || { n: 0, val: 0 });
        dd.n++; dd.val += Number(it.preco_sugerido) || 0;
        if (dest === "A definir") destinoADefinir++;
        // Pendências acionáveis dos itens já catalogados (triados+).
        const triado = it.status !== "A_CATALOGAR";
        if (triado && !it.etiqueta_impressa) triSemEtiq++;
        if (triado && !it.foto_feita) triSemFoto++;
        if (triado && !it.caixa_id) triSemCaixa++;
        valSug += Number(it.preco_sugerido) || 0;
        if (it.status === "VENDIDO" || it.status === "ENTREGUE") valVendido += Number(it.valor_vendido) || 0;
      }
      setStats({
        byStatus, byClasse, byLote, byDestino, valSug, valVendido, pendMedida, semCaixa,
        semClasse, destinoADefinir, triSemEtiq, triSemFoto, triSemCaixa, total: data.length,
      });
    })();
  }, [refreshKey]);

  // Resultado realizado por lote (view vw_lote_resultado). Silencioso se a view não existir.
  useEffect(() => {
    let cancel = false;
    carregarResultadoLotes()
      .then((rows) => { if (!cancel) setResultado(rows.filter((r) => Number(r.n_vendidos) > 0)); })
      .catch(() => { if (!cancel) setResultado([]); });
    return () => { cancel = true; };
  }, [refreshKey]);

  // Views de apoio do painel (ritmo, equipe, financeiro, caixas). Best-effort.
  useEffect(() => {
    let cancel = false;
    (async () => {
      const [t, p, f, c] = await Promise.all([
        supabase.from("vw_throughput_dia").select("*").order("dia"),
        supabase.from("vw_produtividade_dia").select("*"),
        supabase.from("vw_precificacao_resumo").select("*").maybeSingle(),
        supabase.from("vw_caixas_abertas").select("*").order("criado_em"),
      ]);
      if (cancel) return;
      setThroughput(t.data || []);
      setProd(p.data || []);
      setFin(f.data || null);
      setCaixas(c.data || []);
    })().catch(() => { if (!cancel) { setThroughput([]); setProd([]); setFin(null); setCaixas([]); } });
    return () => { cancel = true; };
  }, [refreshKey]);

  if (!stats) return <div className="py-20 text-center"><Loader2 className="w-7 h-7 animate-spin text-orange-500 mx-auto" /></div>;

  const catalogados = stats.total - (stats.byStatus["A_CATALOGAR"] || 0);
  const aCatalogar = stats.byStatus["A_CATALOGAR"] || 0;
  const pct = stats.total ? Math.round((catalogados / stats.total) * 100) : 0;
  const loteList = lotes
    .map((l) => ({ ...l, ...(stats.byLote[l.lote] || { n: 0, done: 0, val: 0 }) }))
    .sort((a, b) => b.val - a.val);
  // Itens sem lote (lote=null): vira a chave "null" no agregador.
  const semLote = stats.byLote["null"];
  if (semLote) loteList.unshift({ lote: LOTE_SEM, referencia: "Sem lote", ...semLote });

  // ---- Ritmo de catalogação (últimos 7 dias) + previsão de término ----
  const thr = throughput || [];
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 6);
  const cutoffStr = ymd(cutoff);
  const last7 = thr.filter((r) => r.dia >= cutoffStr);
  const triados7 = last7.reduce((s, r) => s + Number(r.triados || 0), 0);
  const diasAtivos = last7.filter((r) => Number(r.triados) > 0).length;
  const mediaDia = diasAtivos ? Math.round(triados7 / diasAtivos) : 0;
  const etaDias = mediaDia > 0 ? Math.ceil(aCatalogar / mediaDia) : null;
  const etaData = etaDias != null ? new Date(Date.now() + etaDias * 86400000) : null;
  const chartDias = thr.slice(-14);
  const maxTri = Math.max(1, ...chartDias.map((r) => Number(r.triados || 0)));

  // ---- Produtividade da equipe (últimos 7 dias) ----
  const prod7 = (prod || []).filter((r) => r.dia >= cutoffStr);
  const byUser = {};
  for (const r of prod7) {
    const u = (byUser[r.usuario] = byUser[r.usuario] || { triados: 0, etiquetas: 0, medidas: 0, caixas: 0, total: 0 });
    u.triados += Number(r.triados || 0); u.etiquetas += Number(r.etiquetas || 0);
    u.medidas += Number(r.medidas || 0); u.caixas += Number(r.caixas || 0); u.total += Number(r.total_acoes || 0);
  }
  const usersList = Object.entries(byUser).sort((a, b) => b[1].total - a[1].total);

  // ---- Destino logístico (ordem fixa + extras) ----
  const destKeys = [...DEST_ORDER.filter((d) => stats.byDestino[d]), ...Object.keys(stats.byDestino).filter((d) => !DEST_ORDER.includes(d))];

  const idade = (iso) => {
    const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return dias <= 0 ? "hoje" : dias === 1 ? "ontem" : `há ${dias} dias`;
  };

  return (
    <div className="px-4 pt-4 pb-24 space-y-4">
      {/* Progresso geral da catalogação */}
      <div className="bg-gray-900 rounded-2xl p-5 text-white">
        <p className="text-xs uppercase tracking-widest text-gray-400 font-semibold">Progresso da catalogação</p>
        <div className="flex items-end gap-3 mt-1">
          <span className="text-4xl font-bold">{pct}%</span>
          <span className="text-sm text-gray-300 pb-1">{catalogados.toLocaleString("pt-BR")} de {stats.total.toLocaleString("pt-BR")} itens</span>
        </div>
        <div className="h-2.5 bg-gray-700 rounded-full mt-3 overflow-hidden">
          <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
          <div className="bg-gray-800 rounded-xl p-3"><p className="text-gray-400 text-xs">Venda sugerida (catálogo)</p><p className="font-bold text-orange-400">{fmtBRL(stats.valSug)}</p></div>
          <div className="bg-gray-800 rounded-xl p-3"><p className="text-gray-400 text-xs">Já vendido</p><p className="font-bold text-emerald-400">{fmtBRL(stats.valVendido)}</p></div>
        </div>
      </div>

      {/* Ritmo de catalogação + previsão de término */}
      {thr.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3 flex items-center gap-1.5">
            <Gauge className="w-3.5 h-3.5" /> Ritmo de catalogação
          </h3>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-gray-50 rounded-xl p-2.5">
              <p className="text-xl font-bold text-gray-800">{triados7}</p>
              <p className="text-[11px] text-gray-400 leading-tight">triados<br />em 7 dias</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-2.5">
              <p className="text-xl font-bold text-orange-500">{mediaDia}</p>
              <p className="text-[11px] text-gray-400 leading-tight">por dia<br />trabalhado</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-2.5">
              <p className="text-xl font-bold text-gray-800">{etaDias != null ? `${etaDias}d` : "—"}</p>
              <p className="text-[11px] text-gray-400 leading-tight">p/ zerar<br />a fila</p>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2.5">
            {etaData
              ? <>Faltam <b>{aCatalogar.toLocaleString("pt-BR")}</b> a catalogar — no ritmo atual, conclui por volta de <b>{fmtDia(etaData)}</b>.</>
              : <>Faltam <b>{aCatalogar.toLocaleString("pt-BR")}</b> a catalogar. Sem ritmo recente para estimar a conclusão.</>}
          </p>
          {chartDias.length > 1 && (
            <div className="flex items-end gap-1 h-14 mt-3">
              {chartDias.map((r) => (
                <div key={r.dia} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${r.dia}: ${r.triados} triados`}>
                  <div className="w-full bg-orange-400 rounded-sm" style={{ height: `${Math.max(4, (Number(r.triados) / maxTri) * 100)}%`, opacity: Number(r.triados) ? 1 : 0.25 }} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filas de trabalho — pendências acionáveis */}
      {(stats.pendMedida + stats.semClasse + stats.destinoADefinir + stats.triSemEtiq + stats.triSemFoto) > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1 flex items-center gap-1.5">
            <ListChecks className="w-3.5 h-3.5" /> Filas de trabalho
          </h3>
          <div className="divide-y divide-gray-100">
            <QueueRow icon={Ruler} color="bg-amber-100 text-amber-700" n={stats.pendMedida}
              label="p/ medir" hint="Estimados ou não medidos (afeta o frete)" onClick={() => onGoFiltered({ pendMedida: true })} />
            <QueueRow icon={Sparkles} color="bg-purple-100 text-purple-700" n={stats.semClasse}
              label="sem classe" hint="Classificar (A+ … E)" onClick={() => onGoFiltered({ semClasse: true })} />
            <QueueRow icon={MapPin} color="bg-rose-100 text-rose-700" n={stats.destinoADefinir}
              label="com destino a definir" hint="Decidir Belém / storage / venda local" onClick={() => onGoFiltered({ destino: "A definir" })} />
            <QueueRow icon={Tag} color="bg-sky-100 text-sky-700" n={stats.triSemEtiq}
              label="triados sem etiqueta" hint="Imprimir etiqueta" onClick={() => onGoFiltered({ semEtiqueta: true })} />
            <QueueRow icon={Camera} color="bg-indigo-100 text-indigo-700" n={stats.triSemFoto}
              label="triados sem foto" hint="Fotografar" onClick={() => onGoFiltered({ semFoto: true })} />
          </div>
        </div>
      )}

      {resultado && resultado.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3 flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" /> Resultado por lote
          </h3>
          <div className="space-y-2.5">
            {resultado.map((r) => {
              const pctB = Math.round(Number(r.pct_breakeven || 0) * 100);
              const cobriu = pctB >= 100;
              return (
                <button key={String(r.lote)} onClick={() => onGoFiltered({ lote: r.lote == null ? LOTE_SEM : String(r.lote) })}
                  className="w-full text-left active:opacity-70">
                  <div className="flex justify-between items-baseline text-sm">
                    <span className="font-semibold text-gray-800">{r.lote == null ? "Sem lote" : `Lote ${r.lote}`}</span>
                    <span className={`font-bold ${Number(r.lucro_realizado) < 0 ? "text-red-600" : "text-emerald-600"}`}>{fmtBRL(r.lucro_realizado)}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${cobriu ? "bg-emerald-500" : "bg-orange-400"}`} style={{ width: `${Math.min(100, pctB)}%` }} />
                    </div>
                    <span className={`text-xs font-bold w-10 text-right ${cobriu ? "text-emerald-600" : "text-gray-500"}`}>{pctB}%</span>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-0.5">{fmtBRL(r.receita_bruta)} de {fmtBRL(r.custo_total)} pago · {r.n_vendidos} vendido(s)</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {stats.semCaixa > 0 && (
        <button onClick={() => onGoFiltered({ semCaixa: true })}
          className="w-full bg-white rounded-2xl border border-gray-200 p-4 flex items-center gap-3 text-left active:bg-gray-50">
          <span className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center flex-shrink-0"><Package className="w-4.5 h-4.5" /></span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800">{stats.semCaixa.toLocaleString("pt-BR")} itens a encaixotar</p>
            <p className="text-xs text-gray-400">Ainda sem caixa — encaixote em Conferir → Encaixotar</p>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
        </button>
      )}

      {/* Destino logístico (Belém × storage × ...) */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3 flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5" /> Destino logístico
        </h3>
        <div className="space-y-2">
          {destKeys.map((d) => {
            const v = stats.byDestino[d];
            const aDefinir = d === "A definir";
            return (
              <button key={d} onClick={() => onGoFiltered({ destino: d })} className="w-full flex items-center gap-3 active:opacity-70">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${aDefinir ? "bg-rose-400" : "bg-orange-400"}`} />
                <div className="flex-1 text-left min-w-0">
                  <p className={`text-sm font-semibold ${aDefinir ? "text-rose-700" : "text-gray-800"}`}>{d}</p>
                  <p className="text-xs text-gray-400">{fmtBRL(v.val)} em catálogo</p>
                </div>
                <span className="text-sm font-bold text-gray-700">{v.n.toLocaleString("pt-BR")}</span>
                <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Caixas em aberto */}
      {caixas && caixas.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3 flex items-center gap-1.5">
            <Boxes className="w-3.5 h-3.5" /> Caixas em aberto ({caixas.length})
          </h3>
          <div className="space-y-2.5">
            {caixas.map((c) => (
              <div key={c.codigo} className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0 text-[11px] font-bold">{c.n_itens}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{c.codigo} · {c.destino || "—"}</p>
                  <p className="text-xs text-gray-400 truncate">{c.local_fisico || "sem local"} · aberta {idade(c.criado_em)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Produtividade da equipe (7 dias) */}
      {usersList.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" /> Produtividade da equipe <span className="text-gray-300 normal-case font-medium">· 7 dias</span>
          </h3>
          <div className="grid grid-cols-[1fr_auto] gap-x-3 text-[11px] text-gray-400 uppercase tracking-wide font-semibold pb-1 border-b border-gray-100">
            <span>Pessoa</span>
            <span className="tabular-nums">Triag · Etiq · Med · Cx</span>
          </div>
          <div className="divide-y divide-gray-100">
            {usersList.map(([email, u]) => (
              <div key={email} className="grid grid-cols-[1fr_auto] gap-x-3 items-center py-2">
                <span className="text-sm font-semibold text-gray-800 truncate">{nomeUsuario(email)}</span>
                <span className="text-sm text-gray-600 tabular-nums font-medium">
                  <b className="text-gray-900">{u.triados}</b> · {u.etiquetas} · {u.medidas} · {u.caixas}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Saúde financeira do estoque catalogado */}
      {fin && (Number(fin.n_viavel) + Number(fin.n_inviavel)) > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3 flex items-center gap-1.5">
            <Coins className="w-3.5 h-3.5" /> Potencial financeiro (catalogado)
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-400">Lucro líquido projetado</p>
              <p className="font-bold text-emerald-600">{fmtBRL(fin.lucro_liquido_potencial)}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-400">Receita potencial (anúncio)</p>
              <p className="font-bold text-gray-800">{fmtBRL(fin.anuncio_potencial)}</p>
            </div>
          </div>
          <div className="flex items-center justify-between mt-3 text-sm">
            <span className="text-emerald-600 font-semibold">{Number(fin.n_viavel).toLocaleString("pt-BR")} viáveis p/ anúncio</span>
            <span className="text-gray-400">·</span>
            <span className="text-red-600 font-semibold">{Number(fin.n_inviavel).toLocaleString("pt-BR")} inviáveis (revisar)</span>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">Funil de status</h3>
        <div className="space-y-1.5">
          {ALL_STATUS.map((s) => {
            const n = stats.byStatus[s.id] || 0;
            const w = stats.total ? Math.max(2, (n / stats.total) * 100) : 0;
            return (
              <button key={s.id} onClick={() => onGoFiltered({ status: s.id })} className="w-full flex items-center gap-2">
                <span className="text-xs text-gray-600 w-28 text-left truncate">{s.label}</span>
                <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
                  <div className={`h-full rounded ${s.id === "DESCARTE" ? "bg-red-300" : s.id === "VENDIDO" ? "bg-emerald-500" : "bg-orange-400"}`} style={{ width: `${w}%`, opacity: n ? 1 : 0.2 }} />
                </div>
                <span className="text-xs font-bold text-gray-700 w-12 text-right">{n.toLocaleString("pt-BR")}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">Onde está o dinheiro (por classe)</h3>
        <div className="space-y-2">
          {["A+", "A", "B", "C", "D", "E"].map((c) => {
            const d = stats.byClasse[c]; if (!d) return null;
            return (
              <button key={c} onClick={() => onGoFiltered({ classe: c })} className="w-full flex items-center gap-3">
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${CLASSE_STYLE[c]}`}>{c}</span>
                <div className="flex-1 text-left">
                  <p className="text-sm font-semibold text-gray-800">{fmtBRL(d.val)}</p>
                  <p className="text-xs text-gray-400">{d.n} itens · {d.done} processados</p>
                </div>
                <span className="text-xs font-bold text-gray-500">{d.n ? Math.round((d.done / d.n) * 100) : 0}%</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">Lotes (por valor sugerido)</h3>
        <div className="space-y-2.5">
          {loteList.map((l) => {
            const p = l.n ? Math.round((l.done / l.n) * 100) : 0;
            return (
              <button key={l.lote} onClick={() => onGoFiltered({ lote: String(l.lote) })} className="w-full text-left">
                <div className="flex justify-between text-sm">
                  <span className="font-semibold text-gray-800">{l.lote === LOTE_SEM ? "Sem lote" : `Lote ${l.lote}`}</span>
                  <span className="text-gray-500">{fmtBRL(l.val)} · {l.done}/{l.n}</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full mt-1 overflow-hidden"><div className="h-full bg-gray-800 rounded-full" style={{ width: `${p}%` }} /></div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
