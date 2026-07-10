# Conferência e armazenamento de caixas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir indicar/atualizar o local de armazenamento de uma caixa (propagando aos itens), conferir o conteúdo caixa a caixa e registrar chegada + armazenamento no histórico da caixa.

**Architecture:** Uma migration adiciona 3 colunas em `caixas` (`chegou_em`, `conferida_em`, `conferida_por`). A lógica de dados vive em `src/lib/caixas.js` (funções que falam com o Supabase, no padrão do arquivo) com os helpers puros de formatação isolados em `src/lib/caixasFormat.js` (testáveis no harness Node). A UI é uma tela `CaixasScreen.jsx` (lista + scan + detalhe/conferência) que substitui `CaixaQrScreen.jsx`, aberta pelo botão flutuante "Caixa QR". `App.jsx` ganha rótulos dos novos eventos.

**Tech Stack:** React 18, Supabase JS, Tailwind, lucide-react, jspdf. Testes: scripts `.mjs` com `node:assert` (só módulos puros — importar módulo que puxa `supabase.js` quebra em Node).

---

## File Structure

- Create: `supabase/migrations/20260710120000_caixas_chegada_conferencia.sql` — colunas novas.
- Create: `src/lib/caixasFormat.js` — helpers puros (`formatDataBR`, `chegadaDetalhe`).
- Modify: `src/lib/caixas.js` — novas funções de dados (`definirLocalCaixa`, `registrarChegada`, `conferirCaixa`, `marcarItemAvariado`, `marcarItemFaltando`, `historicoCaixa`).
- Create: `src/screens/CaixasScreen.jsx` — lista + scan + detalhe/conferência.
- Delete: `src/screens/CaixaQrScreen.jsx` — substituída por `CaixasScreen`.
- Modify: `src/App.jsx` — troca import/uso da tela + rótulos de evento em `eventoLabel`.
- Create: `scripts/test_caixas.mjs` — testa os helpers puros.
- Modify: `package.json` — inclui `test:caixas` no `test`.

---

## Task 1: Migration das colunas de chegada/conferência

**Files:**
- Create: `supabase/migrations/20260710120000_caixas_chegada_conferencia.sql`

- [ ] **Step 1: Escrever a migration**

Arquivo `supabase/migrations/20260710120000_caixas_chegada_conferencia.sql`:

```sql
-- Conferência de caixas: chegada (ex.: em Belém) e carimbo de reconferência.
alter table public.caixas
  add column if not exists chegou_em     timestamptz,
  add column if not exists conferida_em  timestamptz,
  add column if not exists conferida_por text;

comment on column public.caixas.chegou_em     is 'Data de chegada da caixa (ex.: em Belém).';
comment on column public.caixas.conferida_em  is 'Quando a caixa foi reconferida.';
comment on column public.caixas.conferida_por is 'E-mail de quem reconferiu a caixa.';
```

- [ ] **Step 2: Aplicar a migration (requer aprovação Pedro/Bárbara)**

A migration é DDL e precisa da aprovação dos donos do schema antes de aplicar no projeto `yqimfktanresuboqfdti`. Aplicar via MCP `apply_migration` (name: `caixas_chegada_conferencia`, query = conteúdo do arquivo) **somente após o ok**.

Verificação após aplicar (MCP `execute_sql`):

