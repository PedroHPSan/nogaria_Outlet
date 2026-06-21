import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../lib/supabase";
import { CLASSE_STYLE, DESTINOS, buildSku } from "../lib/model";
import { DEFAULT_PARAMS } from "../lib/pricing";
import { sugerirCategoria } from "../lib/categorizar";
import { desmembrarItem } from "../lib/conferencia";
import { classeAutomatica } from "../lib/classificacao";
import CategoriaPicker from "../components/CategoriaPicker";
import { ChevronLeft, Loader2, PackagePlus, AlertTriangle, RefreshCw } from "lucide-react";

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white";
const CLASSES = ["A+", "A", "B", "C", "D", "E"];

function Field({ label, children }) {
  return (
    <label className="block py-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

export default function NewItem({ lotes, user, params = DEFAULT_PARAMS, onClose, onCreated }) {
  const semLotes = !lotes.length;
  const catList = useMemo(
    () => Object.keys(params.grupos || {}).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [params]
  );
  // Modo do lote: "existente" | "novo" | "sem" (criar sem lote, definir depois)
  const [loteMode, setLoteMode] = useState(semLotes ? "novo" : "existente");
  const [loteSel, setLoteSel] = useState(lotes[0] ? String(lotes[0].lote) : "");
  const [loteNum, setLoteNum] = useState("");
  const [loteRef, setLoteRef] = useState("");
  const [sku, setSku] = useState("");
  const [skuAuto, setSkuAuto] = useState(true);
  const [produto, setProduto] = useState("");
  const [grupo, setGrupo] = useState("");
  const [classe, setClasse] = useState("");
  const [precoNovo, setPrecoNovo] = useState("");
  const [precoSug, setPrecoSug] = useState("");
  const [destino, setDestino] = useState("");
  const [qtdUnidades, setQtdUnidades] = useState("1");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");

  const loteAtual = loteMode === "novo" ? loteNum : loteMode === "existente" ? loteSel : "";

  // Sugestão de categoria a partir do nome do produto (casa com pricing_grupo).
  const sugCat = useMemo(() => sugerirCategoria(produto, catList), [produto, catList]);
  // Ao escolher/sugerir categoria, preenche a classe da categoria se ainda vazia.
  const aplicarCategoria = (g) => {
    setGrupo(g);
    if (g && !classe) {
      const c = params.grupos?.[g]?.classe;
      if (c) setClasse(c);
    }
  };

  // Sugere o próximo SKU: NOG-<lote>-<maxSeq+1>, ou NOG-SL-<maxSeq+1> sem lote.
  const sugerirSku = useCallback(async (loteVal, modo) => {
    if (modo === "sem") {
      const { data } = await supabase
        .from("itens").select("sku").like("sku", "NOG-SL-%").order("sku", { ascending: false }).limit(1);
      let seq = 1;
      if (data && data.length) seq = (parseInt(data[0].sku.split("-").pop(), 10) || 0) + 1;
      setSku(buildSku(null, seq));
      return;
    }
    const n = Number(loteVal);
    if (!n) { setSku(""); return; }
    const { data } = await supabase
      .from("itens").select("sku").eq("lote", n).order("sku", { ascending: false }).limit(1);
    let seq = 1;
    if (data && data.length) seq = (parseInt(data[0].sku.split("-").pop(), 10) || 0) + 1;
    setSku(buildSku(n, seq));
  }, []);

  useEffect(() => {
    if (!skuAuto) return;
    if (loteMode === "sem") sugerirSku(null, "sem");
    else if (loteAtual) sugerirSku(loteAtual, loteMode);
    else setSku("");
  }, [loteAtual, loteMode, skuAuto, sugerirSku]);

  const salvar = async () => {
    setErro("");
    if (!produto.trim()) return setErro("Informe o nome do produto.");
    if (loteMode === "novo" && !Number(loteNum)) return setErro("Informe o número do novo lote.");
    if (loteMode === "existente" && !loteSel) return setErro("Selecione um lote.");
    if (!sku.trim()) return setErro("SKU inválido.");
    setBusy(true);
    try {
      const semLote = loteMode === "sem";
      const loteN = semLote ? null : Number(loteAtual);

      // 1) Cria o lote primeiro (FK itens_lote_fkey) se for novo e ainda não existir
      if (!semLote && !lotes.some((l) => l.lote === loteN)) {
        const { error } = await supabase.from("lotes").insert({ lote: loteN, referencia: loteRef.trim() || null });
        if (error && error.code !== "23505") throw error;
      }

      // 2) Insere o item (status/estado omitidos → usam o default do enum)
      // Nenhum item nasce sem classe: usa a escolhida ou deriva (categoria → valor → C).
      const grupoFinal = grupo.trim() || null;
      const classeFinal = classe || classeAutomatica(
        { grupo: grupoFinal, preco_novo_est: precoNovo || null, preco_sugerido: precoSug || null },
        params,
      ).classe;
      const base = {
        lote: loteN,
        produto: produto.trim(),
        grupo: grupoFinal,
        classe: classeFinal,
        preco_novo_est: precoNovo || null,
        preco_sugerido: precoSug || null,
        ...(destino ? { destino } : {}),
        quantidade: 1,
        upd_by: user.email,
      };

      let finalSku = sku.trim();
      let inserted = null, lastErr = null;
      for (let i = 0; i < 5; i++) {
        const { data, error } = await supabase.from("itens").insert({ ...base, sku: finalSku }).select().single();
        if (!error) { inserted = data; break; }
        lastErr = error;
        // Colisão de SKU (23505): se for automático, tenta o próximo seq; se for manual, erro.
        if (error.code === "23505" && skuAuto) {
          const seq = (parseInt(finalSku.split("-").pop(), 10) || 0) + 1;
          finalSku = buildSku(loteN, seq);
        } else break;
      }
      if (!inserted) {
        if (lastErr?.code === "23505") throw new Error(`SKU ${finalSku} já existe.`);
        throw lastErr || new Error("Falha ao criar o item.");
      }

      // 3) Auditoria — renderiza como "→ A catalogar" na aba Registro
      await supabase.from("eventos").insert({ sku: finalSku, acao: "status:A_CATALOGAR", usuario: user.email });

      // 4) Várias unidades: desmembra em N itens individuais (1 SKU cada)
      const unidades = Math.floor(Number(qtdUnidades) || 1);
      if (unidades > 1) {
        try { await desmembrarItem(inserted, unidades, user); }
        catch (e) { alert("Item criado, mas falha ao criar as unidades extras: " + (e.message || e)); }
      }

      onCreated(inserted);
    } catch (e) {
      setErro("Erro ao criar: " + (e.message || e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col">
      <div className="bg-gray-900 text-white px-4 pt-4 pb-3 shadow-md flex items-center justify-between">
        <button onClick={onClose} className="flex items-center gap-1 text-gray-300 text-sm py-1">
          <ChevronLeft className="w-5 h-5" /> Voltar
        </button>
        <span className="flex items-center gap-1.5 font-semibold text-orange-400">
          <PackagePlus className="w-4 h-4" /> Novo item
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-32">
        {/* Lote */}
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-2 mb-4 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 pt-2 pb-1">Lote</h3>
          <div className="flex gap-1.5 pb-2">
            {[
              ...(!semLotes ? [{ id: "existente", t: "Existente" }] : []),
              { id: "novo", t: "Novo lote" },
              { id: "sem", t: "Sem lote" },
            ].map((m) => (
              <button key={m.id} onClick={() => { setLoteMode(m.id); setSkuAuto(true); }}
                className={`flex-1 px-2 py-1.5 rounded-lg text-sm font-semibold border ${loteMode === m.id ? "bg-orange-500 text-white border-orange-500" : "bg-white text-gray-600 border-gray-300"}`}>
                {m.t}
              </button>
            ))}
          </div>
          {loteMode === "existente" && (
            <Field label="Selecione o lote">
              <select value={loteSel} onChange={(e) => setLoteSel(e.target.value)} className={inputCls}>
                {lotes.map((l) => (
                  <option key={l.lote} value={String(l.lote)}>Lote {l.lote} — {l.referencia || ""}</option>
                ))}
              </select>
            </Field>
          )}
          {loteMode === "novo" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nº do lote (leilão)">
                <input type="number" inputMode="numeric" className={inputCls} value={loteNum}
                  onChange={(e) => setLoteNum(e.target.value)} placeholder="ex.: 126" />
              </Field>
              <Field label="Referência">
                <input className={inputCls} value={loteRef} onChange={(e) => setLoteRef(e.target.value)} placeholder="ex.: MAI 16/26" />
              </Field>
            </div>
          )}
          {loteMode === "sem" && (
            <p className="text-sm text-gray-500 py-2 flex items-start gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              O item será criado <b className="mx-1">sem lote</b> e poderá ser catalogado normalmente. Defina o lote depois na aba <b className="ml-1">Conferir</b>.
            </p>
          )}
        </div>

        {/* Identificação */}
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-2 mb-4 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 pt-2 pb-1">Identificação</h3>
          <Field label="SKU">
            <div className="flex gap-2">
              <input className={`${inputCls} font-mono`} value={sku}
                onChange={(e) => { setSku(e.target.value); setSkuAuto(false); }} placeholder="NOG-000-000" />
              {!skuAuto && loteAtual && (
                <button onClick={() => { setSkuAuto(true); sugerirSku(loteAtual); }}
                  className="px-3 rounded-lg border border-gray-300 text-gray-500 flex items-center" title="Gerar automático">
                  <RefreshCw className="w-4 h-4" />
                </button>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1">{skuAuto ? "Gerado automaticamente a partir do lote." : "Editado manualmente."}</p>
          </Field>
          <Field label="Produto *">
            <textarea className={inputCls} rows={2} value={produto} onChange={(e) => setProduto(e.target.value)}
              placeholder="Descrição do produto" />
          </Field>
          <Field label="Grupo / categoria">
            <CategoriaPicker value={grupo} onChange={aplicarCategoria} grupos={catList} sugestao={sugCat} />
          </Field>
          <Field label="Classe">
            <div className="flex flex-wrap gap-1.5">
              {CLASSES.map((c) => (
                <button key={c} onClick={() => setClasse(classe === c ? "" : c)}
                  className={`px-3.5 py-1.5 rounded-lg text-sm font-bold border ${classe === c ? CLASSE_STYLE[c] + " border-transparent" : "bg-white text-gray-500 border-gray-300"}`}>
                  {c}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Quantidade de unidades">
            <input type="number" inputMode="numeric" min="1" className={inputCls} value={qtdUnidades}
              onChange={(e) => setQtdUnidades(e.target.value)} />
            {Number(qtdUnidades) > 1 && (
              <p className="text-xs text-gray-400 mt-1">Serão criados {Math.floor(Number(qtdUnidades))} itens individuais (1 SKU cada), um por unidade.</p>
            )}
          </Field>
        </div>

        {/* Preço & destino */}
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-2 mb-4 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 pt-2 pb-1">Preço & destino (opcional)</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Preço novo est. (R$)">
              <input type="number" inputMode="decimal" className={inputCls} value={precoNovo} onChange={(e) => setPrecoNovo(e.target.value)} />
            </Field>
            <Field label="Venda sugerida (R$)">
              <input type="number" inputMode="decimal" className={inputCls} value={precoSug} onChange={(e) => setPrecoSug(e.target.value)} />
            </Field>
          </div>
          <Field label="Destino logístico">
            <div className="flex flex-wrap gap-1.5">
              {DESTINOS.map((d) => (
                <button key={d} onClick={() => setDestino(destino === d ? "" : d)}
                  className={`px-3 py-1.5 rounded-lg text-sm border ${destino === d ? "bg-orange-500 text-white border-orange-500" : "bg-white text-gray-600 border-gray-300"}`}>
                  {d}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </div>

      <div className="absolute bottom-0 inset-x-0 bg-white border-t border-gray-200 px-4 py-3 shadow-lg">
        {erro && <p className="text-xs text-red-600 flex items-center gap-1.5 mb-2"><AlertTriangle className="w-3.5 h-3.5" /> {erro}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl py-3.5 font-semibold border border-gray-300 text-gray-700 bg-white">Cancelar</button>
          <button disabled={busy} onClick={salvar}
            className="flex-1 rounded-xl py-3.5 font-bold bg-orange-500 text-white disabled:opacity-60 flex items-center justify-center gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackagePlus className="w-4 h-4" />} Criar item
          </button>
        </div>
      </div>
    </div>
  );
}
