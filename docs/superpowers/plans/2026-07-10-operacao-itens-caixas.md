# Melhorias de operação (catalogar por lote, reabrir caixa, visibilidade de caixa) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Facilitar filtrar "A Catalogar" por lote, permitir reabrir uma caixa fechada para incluir itens e fechá-la de novo, e dar visibilidade de em qual caixa cada item está.

**Architecture:** Sem migration. Um helper puro (`catalogarStats.js`) e uma função de contagem em `conferencia.js` alimentam um modal na `ItemsScreen`. Reabrir caixa reusa `reabrirCaixa` já existente, com botão na `ConferenciaScreen`. Visibilidade: cartão informativo em `ItemDetail` (via `buscarCaixa`) e filtro por caixa + local no selo na `ItemsScreen`.

**Tech Stack:** React 18, Supabase JS, Tailwind, lucide-react. Testes: scripts `.mjs` com `node:assert` (só módulos puros — importar módulo que puxa `supabase.js` quebra em Node).

---

## File Structure

- Create: `src/lib/catalogarStats.js` — `tallyPorLote(rows)` (puro).
- Modify: `src/lib/conferencia.js` — `contarACatalogarPorLote()`.
- Modify: `src/screens/ItemsScreen.jsx` — botão "Catalogar" + modal `CatalogarPorLote`; filtro `fCaixa` + `caixasList`; local no selo.
- Modify: `src/screens/ConferenciaScreen.jsx` — `reabrir` + botão "Reabrir" em `CaixaFechadaItem`.
- Modify: `src/screens/ItemDetail.jsx` — cartão informativo da caixa.
- Create: `scripts/test_catalogar.mjs` — testa `tallyPorLote`.
- Modify: `package.json` — inclui `test:catalogar`.

---

## Task 1: Helper puro `tallyPorLote` + teste + suíte

**Files:**
- Create: `src/lib/catalogarStats.js`
- Create: `scripts/test_catalogar.mjs`
- Modify: `package.json`

- [ ] **Step 1: Escrever o teste que falha**

Arquivo `scripts/test_catalogar.mjs`:

```javascript
// Testes das funções PURAS de catalogação (catalogarStats.js). Rode: npm run test:catalogar
import assert from "node:assert/strict";
import { tallyPorLote } from "../src/lib/catalogarStats.js";

let passou = 0;
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); passou++; console.log(`  ok  ${msg}`); };

console.log("agrupa por lote e conta (count desc)");
eq(
  tallyPorLote([{ lote: 10 }, { lote: 10 }, { lote: 12 }]),
  [{ lote: 10, count: 2 }, { lote: 12, count: 1 }],
  "agrupa e ordena por count desc"
);

console.log("empate de count → lote asc");
eq(
  tallyPorLote([{ lote: 12 }, { lote: 5 }]),
  [{ lote: 5, count: 1 }, { lote: 12, count: 1 }],
  "empate ordena por lote asc"
);

console.log("lote nulo vira bucket 'sem lote'");
eq(
  tallyPorLote([{ lote: null }, { lote: null }, { lote: 7 }]),
  [{ lote: null, count: 2 }, { lote: 7, count: 1 }],
  "null agrupa junto e segue a ordenação por count"
);

console.log("empate com null → null por último");
eq(
  tallyPorLote([{ lote: null }, { lote: 3 }]),
  [{ lote: 3, count: 1 }, { lote: null, count: 1 }],
  "no empate, o bucket sem lote fica por último"
);

console.log(`\n${passou} asserções OK`);
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `node scripts/test_catalogar.mjs`
Esperado: FALHA (`Cannot find module '../src/lib/catalogarStats.js'`).

- [ ] **Step 3: Implementar o helper puro**

Arquivo `src/lib/catalogarStats.js`:

```javascript
// Helpers puros de catalogação (sem Supabase, testáveis no Node).