```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='caixas'
  and column_name in ('chegou_em','conferida_em','conferida_por')
order by column_name;
```
Esperado: 3 linhas (`chegou_em`, `conferida_em`, `conferida_por`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260710120000_caixas_chegada_conferencia.sql
git commit -m "feat(caixas): migration de chegada e conferência (chegou_em, conferida_em/por)"
```

---

## Task 2: Helpers puros de formatação (`caixasFormat.js`)

**Files:**
- Create: `src/lib/caixasFormat.js`
- Create (test): `scripts/test_caixas.mjs`

- [ ] **Step 1: Escrever o teste que falha**

Arquivo `scripts/test_caixas.mjs`:

```javascript
// Testes das funções PURAS de caixas (caixasFormat.js). Rode: npm run test:caixas
import assert from "node:assert/strict";
import { formatDataBR, chegadaDetalhe } from "../src/lib/caixasFormat.js";

let passou = 0;
const eq = (a, b, msg) => { assert.equal(a, b, msg); passou++; console.log(`  ok  ${msg}`); };

console.log("formatDataBR");
eq(formatDataBR("2026-07-08"), "08/07/2026", "converte YYYY-MM-DD sem escorregar de fuso");
eq(formatDataBR("2026-07-08T12:00:00Z"), "08/07/2026", "aceita ISO com hora");
eq(formatDataBR(""), "", "vazio → string vazia");
eq(formatDataBR(null), "", "null → string vazia");

console.log("chegadaDetalhe");
eq(chegadaDetalhe("2026-07-08", "Galpão A"), "Belém · 08/07/2026 · Galpão A", "monta detalhe completo");
eq(chegadaDetalhe("2026-07-08", ""), "Belém · 08/07/2026", "sem local, omite o local");
eq(chegadaDetalhe("2026-07-08", null), "Belém · 08/07/2026", "local null é omitido");
eq(chegadaDetalhe("", "Galpão A"), "Belém · Galpão A", "sem data, omite a data");

console.log(`\n${passou} asserções OK`);
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `node scripts/test_caixas.mjs`
Esperado: FALHA (`Cannot find module '../src/lib/caixasFormat.js'`).

- [ ] **Step 3: Implementar os helpers puros**

Arquivo `src/lib/caixasFormat.js`:

```javascript
// Helpers puros de caixas (sem dependência do Supabase, testáveis no Node).

// Formata data para dd/mm/aaaa. Aceita "YYYY-MM-DD" (do <input type=date>) sem
// escorregar de fuso, e ISO com hora como fallback. Vazio/null → "".
export function formatDataBR(v) {
  if (!v) return "";
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  return isNaN(d) ? "" : d.toLocaleDateString("pt-BR");
}

// Detalhe do evento de chegada: "Belém · dd/mm/aaaa · <local>", omitindo partes vazias.
export function chegadaDetalhe(chegouEm, local) {
  return ["Belém", formatDataBR(chegouEm), String(local || "").trim()]
    .filter(Boolean)
    .join(" · ");
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `node scripts/test_caixas.mjs`
Esperado: `11 asserções OK`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/caixasFormat.js scripts/test_caixas.mjs
git commit -m "feat(caixas): helpers puros formatDataBR/chegadaDetalhe + testes"
```

---

## Task 3: Funções de dados em `caixas.js`

**Files:**
- Modify: `src/lib/caixas.js`

- [ ] **Step 1: Importar o helper de formatação**

No topo de `src/lib/caixas.js`, logo abaixo de `import { pad3 } from "./model";`, adicionar:

```javascript
import { chegadaDetalhe } from "./caixasFormat";
```

- [ ] **Step 2: Adicionar as funções novas ao final do arquivo**

Ao final de `src/lib/caixas.js`, acrescentar:

```javascript
// ───────────────────────── Chegada / armazenamento / conferência ─────────────────────────

// Define o local de armazenamento da caixa e PROPAGA para os itens dela. Grava
// evento `caixa:local`. Usado para "indicar onde a caixa está armazenada".
export async function definirLocalCaixa(codigo, local, user) {
  const l = local?.trim() || null;
  const { data, error } = await supabase.from("caixas")
    .update({ local_fisico: l }).eq("codigo", codigo).select().single();
  if (error) throw error;
  await supabase.from("itens").update({ local_fisico: l, upd_by: user?.email }).eq("caixa_id", codigo);
  await supabase.from("eventos").insert({
    sku: codigo, acao: "caixa:local", detalhe: l || "sem local", usuario: user?.email,
  });
  return data;
}

// Registra a chegada (ex.: em Belém): grava `chegou_em` + local (propagado aos itens)
// e evento `caixa:chegada` com detalhe "Belém · dd/mm/aaaa · <local>". `chegou_em`
// aceita data retroativa (default: agora).
export async function registrarChegada(codigo, { chegou_em, local }, user) {
  const l = local?.trim() || null;
  const quando = chegou_em || new Date().toISOString();
  const { data, error } = await supabase.from("caixas")
    .update({ chegou_em: quando, local_fisico: l }).eq("codigo", codigo).select().single();
  if (error) throw error;
  await supabase.from("itens").update({ local_fisico: l, upd_by: user?.email }).eq("caixa_id", codigo);
  await supabase.from("eventos").insert({
    sku: codigo, acao: "caixa:chegada", detalhe: chegadaDetalhe(quando, l), usuario: user?.email,
  });
  return data;
}

// Marca a caixa como reconferida (carimbo quem/quando) + evento `caixa:conferida`.
export async function conferirCaixa(codigo, user) {
  const { data, error } = await supabase.from("caixas")
    .update({ conferida_em: new Date().toISOString(), conferida_por: user?.email })
    .eq("codigo", codigo).select().single();
  if (error) throw error;
  await supabase.from("eventos").insert({ sku: codigo, acao: "caixa:conferida", usuario: user?.email });
  return data;
}

// Item danificado na conferência: estado='Avariado', permanece na caixa. Evento `caixa:item_avaria`.
export async function marcarItemAvariado(sku, user) {
  const { error } = await supabase.from("itens")
    .update({ estado: "Avariado", upd_by: user?.email }).eq("sku", sku);
  if (error) throw error;
  await supabase.from("eventos").insert({ sku, acao: "caixa:item_avaria", usuario: user?.email });
}

// Item ausente na conferência: sai da caixa (caixa_id=null). Evento `caixa:item_faltando`.
export async function marcarItemFaltando(sku, user) {
  const { error } = await supabase.from("itens")
    .update({ caixa_id: null, upd_by: user?.email }).eq("sku", sku);
  if (error) throw error;
  await supabase.from("eventos").insert({ sku, acao: "caixa:item_faltando", usuario: user?.email });
}

// Histórico de uma caixa (eventos cuja `sku` é o código da caixa), recentes primeiro.
export async function historicoCaixa(codigo) {
  const { data } = await supabase.from("eventos")
    .select("*").eq("sku", codigo).order("ts", { ascending: false });
  return data || [];
}
```

- [ ] **Step 3: Sanidade de lint/build**

Run: `npm run lint`
Esperado: sem erros novos em `src/lib/caixas.js` / `src/lib/caixasFormat.js`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/caixas.js
git commit -m "feat(caixas): definirLocal/registrarChegada/conferir/avaria/faltando/historico"
```

---

## Task 4: Tela `CaixasScreen` (lista + scan + conferência)

**Files:**
- Create: `src/screens/CaixasScreen.jsx`

- [ ] **Step 1: Criar a tela completa**

Arquivo `src/screens/CaixasScreen.jsx`:

```jsx
import React, { useState, useEffect, useCallback, Suspense } from "react";
import {
  listarCaixas, buscarCaixa, itensDaCaixa,
  registrarChegada, conferirCaixa, definirLocalCaixa,
  marcarItemAvariado, marcarItemFaltando, historicoCaixa,
} from "../lib/caixas";
import { estimarValorCaixa, estimarValorVenda, estimarPesoCaixa } from "../lib/classificacao";
import { CLASSE_STYLE, fmtBRL, fmtKg } from "../lib/model";
import {
  X, Loader2, ScanLine, ArrowRight, AlertTriangle, Boxes, Package, ChevronRight,
  ChevronLeft, MapPin, CalendarCheck, ClipboardCheck, PackageX, Search, CheckCircle2, History,
} from "lucide-react";

const BarcodeScanner = React.lazy(() => import("./BarcodeScanner"));

// data de hoje em "YYYY-MM-DD" (para o <input type=date>).
const hojeISO = () => new Date().toISOString().slice(0, 10);

const eventoCaixaLabel = (a) => ({
  "caixa:criada": "caixa criada", "caixa:item_add": "item encaixotado",
  "caixa:item_remove": "item removido", "caixa:fechada": "caixa fechada",
  "caixa:reaberta": "caixa reaberta", "caixa:chegada": "chegada registrada",
  "caixa:local": "armazenamento", "caixa:conferida": "caixa conferida",
  "caixa:item_avaria": "item avariado", "caixa:item_faltando": "item faltando",
}[a] || a);

// Tela de caixas: lista (com filtro), scan por QR e detalhe/conferência.
export default function CaixasScreen({ params, user, onClose, onOpenItem }) {
  const [fase, setFase] = useState("lista"); // "lista" | "scan" | "buscando" | "detalhe"
  const [filtro, setFiltro] = useState("pendentes"); // "pendentes" | "conferidas" | "todas"
  const [caixas, setCaixas] = useState([]);
  const [caixa, setCaixa] = useState(null);
  const [itens, setItens] = useState([]);
  const [hist, setHist] = useState([]);
  const [erro, setErro] = useState(null);
  const [manual, setManual] = useState("");

  const carregarLista = useCallback(async () => {
    setCaixas(await listarCaixas());
  }, []);
  useEffect(() => { carregarLista(); }, [carregarLista]);

  const abrir = async (texto) => {
    const cod = String(texto || "").trim();
    if (!cod) return;
    setFase("buscando"); setErro(null);
    try {
      const c = await buscarCaixa(cod);
      if (!c) { setErro(`Nenhuma caixa/mala com o código "${cod}".`); setFase(caixas.length ? "lista" : "scan"); return; }
      setCaixa(c);
      setItens(await itensDaCaixa(c.codigo));
      setHist(await historicoCaixa(c.codigo));
      setFase("detalhe");
    } catch (e) {
      setErro("Falha ao buscar: " + (e.message || String(e))); setFase("lista");
    }
  };

  const recarregarDetalhe = async () => {
    if (!caixa) return;
    const c = await buscarCaixa(caixa.codigo);
    setCaixa(c);
    setItens(await itensDaCaixa(c.codigo));
    setHist(await historicoCaixa(c.codigo));
  };

  const voltarLista = async () => { setCaixa(null); setErro(null); setManual(""); await carregarLista(); setFase("lista"); };

  // ---- Fase: detalhe/conferência ----
  if (fase === "detalhe" && caixa) {
    return (
      <CaixaDetalhe
        caixa={caixa} itens={itens} hist={hist} params={params} user={user}
        onBack={voltarLista} onClose={onClose} onOpenItem={onOpenItem}
        onChanged={recarregarDetalhe}
      />
    );
  }

  // ---- Fase: buscando ----
  if (fase === "buscando") {
    return (
      <div className="fixed inset-0 z-50 bg-gray-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  // ---- Fase: scan ----
  if (fase === "scan") {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col">
        <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>}>
          <BarcodeScanner qr onClose={() => setFase("lista")} onDetected={abrir}
            title="Caixa por QR — escaneie a etiqueta" hint="Aponte para o QR da etiqueta de caixa/mala." />
        </Suspense>
        <div className="absolute bottom-0 inset-x-0 bg-black/80 px-4 py-3">
          {erro && <p className="text-amber-300 text-xs mb-2 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {erro}</p>}
          <form onSubmit={(e) => { e.preventDefault(); abrir(manual); }} className="flex gap-2">
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="ou digite o código (ex.: CX-001)"
              autoCapitalize="characters" autoComplete="off"
              className="flex-1 rounded-lg border border-gray-600 bg-gray-900 text-white px-3 py-2.5 text-sm font-mono placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500" />
            <button type="submit" className="px-4 rounded-lg bg-orange-500 text-white font-semibold flex items-center gap-1 text-sm">
              Abrir <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ---- Fase: lista ----
  const filtradas = caixas.filter((c) =>
    filtro === "todas" ? true : filtro === "conferidas" ? !!c.conferida_em : !c.conferida_em
  );

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col">
      <div className="bg-gray-900 text-white px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-sm flex items-center gap-1.5"><Boxes className="w-4 h-4" /> Conferência de caixas</span>
          <button onClick={onClose} aria-label="Fechar"><X className="w-6 h-6 text-gray-300" /></button>
        </div>
        <div className="mt-3 flex gap-2">
          {[["pendentes", "A conferir"], ["conferidas", "Conferidas"], ["todas", "Todas"]].map(([id, label]) => (
            <button key={id} onClick={() => setFiltro(id)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold ${filtro === id ? "bg-orange-500 text-white" : "bg-gray-800 text-gray-300"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white border-b border-gray-200 px-4 py-3 flex gap-2">
        <button onClick={() => { setErro(null); setManual(""); setFase("scan"); }}
          className="flex-1 flex items-center justify-center gap-2 bg-gray-900 text-white rounded-xl py-2.5 text-sm font-bold active:bg-gray-800">
          <ScanLine className="w-4 h-4" /> Escanear QR
        </button>
        <form onSubmit={(e) => { e.preventDefault(); abrir(manual); }} className="flex-1 flex gap-2">
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="código (CX-001)"
            autoCapitalize="characters" autoComplete="off"
            className="flex-1 min-w-0 rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-500" />
          <button type="submit" aria-label="Abrir" className="px-3 rounded-lg bg-orange-500 text-white"><Search className="w-4 h-4" /></button>
        </form>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {erro && <p className="text-sm text-red-600 mb-3 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {erro}</p>}
        {!filtradas.length ? (
          <p className="text-sm text-gray-400 text-center py-10">Nenhuma caixa {filtro === "conferidas" ? "conferida" : filtro === "pendentes" ? "pendente" : ""}.</p>
        ) : (
          <div className="space-y-1.5">
            {filtradas.map((c) => (
              <button key={c.codigo} onClick={() => abrir(c.codigo)}
                className="w-full text-left bg-white rounded-xl border border-gray-200 px-3 py-2.5 flex items-center gap-3 active:bg-gray-100">
                {c.tipo === "MALA" ? <Boxes className="w-5 h-5 text-gray-400" /> : <Package className="w-5 h-5 text-gray-400" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-gray-900">{c.codigo}</span>
                    {c.conferida_em
                      ? <span className="text-[10px] font-bold uppercase bg-emerald-100 text-emerald-700 rounded px-1.5 py-0.5">conferida</span>
                      : <span className="text-[10px] font-bold uppercase bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">a conferir</span>}
                  </div>
                  <p className="text-xs text-gray-500 truncate">{c.local_fisico || "sem local"}{c.chegou_em ? ` · chegou ${new Date(c.chegou_em).toLocaleDateString("pt-BR")}` : ""}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Detalhe/conferência de uma caixa: avaliação, chegada+armazenamento, itens e histórico.
function CaixaDetalhe({ caixa, itens, hist, params, user, onBack, onClose, onOpenItem, onChanged }) {
  const isMala = caixa.tipo === "MALA";
  const { total, semPreco } = estimarValorCaixa(itens, params);
  const { pesoKg, semPeso } = estimarPesoCaixa(itens, params);

  const [local, setLocal] = useState(caixa.local_fisico || "");
  const [dataChegada, setDataChegada] = useState(caixa.chegou_em ? String(caixa.chegou_em).slice(0, 10) : hojeISO());
  const [salvando, setSalvando] = useState(null); // "chegada" | "conferir" | "local"
  const [busy, setBusy] = useState({}); // { [sku]: "avaria" | "faltando" }
  const [erro, setErro] = useState(null);

  const doChegada = async () => {
    setSalvando("chegada"); setErro(null);
    try { await registrarChegada(caixa.codigo, { chegou_em: dataChegada, local }, user); await onChanged(); }
    catch (e) { setErro(e.message || String(e)); }
    finally { setSalvando(null); }
  };
  const doConferir = async () => {
    setSalvando("conferir"); setErro(null);
    try { await conferirCaixa(caixa.codigo, user); await onChanged(); }
    catch (e) { setErro(e.message || String(e)); }
    finally { setSalvando(null); }
  };
  const doAvaria = async (sku) => {
    setBusy((b) => ({ ...b, [sku]: "avaria" })); setErro(null);
    try { await marcarItemAvariado(sku, user); await onChanged(); }
    catch (e) { setErro(e.message || String(e)); }
    finally { setBusy((b) => { const n = { ...b }; delete n[sku]; return n; }); }
  };
  const doFaltando = async (sku) => {
    setBusy((b) => ({ ...b, [sku]: "faltando" })); setErro(null);
    try { await marcarItemFaltando(sku, user); await onChanged(); }
    catch (e) { setErro(e.message || String(e)); }
    finally { setBusy((b) => { const n = { ...b }; delete n[sku]; return n; }); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col">
      <div className="bg-gray-900 text-white px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-300"><ChevronLeft className="w-5 h-5" /> Caixas</button>
          <button onClick={onClose} aria-label="Fechar"><X className="w-6 h-6 text-gray-300" /></button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="font-mono text-lg font-bold text-orange-400">{caixa.codigo}</span>
          {caixa.conferida_em && <span className="text-[10px] font-bold uppercase bg-emerald-600 rounded px-1.5 py-0.5">conferida</span>}
          {caixa.status === "FECHADA" && <span className="text-[10px] font-bold uppercase bg-gray-700 rounded px-1.5 py-0.5">fechada</span>}
        </div>
        <div className="flex items-end justify-between mt-2">
          <p className="text-3xl font-bold">{itens.length} <span className="text-base text-gray-400">item(ns)</span></p>
          <div className="flex items-end gap-4">
            <div className="text-right">
              <p className="text-xs text-gray-400 leading-none">peso estimado</p>
              <p className="text-xl font-bold text-sky-400">{pesoKg > 0 ? `~${fmtKg(pesoKg)}` : "—"}</p>
              {semPeso > 0 && <p className="text-[10px] text-gray-500 leading-none">{semPeso} sem medida</p>}
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400 leading-none">valor estimado</p>
              <p className="text-xl font-bold text-emerald-400">~{fmtBRL(total)}</p>
              {semPreco > 0 && <p className="text-[10px] text-gray-500 leading-none">{semPreco} sem preço</p>}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {erro && <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {erro}</p>}

        {/* Chegada + armazenamento */}
        <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2.5">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500 flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Chegada e armazenamento</p>
          <label className="block">
            <span className="text-xs text-gray-500">Local de armazenamento</span>
            <input value={local} onChange={(e) => setLocal(e.target.value)} placeholder="ex.: Belém · Galpão A"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Data de chegada</span>
            <input type="date" value={dataChegada} onChange={(e) => setDataChegada(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
          </label>
          <button onClick={doChegada} disabled={salvando === "chegada"}
            className="w-full flex items-center justify-center gap-2 bg-orange-500 text-white rounded-xl py-2.5 text-sm font-bold active:bg-orange-600 disabled:opacity-60">
            {salvando === "chegada" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck className="w-4 h-4" />}
            Registrar chegada + armazenamento
          </button>
          <p className="text-[11px] text-gray-400">O local é aplicado à caixa e a todos os {itens.length} item(ns) dela.</p>
        </div>

        {/* Itens */}
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Itens da caixa</p>
          {!itens.length ? (
            <p className="text-sm text-gray-400 text-center py-6">Caixa vazia.</p>
          ) : (
            <div className="space-y-1.5">
              {itens.map((it) => {
                const v = estimarValorVenda(it, params);
                const b = busy[it.sku];
                return (
                  <div key={it.sku} className="bg-white rounded-xl border border-gray-200 px-3 py-2.5">
                    <button onClick={() => onOpenItem?.(it)} className="w-full text-left flex items-center gap-3 active:opacity-70">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-gray-900">{it.sku}</span>
                          {it.classe && <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${CLASSE_STYLE[it.classe] || "bg-gray-400 text-white"}`}>{it.classe}</span>}
                          {it.estado === "Avariado" && <span className="text-[10px] font-bold uppercase bg-red-100 text-red-700 rounded px-1.5 py-0.5">avariado</span>}
                          {v != null && <span className="ml-auto text-xs font-semibold text-emerald-600">~{fmtBRL(v)}</span>}
                        </div>
                        <p className="text-sm text-gray-600 truncate">{it.produto}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
                    </button>
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => doAvaria(it.sku)} disabled={!!b || it.estado === "Avariado"}
                        className="flex-1 flex items-center justify-center gap-1 rounded-lg border border-amber-300 text-amber-700 py-1.5 text-xs font-semibold active:bg-amber-50 disabled:opacity-50">
                        {b === "avaria" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />} Avariado
                      </button>
                      <button onClick={() => doFaltando(it.sku)} disabled={!!b}
                        className="flex-1 flex items-center justify-center gap-1 rounded-lg border border-red-300 text-red-700 py-1.5 text-xs font-semibold active:bg-red-50 disabled:opacity-50">
                        {b === "faltando" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PackageX className="w-3.5 h-3.5" />} Faltando
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Histórico */}
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Histórico da caixa</p>
          {!hist.length ? (
            <p className="text-sm text-gray-400">Sem histórico ainda.</p>
          ) : (
            <div className="space-y-1">
              {hist.map((e) => (
                <div key={e.id} className="bg-white rounded-lg border border-gray-200 px-3 py-2 text-sm">
                  <span className="text-gray-800">{eventoCaixaLabel(e.acao)}</span>
                  {e.detalhe && <span className="text-gray-500"> · {e.detalhe}</span>}
                  <p className="text-[11px] text-gray-400">{e.usuario} · {new Date(e.ts).toLocaleString("pt-BR")}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white border-t border-gray-200 px-4 py-3">
        <button onClick={doConferir} disabled={salvando === "conferir"}
          className="w-full flex items-center justify-center gap-2 bg-gray-900 text-white rounded-xl py-3 font-bold active:bg-gray-800 disabled:opacity-60">
          {salvando === "conferir" ? <Loader2 className="w-5 h-5 animate-spin" /> : <ClipboardCheck className="w-5 h-5" />}
          {caixa.conferida_em ? "Conferir novamente" : "Marcar caixa conferida"}
          {caixa.conferida_em && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Sanidade de lint**

Run: `npm run lint`
Esperado: sem erros em `src/screens/CaixasScreen.jsx`. Se o ESLint acusar imports não usados (ex.: `MapPin`/`Search`), remover apenas os realmente não referenciados.

- [ ] **Step 3: Commit**

```bash
git add src/screens/CaixasScreen.jsx
git commit -m "feat(caixas): tela CaixasScreen (lista + scan + conferência/armazenamento)"
```

---

## Task 5: Ligar no App e aposentar `CaixaQrScreen`

**Files:**
- Modify: `src/App.jsx`
- Delete: `src/screens/CaixaQrScreen.jsx`

- [ ] **Step 1: Trocar o import da tela**

Em `src/App.jsx`, substituir a linha:

```javascript
import CaixaQrScreen from "./screens/CaixaQrScreen";
```
por:

```javascript
import CaixasScreen from "./screens/CaixasScreen";
```

- [ ] **Step 2: Trocar o uso da tela no render**

Em `src/App.jsx`, substituir o bloco:

```jsx
      {showCaixaQr && (
        <CaixaQrScreen
          params={params}
          onClose={() => setShowCaixaQr(false)}
          onOpenItem={(it) => { setShowCaixaQr(false); setOpenItem(it); }}
        />
      )}
```
por:

```jsx
      {showCaixaQr && (
        <CaixasScreen
          params={params} user={user}
          onClose={() => setShowCaixaQr(false)}
          onOpenItem={(it) => { setShowCaixaQr(false); setOpenItem(it); }}
        />
      )}
```

- [ ] **Step 3: Adicionar os rótulos dos novos eventos em `eventoLabel`**

Em `src/App.jsx`, dentro de `const eventoLabel = (e) => { ... }`, logo após a linha:

```javascript
  if (a === "caixa:reaberta") return "caixa reaberta";
```
inserir:

```javascript
  if (a === "caixa:chegada") return "chegada registrada" + (e.detalhe ? ` (${e.detalhe})` : "");
  if (a === "caixa:local") return "armazenamento" + (e.detalhe ? ` → ${e.detalhe}` : "");
  if (a === "caixa:conferida") return "caixa conferida ✓";
  if (a === "caixa:item_avaria") return "item avariado na conferência";
  if (a === "caixa:item_faltando") return "item faltando na conferência";
```

- [ ] **Step 4: Deletar a tela antiga**

```bash
git rm src/screens/CaixaQrScreen.jsx
```

- [ ] **Step 5: Build/lint para garantir que nada mais referencia a tela antiga**

Run: `npm run lint && npm run build`
Esperado: build conclui sem erros; nenhum import remanescente de `CaixaQrScreen`.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx
git commit -m "feat(caixas): App usa CaixasScreen + rótulos de eventos; remove CaixaQrScreen"
```

---

## Task 6: Registrar o teste na suíte e rodar tudo

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Adicionar `test:caixas` ao script `test`**

Em `package.json`, adicionar a linha (após `test:anuncio`):

```json
    "test:caixas": "node scripts/test_caixas.mjs",
```
e incluir no encadeamento do script `test`, ao final:

```json
    "test": "npm run test:pricing && npm run test:categoria && npm run test:preflight && npm run test:precoview && npm run test:catalogo && npm run test:anuncio && npm run test:caixas"
```

- [ ] **Step 2: Rodar a suíte completa**

Run: `npm test`
Esperado: todos os testes passam, incluindo `11 asserções OK` do `test:caixas`.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "test(caixas): inclui test:caixas na suíte"
```

---

## Verificação manual (após aplicar a migration)

1. `npm run dev`, logar, tocar no botão flutuante **"Caixa QR"** → abre a lista de caixas.
2. Filtro **A conferir** mostra caixas sem `conferida_em`.
3. Abrir uma caixa → preencher **Local** (ex.: "Belém · Galpão A") + **Data de chegada** → **Registrar chegada + armazenamento**. Conferir via MCP `execute_sql` que `caixas.local_fisico`/`chegou_em` e os `itens.local_fisico` da caixa foram atualizados, e que há evento `caixa:chegada`.
4. Marcar um item **Avariado** → `itens.estado='Avariado'` + evento `caixa:item_avaria`. Marcar outro **Faltando** → some da lista, `caixa_id=null`, evento `caixa:item_faltando`.
5. **Marcar caixa conferida** → badge "conferida", `conferida_em/por` preenchidos, some do filtro "A conferir".
6. Aba **Registro** mostra os novos eventos com rótulos legíveis.

---

## Self-Review

- **Cobertura do spec:** schema (Task 1), lib de dados + helpers puros (Tasks 2-3), UI lista/scan/detalhe (Task 4), wiring + eventoLabel + remoção da tela antiga (Task 5), testes na suíte (Task 6). Todos os requisitos do spec têm task.
- **Placeholders:** nenhum — todo passo tem código/comando completo.
- **Consistência de tipos/nomes:** funções (`definirLocalCaixa`, `registrarChegada`, `conferirCaixa`, `marcarItemAvariado`, `marcarItemFaltando`, `historicoCaixa`) e helpers (`formatDataBR`, `chegadaDetalhe`) usados na UI batem com as assinaturas definidas nas Tasks 2-3. Ações de evento (`caixa:chegada`, `caixa:local`, `caixa:conferida`, `caixa:item_avaria`, `caixa:item_faltando`) idênticas entre lib, `eventoLabel` (App) e `eventoCaixaLabel` (CaixasScreen).
- **Nota de teste:** só os helpers puros são cobertos por teste automatizado (harness Node não carrega módulos que importam `supabase.js`), consistente com o restante de `lib/caixas.js`/`conferencia.js`; as funções de dados são validadas na verificação manual.