// Agrupa linhas [{lote}] por lote e conta. lote nulo/indefinido vira null
// ("sem lote"). Retorna [{lote, count}] ordenado por count desc; empatando,
// lote asc com null por último.
export function tallyPorLote(rows) {
  const mapa = new Map();
  for (const r of rows || []) {
    const k = r.lote ?? null;
    mapa.set(k, (mapa.get(k) || 0) + 1);
  }
  return [...mapa.entries()]
    .map(([lote, count]) => ({ lote, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (a.lote === null) return 1;
      if (b.lote === null) return -1;
      return a.lote - b.lote;
    });
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `node scripts/test_catalogar.mjs`
Esperado: `4 asserções OK`.

- [ ] **Step 5: Registrar na suíte**

Em `package.json`, adicionar (após a linha `"test:caixas": ...`):

```json
    "test:catalogar": "node scripts/test_catalogar.mjs",
```
e acrescentar ` && npm run test:catalogar` ao final do valor do script `test`.

- [ ] **Step 6: Rodar a suíte completa**

Run: `npm test`
Esperado: todos os testes passam, incluindo `4 asserções OK` do `test:catalogar`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/catalogarStats.js scripts/test_catalogar.mjs package.json
git commit -m "feat(catalogar): helper puro tallyPorLote + teste na suíte"
```

---

## Task 2: `contarACatalogarPorLote()` em `conferencia.js`

**Files:**
- Modify: `src/lib/conferencia.js`

- [ ] **Step 1: Importar o helper**

No topo de `src/lib/conferencia.js`, logo abaixo de `import { copiarFotos } from "./fotos";`, adicionar:

```javascript
import { tallyPorLote } from "./catalogarStats";
```

- [ ] **Step 2: Adicionar a função ao final do arquivo**

Ao final de `src/lib/conferencia.js`, acrescentar:

```javascript
// Conta itens em "A catalogar" agrupados por lote (para o atalho de catalogação
// por lote na tela de Itens). Pagina a coluna `lote` (leve) e agrupa via
// tallyPorLote. Retorna [{lote, count}] (lote null = sem lote).
export async function contarACatalogarPorLote() {
  const PAGE = 1000;
  let rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("itens").select("lote").eq("status", "A_CATALOGAR")
      .order("sku").range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    rows = rows.concat(data);
    if (data.length < PAGE) break;
  }
  return tallyPorLote(rows);
}
```

- [ ] **Step 3: Sanidade de lint**

Run: `npm run lint`
Esperado: sem erros novos em `src/lib/conferencia.js`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/conferencia.js
git commit -m "feat(catalogar): contarACatalogarPorLote (contagem paginada por lote)"
```

---

## Task 3: Botão "Catalogar" + modal `CatalogarPorLote` (`ItemsScreen`)

**Files:**
- Modify: `src/screens/ItemsScreen.jsx`

- [ ] **Step 1: Importar a função e o ícone**

Em `src/screens/ItemsScreen.jsx`, logo abaixo da linha
`import { listarCaixas, itensDaCaixa, CAIXA_TIPO, CAIXA_STATUS } from "../lib/caixas";`, adicionar:

```javascript
import { contarACatalogarPorLote } from "../lib/conferencia";
```

E na importação de `lucide-react` (a que começa com `import { Search, Filter, ...`), acrescentar `ClipboardList` à lista de ícones.

- [ ] **Step 2: Estado + handler do picker**

Logo após a linha `const [boxPicker, setBoxPicker] = useState(false);`, adicionar:

```javascript
  const [catalogarPicker, setCatalogarPicker] = useState(false);

  // Aplica o filtro status=A_CATALOGAR + lote escolhido no picker de catalogação.
  const escolherCatalogar = (loteValue) => {
    setFStatus("A_CATALOGAR");
    setFLote(loteValue);
    setShowFilters(true);
    setCatalogarPicker(false);
  };
```

- [ ] **Step 3: Botão "Catalogar" na barra de ações**

Em `src/screens/ItemsScreen.jsx`, dentro do bloco de ações do topo, substituir:

```jsx
            <button onClick={() => setBoxPicker(true)}
              className="flex items-center gap-1 text-xs font-semibold text-gray-600 bg-white border border-gray-300 rounded-lg px-2 py-1">
              <Boxes className="w-3.5 h-3.5" /> Caixa/Mala
            </button>
```
por:

```jsx
            <button onClick={() => setCatalogarPicker(true)}
              className="flex items-center gap-1 text-xs font-semibold text-gray-600 bg-white border border-gray-300 rounded-lg px-2 py-1">
              <ClipboardList className="w-3.5 h-3.5" /> Catalogar
            </button>
            <button onClick={() => setBoxPicker(true)}
              className="flex items-center gap-1 text-xs font-semibold text-gray-600 bg-white border border-gray-300 rounded-lg px-2 py-1">
              <Boxes className="w-3.5 h-3.5" /> Caixa/Mala
            </button>
```

- [ ] **Step 4: Renderizar o modal**

Em `src/screens/ItemsScreen.jsx`, logo antes do bloco `{boxPicker && (`, adicionar:

```jsx
      {catalogarPicker && (
        <CatalogarPorLote
          lotes={lotes}
          onClose={() => setCatalogarPicker(false)}
          onPick={escolherCatalogar}
        />
      )}
```

- [ ] **Step 5: Implementar o componente `CatalogarPorLote`**

Ao final de `src/screens/ItemsScreen.jsx` (após o componente `BoxPicker`), acrescentar:

```jsx
// Atalho "A catalogar por lote": conta itens A_CATALOGAR por lote (contarACatalogarPorLote)
// e, ao escolher, aplica status=A_CATALOGAR + lote na tela de itens. Espelha o BoxPicker.
function CatalogarPorLote({ lotes, onClose, onPick }) {
  const [loading, setLoading] = useState(true);
  const [linhas, setLinhas] = useState([]);
  const refDe = (lote) => lotes.find((l) => l.lote === lote)?.referencia || "";

  useEffect(() => {
    (async () => {
      try { setLinhas(await contarACatalogarPorLote()); }
      finally { setLoading(false); }
    })();
  }, []);

  const total = linhas.reduce((s, r) => s + r.count, 0);

  return (
    <div className="fixed inset-0 z-[65] bg-gray-100 flex flex-col">
      <div className="bg-gray-900 text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-orange-400" />
          <span className="font-bold">A catalogar por lote</span>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg bg-gray-800" aria-label="Fechar">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 overflow-auto px-3 py-3 space-y-1.5">
        {loading ? (
          <div className="py-10 text-center"><Loader2 className="w-6 h-6 animate-spin text-orange-500 mx-auto" /></div>
        ) : !linhas.length ? (
          <p className="text-sm text-gray-400 text-center py-10">Nada a catalogar. 🎉</p>
        ) : (
          <>
            <p className="text-xs text-gray-500 px-1 pb-1">
              {total.toLocaleString("pt-BR")} itens a catalogar em {linhas.length} lote(s)
            </p>
            {linhas.map((r) => {
              const value = r.lote == null ? LOTE_SEM : String(r.lote);
              const titulo = r.lote == null ? "Sem lote" : `Lote ${r.lote}`;
              const ref = r.lote == null ? "" : refDe(r.lote);
              return (
                <button key={value} onClick={() => onPick(value)}
                  className="w-full text-left bg-white rounded-xl border border-gray-200 px-3 py-2.5 flex items-center gap-3 active:bg-gray-100">
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-sm text-gray-900">{titulo}</span>
                    {ref && <span className="text-xs text-gray-500"> — {ref}</span>}
                  </div>
                  <span className="text-sm font-bold text-orange-600">{r.count}</span>
                  <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
                </button>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
```

(`LOTE_SEM`, `X`, `ChevronRight`, `Loader2` já são importados no arquivo.)

- [ ] **Step 6: Lint + build**

Run: `npm run lint && npm run build`
Esperado: sem erros; build conclui.

- [ ] **Step 7: Commit**

```bash
git add src/screens/ItemsScreen.jsx
git commit -m "feat(itens): atalho 'Catalogar' por lote com contagem"
```

---

## Task 4: Filtro por caixa + local no selo (`ItemsScreen`)

**Files:**
- Modify: `src/screens/ItemsScreen.jsx`

- [ ] **Step 1: Estado do filtro + carga das caixas**

Logo após a linha `const [catalogarPicker, setCatalogarPicker] = useState(false);` (criada na Task 3), adicionar:

```javascript
  const [fCaixa, setFCaixa] = useState(initialFilter?.caixa || "");
  const [caixasList, setCaixasList] = useState([]);
  useEffect(() => { listarCaixas().then(setCaixasList).catch(() => {}); }, []);
```

- [ ] **Step 2: Aplicar o filtro na query**

Em `src/screens/ItemsScreen.jsx`, na função `buscar`, logo após a linha
`if (fSemCaixa) query = query.is("caixa_id", null);`, adicionar:

```javascript
    if (fCaixa) query = query.eq("caixa_id", fCaixa);
```

- [ ] **Step 3: Incluir `fCaixa` nas dependências e no contador**

Na assinatura de dependências do `useCallback` de `buscar` (o array que termina em `..., fIaPreco, fAptoAmazon, page]`), inserir `fCaixa` antes de `page`, ficando `..., fIaPreco, fAptoAmazon, fCaixa, page]`.

No `useEffect` de filtros (array que termina em `..., fIaPreco, fAptoAmazon, refreshKey]`), inserir `fCaixa` antes de `refreshKey`, ficando `..., fIaPreco, fAptoAmazon, fCaixa, refreshKey]`.

Na linha do `nActive` (`const nActive = [fLote, ..., fAptoAmazon].filter(Boolean).length;`), acrescentar `fCaixa` à lista antes de `].filter`.

- [ ] **Step 4: Select de caixa no painel de filtros**

Em `src/screens/ItemsScreen.jsx`, logo após o bloco do select de destino (o `</select>` que fecha o `<select value={fDestino} ...>`), adicionar:

```jsx
            <select value={fCaixa} onChange={(e) => setFCaixa(e.target.value)} className={inputCls}>
              <option value="">Todas as caixas</option>
              {caixasList.map((c) => (
                <option key={c.codigo} value={c.codigo}>
                  {c.codigo}{c.local_fisico ? ` · ${c.local_fisico}` : c.destino ? ` — ${c.destino}` : ""}
                </option>
              ))}
            </select>
```

- [ ] **Step 5: Selo do item com o local — remover o badge do topo**

Em `src/screens/ItemsScreen.jsx`, remover o bloco (badge de caixa no topo da linha do item):

```jsx
                    {it.caixa_id && (
                      <span title={`Na caixa ${it.caixa_id}`}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700 flex-shrink-0">
                        <Package className="w-3 h-3" />{it.caixa_id}
                      </span>
                    )}
```

- [ ] **Step 6: Selo do item com o local — adicionar na linha de meta**

Em `src/screens/ItemsScreen.jsx`, substituir o bloco de meta:

```jsx
                  <div className="flex items-center gap-1.5 flex-wrap text-xs text-gray-400">
                    {it.grupo && <span className="bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">{it.grupo}</span>}
                    {(it.marca || it.modelo) && <span className="truncate">{[it.marca, it.modelo].filter(Boolean).join(" ")}</span>}
                    <span>{it.lote ? `Lote ${it.lote}` : "Sem lote"} · {fmtBRL(it.preco_ideal || it.preco_sugerido)}</span>
                  </div>
```
por:

```jsx
                  <div className="flex items-center gap-1.5 flex-wrap text-xs text-gray-400">
                    {it.grupo && <span className="bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">{it.grupo}</span>}
                    {(it.marca || it.modelo) && <span className="truncate">{[it.marca, it.modelo].filter(Boolean).join(" ")}</span>}
                    <span>{it.lote ? `Lote ${it.lote}` : "Sem lote"} · {fmtBRL(it.preco_ideal || it.preco_sugerido)}</span>
                    {it.caixa_id && (
                      <span className="inline-flex items-center gap-0.5 bg-indigo-50 text-indigo-700 rounded px-1.5 py-0.5">
                        <Package className="w-3 h-3" />{it.caixa_id}{it.local_fisico ? ` · ${it.local_fisico}` : ""}
                      </span>
                    )}
                  </div>
```

- [ ] **Step 7: Lint + build**

Run: `npm run lint && npm run build`
Esperado: sem erros; build conclui. (`Package`, `listarCaixas`, `inputCls` já importados/definidos.)

- [ ] **Step 8: Commit**

```bash
git add src/screens/ItemsScreen.jsx
git commit -m "feat(itens): filtro por caixa + local físico no selo do item"
```

---

## Task 5: Reabrir caixa (`ConferenciaScreen` → Encaixotar)

**Files:**
- Modify: `src/screens/ConferenciaScreen.jsx`

- [ ] **Step 1: Importar `reabrirCaixa`**

Em `src/screens/ConferenciaScreen.jsx`, no import de `../lib/caixas`, acrescentar `reabrirCaixa`:

```javascript
import {
  CAIXA_STATUS, CAIXA_TIPO, criarCaixa, adicionarItemCaixa, removerItemCaixa,
  fecharCaixa, reabrirCaixa, listarCaixas, itensDaCaixa,
} from "../lib/caixas";
```

(`RotateCcw` já é importado de `lucide-react` neste arquivo.)

- [ ] **Step 2: Handler `reabrir` no componente `Encaixotar`**

Em `src/screens/ConferenciaScreen.jsx`, dentro de `Encaixotar`, logo após a função `fechar` (o bloco `const fechar = async () => { ... };`), adicionar:

```javascript
  // Reabre uma caixa fechada e já entra na caixa ativa para incluir itens.
  const reabrir = async (c) => {
    if (!window.confirm(`Reabrir a caixa ${c.codigo} para incluir itens?`)) return;
    setBusy(true);
    try {
      await reabrirCaixa(c.codigo, user);
      onChanged?.();
      await loadAbertas();
      await abrirCaixa({ ...c, status: CAIXA_STATUS.ABERTA });
    } catch (e) {
      setMsg({ tipo: "erro", texto: e.message || String(e) });
    } finally { setBusy(false); }
  };
```

- [ ] **Step 3: Passar `onReabrir` para as caixas fechadas**

Em `src/screens/ConferenciaScreen.jsx`, substituir:

```jsx
            {fechadas.map((c) => <CaixaFechadaItem key={c.codigo} caixa={c} params={params} user={user} />)}
```
por:

```jsx
            {fechadas.map((c) => <CaixaFechadaItem key={c.codigo} caixa={c} params={params} user={user} onReabrir={reabrir} />)}
```

- [ ] **Step 4: Botão "Reabrir" em `CaixaFechadaItem`**

Em `src/screens/ConferenciaScreen.jsx`, na assinatura do componente, trocar
`function CaixaFechadaItem({ caixa, params, user }) {` por
`function CaixaFechadaItem({ caixa, params, user, onReabrir }) {`.

Em seguida, substituir o cabeçalho clicável:

```jsx
      <button onClick={toggle} className="w-full text-left px-3 py-2.5 flex items-center gap-3 active:bg-gray-100">
        <span className="w-9 h-9 rounded-lg bg-gray-100 text-gray-400 flex items-center justify-center flex-shrink-0">
          {caixa.tipo === CAIXA_TIPO.MALA ? <Inbox className="w-4 h-4" /> : <Package className="w-4 h-4" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold text-gray-900">{caixa.codigo}</span>
            <span className="text-[10px] font-bold uppercase bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">Fechada</span>
            {vias?.vias > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] font-bold text-gray-500" title={`Etiqueta impressa · ${vias.vias} via(s)`}>
                <Printer className="w-3 h-3" /> {vias.vias}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 truncate">{caixa.destino || "sem destino"}{caixa.local_fisico ? ` · ${caixa.local_fisico}` : ""}</p>
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-300 flex-shrink-0 transition-transform ${aberta ? "rotate-180" : ""}`} />
      </button>
```
por:

```jsx
      <div className="flex items-center">
        <button onClick={toggle} className="flex-1 min-w-0 text-left px-3 py-2.5 flex items-center gap-3 active:bg-gray-100">
          <span className="w-9 h-9 rounded-lg bg-gray-100 text-gray-400 flex items-center justify-center flex-shrink-0">
            {caixa.tipo === CAIXA_TIPO.MALA ? <Inbox className="w-4 h-4" /> : <Package className="w-4 h-4" />}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-gray-900">{caixa.codigo}</span>
              <span className="text-[10px] font-bold uppercase bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">Fechada</span>
              {vias?.vias > 0 && (
                <span className="flex items-center gap-0.5 text-[10px] font-bold text-gray-500" title={`Etiqueta impressa · ${vias.vias} via(s)`}>
                  <Printer className="w-3 h-3" /> {vias.vias}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 truncate">{caixa.destino || "sem destino"}{caixa.local_fisico ? ` · ${caixa.local_fisico}` : ""}</p>
          </div>
          <ChevronDown className={`w-4 h-4 text-gray-300 flex-shrink-0 transition-transform ${aberta ? "rotate-180" : ""}`} />
        </button>
        <button onClick={() => onReabrir?.(caixa)} title="Reabrir caixa"
          className="flex-shrink-0 mr-2 flex items-center gap-1 text-xs font-semibold text-orange-600 border border-orange-200 bg-orange-50 rounded-lg px-2 py-1.5 active:bg-orange-100">
          <RotateCcw className="w-3.5 h-3.5" /> Reabrir
        </button>
      </div>
```

- [ ] **Step 5: Lint + build**

Run: `npm run lint && npm run build`
Esperado: sem erros; build conclui.

- [ ] **Step 6: Commit**

```bash
git add src/screens/ConferenciaScreen.jsx
git commit -m "feat(caixas): reabrir caixa fechada p/ incluir itens e fechar de novo"
```

---

## Task 6: Cartão informativo da caixa (`ItemDetail`)

**Files:**
- Modify: `src/screens/ItemDetail.jsx`

- [ ] **Step 1: Imports**

Em `src/screens/ItemDetail.jsx`, na importação de `lucide-react` (linha que começa com `ChevronLeft, ChevronRight, ...`), acrescentar `Package` à lista.

Logo abaixo da linha `import { buscarViasImpressao } from "../lib/printLog";`, adicionar:

```javascript
import { buscarCaixa, CAIXA_STATUS } from "../lib/caixas";
```

- [ ] **Step 2: Estado + efeito para carregar a caixa**

Em `src/screens/ItemDetail.jsx`, logo após a linha
`const [viaInfo, setViaInfo] = useState(null); // { vias, ultima } — controle de impressão`, adicionar:

```javascript
  const [caixaInfo, setCaixaInfo] = useState(null); // dados da caixa em que o item está
```

Logo após a linha `useEffect(() => { carregarVias(); }, [carregarVias]);`, adicionar:

```javascript
  // Carrega os dados da caixa do item (para o cartão informativo). Best-effort.
  useEffect(() => {
    let cancel = false;
    if (!it.caixa_id) { setCaixaInfo(null); return; }
    buscarCaixa(it.caixa_id).then((c) => { if (!cancel) setCaixaInfo(c); }).catch(() => {});
    return () => { cancel = true; };
  }, [it.caixa_id]);
```

- [ ] **Step 3: Renderizar o cartão**

Em `src/screens/ItemDetail.jsx`, logo após a linha
`<div className="flex-1 overflow-y-auto px-4 py-4 pb-32">` e antes do comentário
`{/* Assistente de IA — completa dados, sugere preço e diagnostica */}`, inserir:

```jsx
        {it.caixa_id && (
          <div className="bg-white rounded-2xl border border-indigo-200 px-4 py-3 mb-4 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 pb-1.5 flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5 text-indigo-500" /> Caixa
            </h3>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm font-bold text-gray-900">{it.caixa_id}</span>
              {caixaInfo && (
                <span className={`text-[10px] font-bold uppercase rounded px-1.5 py-0.5 ${caixaInfo.status === CAIXA_STATUS.FECHADA ? "bg-gray-200 text-gray-600" : "bg-emerald-100 text-emerald-700"}`}>
                  {caixaInfo.status === CAIXA_STATUS.FECHADA ? "Fechada" : "Aberta"}
                </span>
              )}
              {caixaInfo?.tipo && <span className="text-xs text-gray-500">{caixaInfo.tipo === "MALA" ? "Mala" : "Caixa"}</span>}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {(caixaInfo?.destino || it.destino) || "sem destino"}
              {(caixaInfo?.local_fisico || it.local_fisico) ? ` · ${caixaInfo?.local_fisico || it.local_fisico}` : ""}
            </p>
          </div>
        )}
```

- [ ] **Step 4: Lint + build**

Run: `npm run lint && npm run build`
Esperado: sem erros; build conclui.

- [ ] **Step 5: Commit**

```bash
git add src/screens/ItemDetail.jsx
git commit -m "feat(itens): ficha do item mostra a caixa (código, tipo, destino, local, status)"
```

---

## Verificação manual

1. `npm run dev`, logar. **Itens → Catalogar**: abre lista de lotes com contagem de "A catalogar"; tocar num lote aplica status=A Catalogar + lote e mostra os itens.
2. **Itens → filtros → Caixa**: escolher uma caixa filtra os itens dela; o selo de cada item mostra `CX-… · <local>`.
3. **Abrir a ficha** de um item encaixotado: aparece o cartão "Caixa" com código, tipo, destino, local e Aberta/Fechada.
4. **Conferir → Encaixotar → Caixas fechadas → Reabrir**: confirma, reabre e entra na caixa ativa; escanear um item o inclui; "Fechar caixa" fecha de novo (a caixa volta para fechadas).

---

## Self-Review

- **Cobertura do spec:** catalogar por lote (Tasks 1-3), filtro por caixa + local no selo (Task 4), reabrir caixa (Task 5), cartão da caixa na ficha (Task 6). Todos os itens do spec têm task.
- **Placeholders:** nenhum — todo passo tem código/comando completo.
- **Consistência de nomes:** `tallyPorLote`/`contarACatalogarPorLote` (Tasks 1-2) usados no `CatalogarPorLote` (Task 3); `reabrirCaixa`/`reabrir`/`onReabrir` consistentes (Task 5); `buscarCaixa`/`CAIXA_STATUS`/`caixaInfo` consistentes (Task 6). `LOTE_SEM` usado no picker e já no filtro de lote. Filtro `fCaixa` adicionado à query, deps e `nActive` (Task 4).
- **Nota de teste:** só o helper puro `tallyPorLote` tem teste automatizado (harness Node não carrega módulos que importam `supabase.js`); o restante é validado na verificação manual, consistente com o repo.
