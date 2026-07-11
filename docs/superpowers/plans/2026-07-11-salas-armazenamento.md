# Salas — Armazenamento Estruturado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduzir a entidade `sala` (código auto-gerado + nome) como local físico estruturado que substitui o `local_fisico` texto livre, permitindo alocar caixas e itens soltos em salas, com etiqueta/QR de sala, seletor de sala nas telas, sala nas etiquetas e atalho no Dashboard.

**Architecture:** `salas` é entidade "irmã" da `caixas`: tabela própria com código sequencial (`SALA-001`), RLS padrão, eventos no histórico e etiqueta com QR. `caixas.sala_id` e `itens.sala_id` (FK, `on delete set null`) são a fonte de verdade da localização. Item encaixotado herda a sala da caixa (propagação snapshot, igual o `local_fisico` fazia); item solto recebe sala direto. `local_fisico` permanece no banco só como histórico. Camada de dados isolada da UI (`src/lib/salas.js`), espelhando `src/lib/caixas.js`.

**Tech Stack:** React (Vite), Supabase (Postgres + RLS), Tailwind, lucide-react, `qrcode`. Testes: scripts Node puros (`scripts/test_*.mjs`) — só funções puras, como o resto do projeto.

**Convenção de teste do projeto:** não há framework de testes. Só funções **puras** têm teste automatizado (`node scripts/test_*.mjs`). Funções que tocam o Supabase e UI são verificadas por `npm run lint` + `npm run build` + verificação manual, exatamente como a feature de caixas foi entregue. O plano segue essa convenção: TDD nas funções puras (Task 2), lint+build no restante.

**Referência de padrões (ler antes de começar):**
- `src/lib/caixas.js` — modelo da camada de dados (código sequencial, retry, eventos, propagação a itens).
- `src/screens/CaixasScreen.jsx` — modelo de tela (lista + scan + detalhe + impressão de etiqueta).
- `src/lib/labels.js`, `src/components/labels/LabelCard.jsx`, `src/lib/printLog.js`, `src/components/labels/LabelPrint.jsx` — etiquetas.
- Spec: `docs/superpowers/specs/2026-07-11-salas-armazenamento-design.md`.

---

## Task 1: Migration do schema `salas` (+ FKs + RLS)

> A migration **não é aplicada** por este plano — requer aprovação de Pedro/Bárbara (padrão do projeto). A task cria o arquivo; a aplicação é um passo manual posterior via MCP Supabase.

**Files:**
- Create: `supabase/migrations/20260711120000_salas.sql`

- [ ] **Step 1: Criar o arquivo de migration**

Conteúdo exato de `supabase/migrations/20260711120000_salas.sql`:

```sql
-- Salas: local físico estruturado que substitui o texto livre local_fisico.
-- A sala é entidade de 1ª classe (código auto-gerado, nome, RLS, eventos,
-- etiqueta com QR), irmã da tabela `caixas`. Caixas e itens apontam para a sala
-- via sala_id. Item encaixotado herda a sala da caixa (snapshot propagado);
-- item solto recebe sala direto. local_fisico permanece como histórico.
create table if not exists salas (
  codigo     text primary key,               -- 'SALA-001' (auto-gerado)
  nome       text not null,                  -- descritivo, ex.: 'Galpão A'
  observacao text,
  ativa      boolean not null default true,  -- esconder do dropdown sem apagar
  criado_por text,
  criado_em  timestamptz not null default now()
);

alter table caixas add column if not exists sala_id text
  references salas(codigo) on update cascade on delete set null;
alter table itens  add column if not exists sala_id text
  references salas(codigo) on update cascade on delete set null;
create index if not exists idx_caixas_sala on caixas (sala_id);
create index if not exists idx_itens_sala  on itens  (sala_id);

-- RLS espelhando o padrão (auth_full_<tabela>: authenticated, ALL, true/true).
alter table salas enable row level security;
drop policy if exists auth_full_salas on salas;
create policy auth_full_salas on salas for all to authenticated using (true) with check (true);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260711120000_salas.sql
git commit -m "feat(salas): migration da entidade sala + sala_id em caixas/itens"
```

- [ ] **Step 3: (Manual, fora do plano) aplicar após aprovação**

Aplicar via MCP Supabase `apply_migration` (nome `salas`) com Pedro/Bárbara. Depois `list_tables` para confirmar `salas` + colunas `sala_id`. **Não** prosseguir para as tasks de UI dependentes de dados reais sem isto, mas as Tasks 2–6 (código) não dependem da aplicação.

---

## Task 2: Funções puras `salasFormat.js` (+ testes TDD)

Duas funções puras: `parseCodigoLido` (roteia texto lido do QR/digitado para tipo+código normalizado) e `salaLabelTexto` (rótulo curto da sala).

**Files:**
- Create: `src/lib/salasFormat.js`
- Create: `scripts/test_salas.mjs`
- Modify: `package.json` (script `test:salas` + incluir no `test`)

- [ ] **Step 1: Escrever o teste que falha**

Criar `scripts/test_salas.mjs`:

```js
// Testes das funções PURAS de salas (salasFormat.js). Rode: npm run test:salas
import assert from "node:assert/strict";
import { parseCodigoLido, salaLabelTexto } from "../src/lib/salasFormat.js";

let passou = 0;
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); passou++; console.log(`  ok  ${msg}`); };

console.log("parseCodigoLido");
eq(parseCodigoLido("SALA-001"), { tipo: "SALA", codigo: "SALA-001" }, "prefixo SALA → tipo SALA");
eq(parseCodigoLido("cx-012"), { tipo: "CAIXA", codigo: "CX-012" }, "CX → CAIXA, uppercase");
eq(parseCodigoLido("MALA-003"), { tipo: "CAIXA", codigo: "MALA-003" }, "MALA → CAIXA");
eq(parseCodigoLido("NOG-126-001"), { tipo: "ITEM", codigo: "NOG-126-001" }, "SKU → ITEM");
eq(parseCodigoLido("https://x/?item=NOG-9"), { tipo: "ITEM", codigo: "NOG-9" }, "deep-link ?item extrai SKU");
eq(parseCodigoLido("  sala-007?x=1 "), { tipo: "SALA", codigo: "SALA-007?X=1" }, "sem deep-link conhecido, normaliza cru");
eq(parseCodigoLido(""), { tipo: null, codigo: "" }, "vazio → tipo null");
eq(parseCodigoLido(null), { tipo: null, codigo: "" }, "null → tipo null");

console.log("salaLabelTexto");
eq(salaLabelTexto({ codigo: "SALA-001", nome: "Galpão A" }), "SALA-001 · Galpão A", "código + nome");
eq(salaLabelTexto({ codigo: "SALA-002", nome: "" }), "SALA-002", "sem nome → só código");
eq(salaLabelTexto(null), "—", "null → travessão");
eq(salaLabelTexto({ nome: "X" }), "—", "sem código → travessão");

console.log(`\n${passou} asserções OK`);
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npm run test:salas` (após adicionar o script no Step 4) ou `node scripts/test_salas.mjs`
Expected: FALHA com `Cannot find module '../src/lib/salasFormat.js'`.

- [ ] **Step 3: Implementar `salasFormat.js`**

Criar `src/lib/salasFormat.js`:

```js
// Funções puras de salas (sem UI, sem Supabase) — testadas em scripts/test_salas.mjs.

// Roteia um texto lido (QR ou digitado) para { tipo, codigo }. Tolera deep-links
// "?item=" / "?caixa=" / "?sala=". tipo ∈ 'SALA' | 'CAIXA' | 'ITEM' | null (vazio).
export function parseCodigoLido(texto) {
  const raw = String(texto || "").trim();
  const m = raw.match(/[?&](?:item|caixa|sala)=([^&]+)/i);
  const codigo = (m ? decodeURIComponent(m[1]) : raw).trim().toUpperCase();
  let tipo = null;
  if (/^SALA-/.test(codigo)) tipo = "SALA";
  else if (/^CX-/.test(codigo) || /^MALA-/.test(codigo)) tipo = "CAIXA";
  else if (codigo) tipo = "ITEM";
  return { tipo, codigo };
}

// Rótulo curto da sala para etiquetas e telas: "SALA-001 · Galpão A".
// Aceita a linha da sala (ou null). Sem código → "—".
export function salaLabelTexto(sala) {
  if (!sala || !sala.codigo) return "—";
  return sala.nome ? `${sala.codigo} · ${sala.nome}` : sala.codigo;
}
```

- [ ] **Step 4: Registrar o script de teste no `package.json`**

Em `package.json`, adicionar a linha do script (após `"test:fotoprincipal": ...`):

```json
    "test:salas": "node scripts/test_salas.mjs",
```

E incluir `&& npm run test:salas` no final do script agregador `"test"`.

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `npm run test:salas`
Expected: `... asserções OK` (todas passam).

- [ ] **Step 6: Commit**

```bash
git add src/lib/salasFormat.js scripts/test_salas.mjs package.json
git commit -m "feat(salas): funções puras parseCodigoLido/salaLabelTexto + testes"
```

---

## Task 3: Suporte a etiqueta de SALA no `printLog` e `labels`

Adiciona a ação de impressão de etiqueta de sala e o builder `buildRoomLabel`; ajusta `buildBoxLabel`/`buildProductLabel` para exporem o campo `sala`.

**Files:**
- Modify: `src/lib/printLog.js`
- Modify: `src/lib/labels.js`

- [ ] **Step 1: `printLog.js` — nova ação e classificador de etiqueta de sala**

Em `src/lib/printLog.js`, após a linha `export const ACAO_IMPRESSAO_CAIXA = ...;` adicionar:

```js
export const ACAO_IMPRESSAO_SALA = "etiqueta_sala:impressa";  // salas
```

Substituir a definição de `isItemLabel` e adicionar `isSalaLabel` (uma etiqueta de sala NÃO é item):

```js
export const isSalaLabel = (l) => !!(l && l.sku && l.tipo === "SALA");
export const isItemLabel = (l) => !!(l && l.sku && l.tipo !== "CAIXA" && l.tipo !== "MALA" && l.tipo !== "SALA");
export const isBoxLabel = (l) => !!(l && l.sku && (l.tipo === "CAIXA" || l.tipo === "MALA"));
```

Em `registrarImpressao`, incluir as salas. Substituir o corpo que monta `itens`/`caixas`/`rows`/retorno por:

```js
  const all = labels || [];
  const itens = all.filter(isItemLabel);
  const caixas = all.filter(isBoxLabel);
  const salas = all.filter(isSalaLabel);
  if (!itens.length && !caixas.length && !salas.length) return { ok: true, skus: [], caixas: [], salas: [] };
  const detalhe = preset?.id || preset?.label || null;
  const usuario = user?.email || null;
  const rows = [
    ...itens.map((l) => ({ sku: l.sku, acao: ACAO_IMPRESSAO, detalhe, usuario })),
    ...caixas.map((l) => ({ sku: l.sku, acao: ACAO_IMPRESSAO_CAIXA, detalhe, usuario })),
    ...salas.map((l) => ({ sku: l.sku, acao: ACAO_IMPRESSAO_SALA, detalhe, usuario })),
  ];
  const { error } = await supabase.from("eventos").insert(rows);
  if (error) {
    console.error("Falha ao registrar impressão de etiqueta:", error.message);
    return { ok: false, skus: [], caixas: [], salas: [] };
  }
  const skus = itens.map((l) => l.sku);
  if (skus.length) await supabase.from("itens").update({ etiqueta_impressa: true }).in("sku", skus);
  return { ok: true, skus, caixas: caixas.map((l) => l.sku), salas: salas.map((l) => l.sku) };
```

Após `export const buscarViasImpressaoCaixa = ...;` adicionar:

```js
// Vias impressas por código de sala.
export const buscarViasImpressaoSala = (codigos) => contarVias(ACAO_IMPRESSAO_SALA, codigos);
```

- [ ] **Step 2: `labels.js` — import de `salaLabelTexto` e campo `sala` nas etiquetas**

No topo de `src/lib/labels.js`, adicionar ao bloco de imports:

```js
import { salaLabelTexto } from "./salasFormat";
```

Em `buildProductLabel`, alterar a assinatura para `export function buildProductLabel(item, sala)` e, no objeto retornado, **substituir** a linha `local_fisico: item?.local_fisico || "—",` por:

```js
    sala: sala ? salaLabelTexto(sala) : (item?.sala_id || "—"),
```

Em `buildBoxLabel`, alterar a assinatura para `export function buildBoxLabel(caixa, itens, params, sala)` e, no objeto retornado, **substituir** a linha `local_fisico: caixa?.local_fisico || "—",` por:

```js
    sala: sala ? salaLabelTexto(sala) : (caixa?.sala_id || "—"),
```

- [ ] **Step 3: `labels.js` — novo `buildRoomLabel`**

Ao final de `src/lib/labels.js` (antes de `attachQrCodes` ou após), adicionar:

```js
// Etiqueta de SALA (para colar na porta). QR = código da sala; mostra o nome.
export function buildRoomLabel(sala) {
  return {
    tipo: "SALA",
    titulo: "NOGÁRIA OUTLET · ETIQUETA DE SALA",
    sku: sala?.codigo || "",
    nome: sala?.nome || "",
    observacao: sala?.observacao || "",
    qrText: sala?.codigo || "",
    qrData: null,
  };
}
```

- [ ] **Step 4: Lint + build**

Run: `npm run lint && npm run build`
Expected: sem erros (o `LabelCard` ainda referencia `label.local_fisico`; será trocado na Task 6 — como é acesso a propriedade inexistente, não quebra o build, mas a Task 6 corrige a exibição).

- [ ] **Step 5: Commit**

```bash
git add src/lib/printLog.js src/lib/labels.js
git commit -m "feat(salas): etiqueta de sala (printLog + buildRoomLabel) e campo sala nas etiquetas"
```

---

## Task 4: Camada de dados `src/lib/salas.js`

Espelha `src/lib/caixas.js`. Todas as funções que tocam o Supabase (sem teste automatizado — verificação por lint/build e uso real).

**Files:**
- Create: `src/lib/salas.js`

- [ ] **Step 1: Criar `src/lib/salas.js`**

```js
// Salas: local físico estruturado (tabela `salas`) — irmã de `caixas`. Código
// auto-gerado (SALA-001), RLS padrão, eventos best-effort. Caixa/item apontam via
// sala_id; item encaixotado herda a sala da caixa (snapshot), item solto recebe
// sala direto. Lógica de dados isolada da UI, espelhando src/lib/caixas.js.
import { supabase } from "./supabase";
import { pad3, STATUS_FORA_ESTOQUE_IN } from "./model";

// Próximo código sequencial SALA-###, parseando o sufixo do maior existente.
export async function proximoCodigoSala() {
  const { data } = await supabase
    .from("salas").select("codigo").ilike("codigo", "SALA-%")
    .order("codigo", { ascending: false }).limit(1);
  const n = data && data.length ? (parseInt(data[0].codigo.split("-").pop(), 10) || 0) : 0;
  return `SALA-${pad3(n + 1)}`;
}

// Cria uma sala com código auto-gerado; resolve colisão por retry.
export async function criarSala({ nome, observacao }, user) {
  let codigo = await proximoCodigoSala();
  let criada = null, lastErr = null;
  for (let i = 0; i < 6; i++) {
    const { data, error } = await supabase.from("salas").insert({
      codigo, nome: nome?.trim() || codigo,
      observacao: observacao?.trim() || null,
      criado_por: user?.email,
    }).select().single();
    if (!error) { criada = data; break; }
    lastErr = error;
    if (error.code === "23505") {
      const num = parseInt(codigo.split("-").pop(), 10) || 0;
      codigo = `SALA-${pad3(num + 1)}`;
      continue;
    }
    break;
  }
  if (!criada) throw lastErr || new Error("Falha ao criar a sala.");
  await supabase.from("eventos").insert({
    sku: criada.codigo, acao: "sala:criada", detalhe: criada.nome, usuario: user?.email,
  });
  return criada;
}

// Edita a sala (nome/observacao/ativa). Grava evento sala:editada.
export async function atualizarSala(codigo, patch, user) {
  const { data, error } = await supabase.from("salas").update(patch).eq("codigo", codigo).select().single();
  if (error) throw error;
  await supabase.from("eventos").insert({
    sku: codigo, acao: "sala:editada", detalhe: patch.nome ?? null, usuario: user?.email,
  });
  return data;
}

// Lista salas (default: só ativas), mais recentes primeiro.
export async function listarSalas({ ativa = true } = {}) {
  let q = supabase.from("salas").select("*");
  if (ativa !== null) q = q.eq("ativa", ativa);
  const { data } = await q.order("criado_em", { ascending: false });
  return data || [];
}

// Busca uma sala pelo código (ex.: ao escanear o QR da porta). null se não existir.
export async function buscarSala(codigo) {
  const cod = String(codigo || "").trim().toUpperCase();
  if (!cod) return null;
  const { data } = await supabase.from("salas").select("*").eq("codigo", cod).maybeSingle();
  return data || null;
}

// Conteúdo de uma sala: caixas na sala + itens soltos (sem caixa) na sala.
// Oculta itens fora do estoque (VENDIDO/ENTREGUE/DESCARTE).
export async function conteudoSala(codigo) {
  const [caixasRes, itensRes] = await Promise.all([
    supabase.from("caixas").select("*").eq("sala_id", codigo).order("codigo"),
    supabase.from("itens").select("*").eq("sala_id", codigo).is("caixa_id", null)
      .not("status", "in", STATUS_FORA_ESTOQUE_IN).order("sku"),
  ]);
  return { caixas: caixasRes.data || [], itensSoltos: itensRes.data || [] };
}

// Aloca uma caixa numa sala e PROPAGA sala_id aos itens dela. Evento caixa:sala.
export async function alocarCaixaNaSala(codigoCaixa, salaCodigo, user) {
  const s = salaCodigo || null;
  const { data, error } = await supabase.from("caixas")
    .update({ sala_id: s }).eq("codigo", codigoCaixa).select().single();
  if (error) throw error;
  await supabase.from("itens").update({ sala_id: s, upd_by: user?.email }).eq("caixa_id", codigoCaixa);
  await supabase.from("eventos").insert({
    sku: codigoCaixa, acao: "caixa:sala", detalhe: s || "sem sala", usuario: user?.email,
  });
  return data;
}

// Aloca um item SOLTO numa sala. Se o item estiver numa caixa e forcarRetirarDaCaixa
// for falso, NÃO altera nada e retorna { precisaConfirmar: true, caixa_id } para a UI
// oferecer a retirada. Com forcarRetirarDaCaixa: remove da caixa e aloca na sala,
// registrando quem movimentou (evento item:sala com a origem).
export async function alocarItemNaSala(sku, salaCodigo, user, { forcarRetirarDaCaixa = false } = {}) {
  const s = salaCodigo || null;
  const { data: atual, error: e0 } = await supabase.from("itens")
    .select("sku, caixa_id").eq("sku", sku).single();
  if (e0) throw e0;
  if (atual.caixa_id && !forcarRetirarDaCaixa) {
    return { precisaConfirmar: true, caixa_id: atual.caixa_id };
  }
  const patch = { sala_id: s, upd_by: user?.email };
  let detalhe = s || "sem sala";
  if (atual.caixa_id && forcarRetirarDaCaixa) {
    patch.caixa_id = null;
    detalhe = `${s || "sem sala"} · retirado de ${atual.caixa_id}`;
  }
  const { data, error } = await supabase.from("itens").update(patch).eq("sku", sku).select().single();
  if (error) throw error;
  await supabase.from("eventos").insert({
    sku, acao: "item:sala", detalhe, usuario: user?.email,
  });
  return { item: data };
}

// Remove uma caixa da sala (sala_id=null) e propaga aos itens. Evento caixa:sala.
export async function removerCaixaDaSala(codigoCaixa, user) {
  return alocarCaixaNaSala(codigoCaixa, null, user);
}

// Remove um item solto da sala (sala_id=null). Evento item:sala.
export async function removerItemDaSala(sku, user) {
  const { error } = await supabase.from("itens").update({ sala_id: null, upd_by: user?.email }).eq("sku", sku);
  if (error) throw error;
  await supabase.from("eventos").insert({ sku, acao: "item:sala", detalhe: "sem sala", usuario: user?.email });
}

// Histórico de uma sala (eventos cuja `sku` é o código da sala), recentes primeiro.
export async function historicoSala(codigo) {
  const { data } = await supabase.from("eventos")
    .select("*").eq("sku", codigo).order("ts", { ascending: false });
  return data || [];
}
```

- [ ] **Step 2: Verificar `pad3` e `STATUS_FORA_ESTOQUE_IN` existem em `model.js`**

Run: `grep -n "export const pad3\|export const STATUS_FORA_ESTOQUE_IN\|export function pad3" src/lib/model.js`
Expected: ambos aparecem (já usados por `caixas.js`). Se `pad3` for função e não const, ajustar o import — confirmar a forma exata do export e casar.

- [ ] **Step 3: Lint + build**

Run: `npm run lint && npm run build`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/lib/salas.js
git commit -m "feat(salas): camada de dados (CRUD, alocação caixa/item, conteúdo, histórico)"
```

---

## Task 5: `caixas.js` — propagar `sala_id` aos itens

O item encaixotado passa a herdar `sala_id` da caixa (no lugar de `local_fisico`). `registrarChegada` passa a aceitar `sala_id`.

**Files:**
- Modify: `src/lib/caixas.js`

- [ ] **Step 1: `adicionarItemCaixa` — herdar sala da caixa**

Em `src/lib/caixas.js`, na função `adicionarItemCaixa`, no `.update({...})` que hoje é:

```js
  const { data, error } = await supabase.from("itens").update({
    caixa_id: caixa.codigo, destino: caixa.destino || null,
    local_fisico: caixa.local_fisico || null, upd_by: user?.email,
  }).eq("sku", sku).select().single();
```

substituir por (herda `sala_id`, mantém `local_fisico` legado em sincronia opcional — **não**; usamos só sala):

```js
  const { data, error } = await supabase.from("itens").update({
    caixa_id: caixa.codigo, destino: caixa.destino || null,
    sala_id: caixa.sala_id || null, upd_by: user?.email,
  }).eq("sku", sku).select().single();
```

- [ ] **Step 2: `atualizarCaixa` — propagar `sala_id`**

Na função `atualizarCaixa`, o bloco de propagação hoje é:

```js
  if ("destino" in patch || "local_fisico" in patch) {
    const prop = {};
    if ("destino" in patch) prop.destino = patch.destino || null;
    if ("local_fisico" in patch) prop.local_fisico = patch.local_fisico || null;
    prop.upd_by = user?.email;
    await supabase.from("itens").update(prop).eq("caixa_id", codigo);
  }
```

substituir por:

```js
  if ("destino" in patch || "sala_id" in patch) {
    const prop = {};
    if ("destino" in patch) prop.destino = patch.destino || null;
    if ("sala_id" in patch) prop.sala_id = patch.sala_id || null;
    prop.upd_by = user?.email;
    await supabase.from("itens").update(prop).eq("caixa_id", codigo);
  }
```

- [ ] **Step 3: `registrarChegada` — aceitar `sala_id` no lugar de `local`**

Substituir a função `registrarChegada` inteira (que hoje recebe `{ chegou_em, local, destino }` e grava `local_fisico`) por:

```js
// Registra a chegada (ex.: em Belém): grava `chegou_em`, opcionalmente `destino` e
// `sala_id` (propagados aos itens da caixa) e evento `caixa:chegada`. `chegou_em`
// aceita data retroativa (default: agora). A sala substitui o antigo local livre.
export async function registrarChegada(codigo, { chegou_em, destino, sala_id }, user) {
  const quando = chegou_em || new Date().toISOString();
  const patchCaixa = { chegou_em: quando };
  const patchItens = { upd_by: user?.email };
  if (destino !== undefined) { const d = destino?.trim?.() || destino || null; patchCaixa.destino = d; patchItens.destino = d; }
  if (sala_id !== undefined) { const s = sala_id || null; patchCaixa.sala_id = s; patchItens.sala_id = s; }
  const { data, error } = await supabase.from("caixas")
    .update(patchCaixa).eq("codigo", codigo).select().single();
  if (error) throw error;
  await supabase.from("itens").update(patchItens).eq("caixa_id", codigo);
  await supabase.from("eventos").insert({
    sku: codigo, acao: "caixa:chegada", detalhe: chegadaDetalhe(quando, sala_id || null), usuario: user?.email,
  });
  return data;
}
```

> Nota: `chegadaDetalhe(quando, local)` (em `caixasFormat.js`) monta "Belém · data · local". Passamos o código da sala como 3º argumento; o texto fica "Belém · data · SALA-001". Aceitável — o histórico aponta a sala.

- [ ] **Step 4: Remover `definirLocalCaixa` (substituída por `alocarCaixaNaSala`)**

Run: `grep -rn "definirLocalCaixa" src/`
Se **não houver** uso na UI (esperado — hoje só é exportada), **remover** a função `definirLocalCaixa` de `src/lib/caixas.js`. Se houver uso, deixar para a task da respectiva tela substituir por `alocarCaixaNaSala` e só então remover.

- [ ] **Step 5: Lint + build**

Run: `npm run lint && npm run build`
Expected: **vai falhar** em `src/screens/CaixasScreen.jsx` e `src/screens/ConferenciaScreen.jsx`, que ainda chamam `registrarChegada(..., { local })` e `criarCaixa({ local_fisico })`. Isso é esperado e será corrigido nas Tasks 7–8. Se quiser um commit verde aqui, faça as Tasks 7 e 8 antes de rodar o build final; caso contrário, siga e o build ficará verde ao fim da Task 8.

- [ ] **Step 6: Commit**

```bash
git add src/lib/caixas.js
git commit -m "feat(salas): caixas propagam sala_id aos itens; registrarChegada aceita sala"
```

---

## Task 6: `LabelCard` — exibir Sala e layout da etiqueta de SALA

**Files:**
- Modify: `src/components/labels/LabelCard.jsx`

- [ ] **Step 1: Trocar "Local" por "Sala" nas etiquetas de caixa/item**

Em `src/components/labels/LabelCard.jsx`, fazer as substituições:

`CompactProduct` — a linha:
```jsx
        <div style={nowrap}>Caixa <b>{label.caixa_num}</b> · Local <b>{label.local_fisico}</b></div>
```
vira:
```jsx
        <div style={nowrap}>Caixa <b>{label.caixa_num}</b> · Sala <b>{label.sala}</b></div>
```

`CompactBox` — a linha `<div>Local: <b>{label.local_fisico}</b></div>` vira:
```jsx
        <div>Sala: <b>{label.sala}</b></div>
```

`FullProduct` — na linha de metadados, trocar `· Local: {label.local_fisico}` por `· Sala: {label.sala}`:
```jsx
            Lote {label.lote}
            {label.classe ? ` · Classe ${label.classe}` : ""} · Caixa/Mala: {label.caixa_num} · Sala: {label.sala}
```

`FullBox` — a linha `<div>Local: <b>{label.local_fisico}</b> · Destino: <b>{label.destino}</b></div>` vira:
```jsx
        <div>Sala: <b>{label.sala}</b> · Destino: <b>{label.destino}</b></div>
```

- [ ] **Step 2: Adicionar o componente de layout da etiqueta de SALA**

Antes de `export default function LabelCard`, adicionar `CompactRoom` e `FullRoom`:

```jsx
function CompactRoom({ label }) {
  return (
    <>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Qr data={label.qrData} size={22} />
      </div>
      <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: "11pt", textAlign: "center", marginTop: mm(1), whiteSpace: "nowrap" }}>
        {label.sku}
      </div>
      <div style={{ fontSize: "9pt", fontWeight: 700, textAlign: "center", marginTop: mm(0.6), lineHeight: 1.2 }}>
        {label.nome}
      </div>
      {label.observacao && (
        <div style={{ fontSize: "7pt", textAlign: "center", marginTop: mm(0.8) }}>{label.observacao}</div>
      )}
      <div style={{ fontSize: "6pt", marginTop: mm(1.2), textAlign: "center", fontWeight: 700 }}>
        Escaneie o QR para ver o conteúdo da sala
      </div>
    </>
  );
}

function FullRoom({ label, tall = false }) {
  return (
    <>
      <div style={{ display: "flex", gap: mm(2) }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: tall ? "16pt" : "13pt", whiteSpace: "nowrap" }}>
            {label.sku}
          </div>
          <div style={{ fontSize: tall ? "12pt" : "10pt", fontWeight: 700, marginTop: mm(0.6) }}>
            {label.nome}
          </div>
        </div>
        <Qr data={label.qrData} size={tall ? 30 : 22} />
      </div>
      {label.observacao && (
        <div style={{ fontSize: tall ? "9pt" : "8pt", marginTop: mm(1.2) }}>{label.observacao}</div>
      )}
      {tall && <div style={{ flexGrow: 1, minHeight: mm(2) }} />}
      <div style={{ fontSize: tall ? "8.5pt" : "7.5pt", marginTop: mm(1.4), fontWeight: 700 }}>
        Escaneie o QR para ver o conteúdo da sala.
      </div>
    </>
  );
}
```

- [ ] **Step 3: Rotear o tipo SALA no corpo do `LabelCard`**

Em `LabelCard`, substituir o bloco:

```jsx
  const isBox = label.tipo === "CAIXA" || label.tipo === "MALA";
```
por:
```jsx
  const isBox = label.tipo === "CAIXA" || label.tipo === "MALA";
  const isRoom = label.tipo === "SALA";
```

e substituir a expressão final de render:

```jsx
      {compact
        ? isBox
          ? <CompactBox label={label} />
          : <CompactProduct label={label} />
        : isBox
          ? <FullBox label={label} tall={tall} />
          : <FullProduct label={label} tall={tall} />}
```
por:
```jsx
      {isRoom
        ? (compact ? <CompactRoom label={label} /> : <FullRoom label={label} tall={tall} />)
        : compact
          ? isBox
            ? <CompactBox label={label} />
            : <CompactProduct label={label} />
          : isBox
            ? <FullBox label={label} tall={tall} />
            : <FullProduct label={label} tall={tall} />}
```

- [ ] **Step 4: Lint + build**

Run: `npm run lint && npm run build`
Expected: sem erros (ignorar falhas pendentes em CaixasScreen/ConferenciaScreen se as Tasks 5/7/8 ainda não fecharam).

- [ ] **Step 5: Commit**

```bash
git add src/components/labels/LabelCard.jsx
git commit -m "feat(salas): LabelCard mostra Sala e ganha layout de etiqueta de sala"
```

---

## Task 7: `CaixasScreen` — seletor de sala (substitui o input de local)

Troca o input "Local de armazenamento" por um dropdown de salas; `registrarChegada` passa a mandar `sala_id`; etiquetas passam a resolver a sala.

**Files:**
- Modify: `src/screens/CaixasScreen.jsx`

- [ ] **Step 1: Imports — trazer salas**

No topo de `src/screens/CaixasScreen.jsx`, adicionar aos imports:

```js
import { listarSalas } from "../lib/salas";
import { salaLabelTexto } from "../lib/salasFormat";
```

- [ ] **Step 2: `CaixaDetalhe` — carregar salas e estado da sala escolhida**

Dentro de `CaixaDetalhe`, **remover** o estado `const [local, setLocal] = useState(caixa.local_fisico || "");` e o bloco `destinoOpcoes`/`destino` já existentes permanecem. Adicionar:

```js
  const [salas, setSalas] = useState([]);
  const [salaId, setSalaId] = useState(caixa.sala_id || "");
  useEffect(() => { listarSalas().then(setSalas).catch(() => setSalas([])); }, []);
  const salaAtual = salas.find((s) => s.codigo === salaId) || (caixa.sala_id ? { codigo: caixa.sala_id } : null);
```

- [ ] **Step 3: `doChegada` — enviar `sala_id`**

Substituir o corpo de `doChegada` para mandar `sala_id` (sem `local`):

```js
  const doChegada = async () => {
    setSalvando("chegada"); setErro(null);
    try { await registrarChegada(caixa.codigo, { chegou_em: dataChegada, destino, sala_id: salaId || null }, user); await onChanged(); }
    catch (e) { setErro(e.message || String(e)); }
    finally { setSalvando(null); }
  };
```

- [ ] **Step 4: UI — trocar o input de local pelo select de sala**

No card "Chegada e armazenamento", **substituir** o `<label>` do "Local de armazenamento" (input de `local`) por:

```jsx
          <label className="block">
            <span className="text-xs text-gray-500">Sala (armazenamento)</span>
            <select value={salaId} onChange={(e) => setSalaId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-500">
              <option value="">— sem sala —</option>
              {salas.map((s) => <option key={s.codigo} value={s.codigo}>{salaLabelTexto(s)}</option>)}
              {caixa.sala_id && !salas.some((s) => s.codigo === caixa.sala_id) && (
                <option value={caixa.sala_id}>{caixa.sala_id} (inativa)</option>
              )}
            </select>
          </label>
```

Atualizar o texto de ajuda: trocar "O destino e o local são aplicados…" por:

```jsx
          <p className="text-[11px] text-gray-400">O destino e a sala são aplicados à caixa e a todos os {itens.length} item(ns) dela (as etiquetas passam a mostrar o novo destino/sala).</p>
```

- [ ] **Step 5: Etiquetas — passar a sala resolvida**

Atualizar os handlers de impressão para resolver a sala:

```js
  const imprimir = () => setPrintLabels([buildBoxLabel(caixa, itens, params, salaAtual)]);
  const imprimirItens = () => { if (itens.length) setPrintLabels(itens.map((it) => buildProductLabel(it, salaAtual))); };
```

- [ ] **Step 6: Lint + build**

Run: `npm run lint && npm run build`
Expected: sem erros nesta tela.

- [ ] **Step 7: Commit**

```bash
git add src/screens/CaixasScreen.jsx
git commit -m "feat(salas): CaixasScreen usa seletor de sala e etiquetas com sala"
```

---

## Task 8: `ConferenciaScreen` — sala na criação da caixa

**Files:**
- Modify: `src/screens/ConferenciaScreen.jsx`

- [ ] **Step 1: Imports**

Adicionar aos imports do topo:

```js
import { listarSalas } from "../lib/salas";
import { salaLabelTexto } from "../lib/salasFormat";
```

- [ ] **Step 2: Estado do formulário de criação (componente do encaixotamento)**

No componente que tem `const [destino, setDestino] = useState(DESTINOS[0]); const [local, setLocal] = useState("");` (por volta da linha 525): **remover** `local`/`setLocal`, adicionar:

```js
  const [salaId, setSalaId] = useState("");
  const [salas, setSalas] = useState([]);
  useEffect(() => { listarSalas().then(setSalas).catch(() => setSalas([])); }, []);
```

(Se o componente ainda não importa `useEffect`, garantir o import de `react`.)

- [ ] **Step 3: `criarCaixa` — mandar `sala_id`**

Trocar a chamada:
```js
      const c = await criarCaixa({ tipo, destino, local_fisico: local }, user);
      setNova(false); setLocal("");
```
por:
```js
      const c = await criarCaixa({ tipo, destino, sala_id: salaId || null }, user);
      setNova(false); setSalaId("");
```

- [ ] **Step 4: `criarCaixa` em `caixas.js` — aceitar `sala_id`**

Em `src/lib/caixas.js`, na função `criarCaixa`, o insert hoje grava `local_fisico: local_fisico?.trim() || null`. Alterar a desestruturação e o insert:

Assinatura: `export async function criarCaixa({ tipo, destino, sala_id, referencia }, user)`.
No insert, **trocar** `local_fisico: local_fisico?.trim() || null,` por `sala_id: sala_id || null,`.

- [ ] **Step 5: UI — trocar o input de local pelo select de sala**

Substituir o input:
```jsx
          <input value={local} onChange={(e) => setLocal(e.target.value)} className={inputCls} placeholder="Local físico (ex.: estante 2)" />
```
por:
```jsx
          <select value={salaId} onChange={(e) => setSalaId(e.target.value)} className={inputCls}>
            <option value="">— sem sala —</option>
            {salas.map((s) => <option key={s.codigo} value={s.codigo}>{salaLabelTexto(s)}</option>)}
          </select>
```

- [ ] **Step 6: Etiquetas na Conferência — passar a sala (se resolvível)**

Nos pontos onde a Conferência chama `buildBoxLabel(caixa, itens, params)` (há dois: no encaixotamento e no `CaixaFechadaItem`), passar a sala quando disponível. Como esses componentes não carregam a lista de salas, passar `null` mantém o build correto (a etiqueta mostra o código `caixa.sala_id`). Deixar como está (`buildBoxLabel(caixa, data, params)`) — o 4º argumento ausente cai no fallback do código da sala. **Sem alteração obrigatória aqui**; anotado para clareza.

- [ ] **Step 7: Lint + build**

Run: `npm run lint && npm run build`
Expected: sem erros (com Tasks 5 e 7 já feitas, o build fica verde).

- [ ] **Step 8: Commit**

```bash
git add src/screens/ConferenciaScreen.jsx src/lib/caixas.js
git commit -m "feat(salas): criação de caixa usa seletor de sala"
```

---

## Task 9: `SalasScreen` — lista, criação, detalhe, encher sala e etiqueta

Tela nova espelhando `CaixasScreen` (lista + scan + detalhe). O detalhe mostra conteúdo, permite editar nome/observação, imprimir etiqueta e "encher sala" por scan.

**Files:**
- Create: `src/screens/SalasScreen.jsx`

- [ ] **Step 1: Criar `src/screens/SalasScreen.jsx`**

```jsx
import React, { useState, useEffect, useCallback, Suspense } from "react";
import {
  listarSalas, buscarSala, criarSala, atualizarSala, conteudoSala,
  alocarCaixaNaSala, alocarItemNaSala, removerCaixaDaSala, removerItemDaSala, historicoSala,
} from "../lib/salas";
import { parseCodigoLido, salaLabelTexto } from "../lib/salasFormat";
import { buildRoomLabel } from "../lib/labels";
import { buscarViasImpressaoSala } from "../lib/printLog";
import { CLASSE_STYLE } from "../lib/model";
import {
  X, Loader2, ScanLine, ArrowRight, AlertTriangle, DoorOpen, Package, Boxes,
  ChevronRight, ChevronLeft, Plus, Search, Printer, QrCode, History, Trash2, Pencil,
} from "lucide-react";

const BarcodeScanner = React.lazy(() => import("./BarcodeScanner"));
const LazyLabelPrint = React.lazy(() => import("../components/labels/LabelPrint"));

const eventoSalaLabel = (a) => ({
  "sala:criada": "sala criada", "sala:editada": "sala editada",
  "caixa:sala": "caixa alocada", "item:sala": "item alocado",
  "etiqueta_sala:impressa": "etiqueta impressa",
}[a] || a);

export default function SalasScreen({ params, user, onClose, onOpenItem }) {
  const [fase, setFase] = useState("lista"); // "lista" | "scan" | "buscando" | "detalhe"
  const [salas, setSalas] = useState([]);
  const [sala, setSala] = useState(null);
  const [conteudo, setConteudo] = useState({ caixas: [], itensSoltos: [] });
  const [hist, setHist] = useState([]);
  const [erro, setErro] = useState(null);
  const [manual, setManual] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const [criando, setCriando] = useState(false);

  const carregarLista = useCallback(async () => { setSalas(await listarSalas()); }, []);
  useEffect(() => { carregarLista(); }, [carregarLista]);

  const abrir = async (texto) => {
    const cod = parseCodigoLido(texto).codigo;
    if (!cod) return;
    setFase("buscando"); setErro(null);
    try {
      const s = await buscarSala(cod);
      if (!s) { setErro(`Nenhuma sala com o código "${cod}".`); setFase(salas.length ? "lista" : "scan"); return; }
      setSala(s);
      setConteudo(await conteudoSala(s.codigo));
      setHist(await historicoSala(s.codigo));
      setFase("detalhe");
    } catch (e) { setErro("Falha ao buscar: " + (e.message || String(e))); setFase("lista"); }
  };

  const recarregar = async () => {
    if (!sala) return;
    setSala(await buscarSala(sala.codigo));
    setConteudo(await conteudoSala(sala.codigo));
    setHist(await historicoSala(sala.codigo));
  };

  const voltarLista = async () => { setSala(null); setErro(null); setManual(""); await carregarLista(); setFase("lista"); };

  const criar = async (e) => {
    e.preventDefault();
    const nome = novoNome.trim();
    if (!nome) return;
    setCriando(true); setErro(null);
    try { const s = await criarSala({ nome }, user); setNovoNome(""); await carregarLista(); abrir(s.codigo); }
    catch (err) { setErro(err.message || String(err)); }
    finally { setCriando(false); }
  };

  if (fase === "detalhe" && sala) {
    return (
      <SalaDetalhe sala={sala} conteudo={conteudo} hist={hist} params={params} user={user}
        onBack={voltarLista} onClose={onClose} onOpenItem={onOpenItem} onChanged={recarregar} />
    );
  }

  if (fase === "buscando") {
    return <div className="fixed inset-0 z-50 bg-gray-900 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>;
  }

  if (fase === "scan") {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col">
        <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>}>
          <BarcodeScanner qr onClose={() => setFase("lista")} onDetected={abrir}
            title="Sala por QR — escaneie a etiqueta" hint="Aponte para o QR da porta da sala." />
        </Suspense>
        <div className="absolute bottom-0 inset-x-0 bg-black/80 px-4 py-3">
          {erro && <p className="text-amber-300 text-xs mb-2 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {erro}</p>}
          <form onSubmit={(e) => { e.preventDefault(); abrir(manual); }} className="flex gap-2">
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="ou digite o código (ex.: SALA-001)"
              autoCapitalize="characters" autoComplete="off"
              className="flex-1 rounded-lg border border-gray-600 bg-gray-900 text-white px-3 py-2.5 text-sm font-mono placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500" />
            <button type="submit" className="px-4 rounded-lg bg-orange-500 text-white font-semibold flex items-center gap-1 text-sm">Abrir <ArrowRight className="w-4 h-4" /></button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col">
      <div className="bg-gray-900 text-white px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-sm flex items-center gap-1.5"><DoorOpen className="w-4 h-4" /> Salas</span>
          <button onClick={onClose} aria-label="Fechar"><X className="w-6 h-6 text-gray-300" /></button>
        </div>
      </div>

      <div className="bg-white border-b border-gray-200 px-4 py-3 space-y-2">
        <div className="flex gap-2">
          <button onClick={() => { setErro(null); setManual(""); setFase("scan"); }}
            className="flex-1 flex items-center justify-center gap-2 bg-gray-900 text-white rounded-xl py-2.5 text-sm font-bold active:bg-gray-800">
            <ScanLine className="w-4 h-4" /> Escanear QR
          </button>
          <form onSubmit={(e) => { e.preventDefault(); abrir(manual); }} className="flex-1 flex gap-2">
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="código (SALA-001)"
              autoCapitalize="characters" autoComplete="off"
              className="flex-1 min-w-0 rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-500" />
            <button type="submit" aria-label="Abrir" className="px-3 rounded-lg bg-orange-500 text-white"><Search className="w-4 h-4" /></button>
          </form>
        </div>
        <form onSubmit={criar} className="flex gap-2">
          <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Nova sala (ex.: Galpão A)"
            className="flex-1 min-w-0 rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
          <button type="submit" disabled={criando || !novoNome.trim()} className="px-3 rounded-lg bg-emerald-600 text-white flex items-center gap-1 text-sm font-semibold disabled:opacity-50">
            {criando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Criar
          </button>
        </form>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {erro && <p className="text-sm text-red-600 mb-3 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {erro}</p>}
        {!salas.length ? (
          <p className="text-sm text-gray-400 text-center py-10">Nenhuma sala ainda. Crie a primeira acima.</p>
        ) : (
          <div className="space-y-1.5">
            {salas.map((s) => (
              <button key={s.codigo} onClick={() => abrir(s.codigo)}
                className="w-full text-left bg-white rounded-xl border border-gray-200 px-3 py-2.5 flex items-center gap-3 active:bg-gray-100">
                <DoorOpen className="w-5 h-5 text-gray-400" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-gray-900">{s.codigo}</span>
                    <span className="text-sm text-gray-700 truncate">{s.nome}</span>
                  </div>
                  {s.observacao && <p className="text-xs text-gray-400 truncate">{s.observacao}</p>}
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

function SalaDetalhe({ sala, conteudo, hist, params, user, onBack, onClose, onOpenItem, onChanged }) {
  const [printLabels, setPrintLabels] = useState(null);
  const [vias, setVias] = useState(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanMsg, setScanMsg] = useState(null); // { tom, texto }
  const [pendente, setPendente] = useState(null); // { sku, caixa_id } aguardando confirmar retirada
  const [erro, setErro] = useState(null);
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(sala.nome || "");
  const [obs, setObs] = useState(sala.observacao || "");

  const carregarVias = useCallback(async () => {
    const m = await buscarViasImpressaoSala([sala.codigo]);
    setVias(m[sala.codigo] || { vias: 0, ultima: null });
  }, [sala.codigo]);
  useEffect(() => { carregarVias(); }, [carregarVias]);

  const imprimir = () => setPrintLabels([buildRoomLabel(sala)]);
  const fecharImpressao = async () => { setPrintLabels(null); await carregarVias(); };

  const salvarEdicao = async () => {
    setErro(null);
    try { await atualizarSala(sala.codigo, { nome: nome.trim() || sala.codigo, observacao: obs.trim() || null }, user); setEditando(false); await onChanged(); }
    catch (e) { setErro(e.message || String(e)); }
  };

  const handleScan = async (texto) => {
    const { tipo, codigo } = parseCodigoLido(texto);
    setPendente(null);
    try {
      if (tipo === "CAIXA") {
        await alocarCaixaNaSala(codigo, sala.codigo, user);
        await onChanged();
        setScanMsg({ tom: "ok", texto: `${codigo} alocada nesta sala ✓` });
      } else if (tipo === "ITEM") {
        const r = await alocarItemNaSala(codigo, sala.codigo, user);
        if (r.precisaConfirmar) {
          setPendente({ sku: codigo, caixa_id: r.caixa_id });
          setScanMsg({ tom: "warn", texto: `${codigo} está na caixa ${r.caixa_id}` });
        } else {
          await onChanged();
          setScanMsg({ tom: "ok", texto: `${codigo} alocado nesta sala ✓` });
        }
      } else if (tipo === "SALA") {
        setScanMsg({ tom: "dup", texto: `${codigo} é uma sala — escaneie caixas/itens` });
      }
    } catch (e) { setScanMsg({ tom: "err", texto: e.message || String(e) }); }
  };

  const confirmarRetirada = async () => {
    if (!pendente) return;
    setErro(null);
    try {
      await alocarItemNaSala(pendente.sku, sala.codigo, user, { forcarRetirarDaCaixa: true });
      setScanMsg({ tom: "ok", texto: `${pendente.sku} retirado de ${pendente.caixa_id} e alocado ✓` });
      setPendente(null);
      await onChanged();
    } catch (e) { setErro(e.message || String(e)); }
  };

  const tirarCaixa = async (codigo) => { try { await removerCaixaDaSala(codigo, user); await onChanged(); } catch (e) { setErro(e.message || String(e)); } };
  const tirarItem = async (sku) => { try { await removerItemDaSala(sku, user); await onChanged(); } catch (e) { setErro(e.message || String(e)); } };

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col">
      <div className="bg-gray-900 text-white px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-300"><ChevronLeft className="w-5 h-5" /> Salas</button>
          <button onClick={onClose} aria-label="Fechar"><X className="w-6 h-6 text-gray-300" /></button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="font-mono text-lg font-bold text-orange-400">{sala.codigo}</span>
          <span className="text-base text-gray-200">{sala.nome}</span>
        </div>
        <p className="text-3xl font-bold mt-2">{conteudo.caixas.length} <span className="text-base text-gray-400">caixa(s)</span> · {conteudo.itensSoltos.length} <span className="text-base text-gray-400">item(ns) solto(s)</span></p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {erro && <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {erro}</p>}

        {/* Cabeçalho: editar + etiqueta + encher */}
        <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2.5">
          {editando ? (
            <>
              <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome da sala"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observação (opcional)"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              <div className="flex gap-2">
                <button onClick={salvarEdicao} className="flex-1 bg-orange-500 text-white rounded-xl py-2 text-sm font-bold active:bg-orange-600">Salvar</button>
                <button onClick={() => { setEditando(false); setNome(sala.nome || ""); setObs(sala.observacao || ""); }} className="flex-1 border border-gray-300 text-gray-700 rounded-xl py-2 text-sm font-semibold">Cancelar</button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setEditando(true)} className="flex-1 flex items-center justify-center gap-1.5 border border-gray-300 text-gray-700 bg-white rounded-xl py-2.5 text-sm font-semibold active:bg-gray-100">
                <Pencil className="w-4 h-4" /> Editar
              </button>
              <button onClick={imprimir} className="flex-1 flex items-center justify-center gap-1.5 border border-gray-300 text-gray-700 bg-white rounded-xl py-2.5 text-sm font-semibold active:bg-gray-100">
                <Printer className="w-4 h-4" /> Etiqueta{vias?.vias > 0 ? ` · ${vias.vias + 1}ª via` : ""}
              </button>
            </div>
          )}
          <button onClick={() => { setScanMsg(null); setPendente(null); setScanOpen(true); }}
            className="w-full flex items-center justify-center gap-1.5 bg-gray-900 text-white rounded-xl py-2.5 text-sm font-bold active:bg-gray-800">
            <QrCode className="w-4 h-4" /> Encher sala (escanear caixas/itens)
          </button>
        </div>

        {/* Caixas na sala */}
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Caixas na sala</p>
          {!conteudo.caixas.length ? (
            <p className="text-sm text-gray-400">Nenhuma caixa.</p>
          ) : (
            <div className="space-y-1.5">
              {conteudo.caixas.map((c) => (
                <div key={c.codigo} className="bg-white rounded-xl border border-gray-200 px-3 py-2.5 flex items-center gap-3">
                  {c.tipo === "MALA" ? <Boxes className="w-5 h-5 text-gray-400" /> : <Package className="w-5 h-5 text-gray-400" />}
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-sm font-bold text-gray-900">{c.codigo}</span>
                    <p className="text-xs text-gray-500 truncate">{c.destino || "sem destino"}</p>
                  </div>
                  <button onClick={() => tirarCaixa(c.codigo)} aria-label="Remover da sala" className="p-1.5 text-gray-400 active:text-red-600"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Itens soltos na sala */}
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Itens soltos na sala</p>
          {!conteudo.itensSoltos.length ? (
            <p className="text-sm text-gray-400">Nenhum item solto.</p>
          ) : (
            <div className="space-y-1.5">
              {conteudo.itensSoltos.map((it) => (
                <div key={it.sku} className="bg-white rounded-xl border border-gray-200 px-3 py-2.5 flex items-center gap-3">
                  <button onClick={() => onOpenItem?.(it)} className="flex-1 min-w-0 text-left active:opacity-70">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-gray-900">{it.sku}</span>
                      {it.classe && <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${CLASSE_STYLE[it.classe] || "bg-gray-400 text-white"}`}>{it.classe}</span>}
                    </div>
                    <p className="text-sm text-gray-600 truncate">{it.produto}</p>
                  </button>
                  <button onClick={() => tirarItem(it.sku)} aria-label="Remover da sala" className="p-1.5 text-gray-400 active:text-red-600"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Histórico */}
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Histórico da sala</p>
          {!hist.length ? <p className="text-sm text-gray-400">Sem histórico ainda.</p> : (
            <div className="space-y-1">
              {hist.map((e) => (
                <div key={e.id} className="bg-white rounded-lg border border-gray-200 px-3 py-2 text-sm">
                  <span className="text-gray-800">{eventoSalaLabel(e.acao)}</span>
                  {e.detalhe && <span className="text-gray-500"> · {e.detalhe}</span>}
                  <p className="text-[11px] text-gray-400">{e.usuario} · {new Date(e.ts).toLocaleString("pt-BR")}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Impressão da etiqueta da sala */}
      {printLabels && (
        <Suspense fallback={<div className="fixed inset-0 z-[70] bg-white flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>}>
          <LazyLabelPrint labels={printLabels} user={user} onClose={fecharImpressao} />
        </Suspense>
      )}

      {/* Scanner contínuo: encher a sala */}
      {scanOpen && (
        <>
          <Suspense fallback={<div className="fixed inset-0 z-[60] bg-black flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>}>
            <BarcodeScanner qr continuous onClose={() => setScanOpen(false)} onDetected={handleScan}
              title="Encher sala" hint="Escaneie caixas (CX/MALA) ou itens soltos (NOG)." />
          </Suspense>
          <div className="fixed inset-x-0 bottom-0 z-[70] px-4 pb-4 pt-3 bg-gradient-to-t from-black/90 to-transparent">
            <div className="max-w-lg mx-auto space-y-2">
              {scanMsg && (
                <p className={`text-center text-sm font-bold rounded-lg py-2 ${
                  scanMsg.tom === "ok" ? "bg-emerald-500 text-white"
                    : scanMsg.tom === "dup" ? "bg-sky-500 text-white"
                    : scanMsg.tom === "warn" ? "bg-amber-500 text-white"
                    : "bg-red-500 text-white"}`}>{scanMsg.texto}</p>
              )}
              {pendente && (
                <button onClick={confirmarRetirada}
                  className="w-full bg-orange-500 text-white rounded-xl py-3 font-bold active:bg-orange-600">
                  Retirar {pendente.sku} da caixa {pendente.caixa_id} e dar entrada nesta sala
                </button>
              )}
              <button onClick={() => setScanOpen(false)} className="w-full bg-white text-gray-900 rounded-xl py-3 font-bold active:bg-gray-100">Concluir</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Lint + build**

Run: `npm run lint && npm run build`
Expected: sem erros. Verificar que `DoorOpen` e `Pencil` existem em `lucide-react` (existem). Se algum ícone não existir, trocar por um equivalente (`Warehouse`, `Edit3`).

- [ ] **Step 3: Commit**

```bash
git add src/screens/SalasScreen.jsx
git commit -m "feat(salas): tela de Salas (lista, criação, detalhe, encher sala, etiqueta)"
```

---

## Task 10: Navegação — botão flutuante "Salas" no `App.jsx`

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Import da tela e ícone**

No topo de `src/App.jsx`, após `import CaixasScreen from "./screens/CaixasScreen";` adicionar:

```js
import SalasScreen from "./screens/SalasScreen";
```

E adicionar `DoorOpen` à lista de ícones importada de `lucide-react` (localizar o import existente de ícones e incluir `DoorOpen`).

- [ ] **Step 2: Estado de abertura**

Junto aos outros `useState` (perto de `const [showCaixaQr, setShowCaixaQr] = useState(false);`), adicionar:

```js
  const [showSalas, setShowSalas] = useState(false);
```

- [ ] **Step 3: Botão flutuante "Salas"**

No bloco dos botões flutuantes, a condição de visibilidade que hoje é:

```jsx
      {!openItem && !showNew && !showFotoQr && !showCaixaQr && (
```
passa a incluir `&& !showSalas`:
```jsx
      {!openItem && !showNew && !showFotoQr && !showCaixaQr && !showSalas && (
```

E, dentro da fileira de botões (antes do botão "Caixa QR"), adicionar:

```jsx
            <button onClick={() => setShowSalas(true)} aria-label="Salas"
              className="pointer-events-auto h-12 rounded-full bg-gray-900 text-white shadow-lg flex items-center gap-1.5 pl-3.5 pr-4 text-sm font-semibold active:bg-gray-800">
              <DoorOpen className="w-5 h-5" /> Salas
            </button>
```

- [ ] **Step 4: Render da tela**

Após o bloco `{showCaixaQr && (<CaixasScreen ... />)}`, adicionar:

```jsx
      {showSalas && (
        <SalasScreen
          params={params} user={user}
          onClose={() => setShowSalas(false)}
          onOpenItem={(it) => { setShowSalas(false); setOpenItem(it); }}
        />
      )}
```

- [ ] **Step 5: Lint + build**

Run: `npm run lint && npm run build`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx
git commit -m "feat(salas): botão flutuante Salas abre a tela de salas"
```

---

## Task 11: `ItemDetail` — sala do item solto

Para item **solto** (sem caixa), permitir escolher a sala; para item **em caixa**, mostrar a sala herdada (read-only).

**Files:**
- Modify: `src/screens/ItemDetail.jsx`

- [ ] **Step 1: Imports**

Adicionar no topo:

```js
import { listarSalas, alocarItemNaSala } from "../lib/salas";
import { salaLabelTexto } from "../lib/salasFormat";
```

- [ ] **Step 2: Estado**

Junto aos demais `useState` do componente `ItemDetail`, adicionar:

```js
  const [salas, setSalas] = useState([]);
  const [salaMsg, setSalaMsg] = useState(null);
  useEffect(() => { listarSalas().then(setSalas).catch(() => setSalas([])); }, []);
```

- [ ] **Step 3: Handler de alocação (item solto)**

Adicionar dentro do componente (`user` já é prop de `ItemDetail`). Para item solto `alocarItemNaSala` nunca retorna `precisaConfirmar` (o item não tem caixa):

```js
  const escolherSala = async (salaId) => {
    setSalaMsg(null);
    try {
      await alocarItemNaSala(it.sku, salaId || null, user);
      setSalaMsg("Sala atualizada.");
      onSaved?.();
    } catch (e) { setSalaMsg(e.message || String(e)); }
  };
```

- [ ] **Step 4: UI — no card de caixa/localização**

Localizar o bloco `{it.caixa_id && ( ... )}` (por volta da linha 558) que mostra a caixa e o destino/local herdados. **Após** esse bloco, adicionar o seletor de sala para item solto e a exibição read-only para item encaixotado:

```jsx
        {!it.caixa_id ? (
          <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Sala (item solto)</p>
            <select value={it.sala_id || ""} onChange={(e) => escolherSala(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-500">
              <option value="">— sem sala —</option>
              {salas.map((s) => <option key={s.codigo} value={s.codigo}>{salaLabelTexto(s)}</option>)}
              {it.sala_id && !salas.some((s) => s.codigo === it.sala_id) && (
                <option value={it.sala_id}>{it.sala_id} (inativa)</option>
              )}
            </select>
            {salaMsg && <p className="text-xs text-gray-500">{salaMsg}</p>}
          </div>
        ) : (
          it.sala_id && (
            <p className="text-xs text-gray-500">Sala: <b>{it.sala_id}</b> <span className="text-gray-400">(via caixa {it.caixa_id})</span></p>
          )
        )}
```

> `it` deve refletir `sala_id`. Se o objeto local do item não recarrega após `onSaved`, o `<select value>` pode não atualizar até reabrir. Aceitável para v1; se `ItemDetail` já recarrega o item via `onSaved`/refetch, o valor acompanha.

- [ ] **Step 5: Etiqueta do item — passar a sala (se solto)**

Onde `ItemDetail` monta a etiqueta (`buildProductLabel(it)`, ~linha 1085), passar a sala resolvida:

```jsx
            labels={[buildProductLabel(it, salas.find((s) => s.codigo === it.sala_id) || null)]}
```

- [ ] **Step 6: Lint + build**

Run: `npm run lint && npm run build`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add src/screens/ItemDetail.jsx
git commit -m "feat(salas): ItemDetail permite sala em item solto e mostra sala herdada"
```

---

## Task 12: Dashboard — atalho "caixas sem sala"

**Files:**
- Modify: `src/screens/Dashboard.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: `App.jsx` — passar `onOpenSalas` ao Dashboard**

Em `src/App.jsx`, a linha:

```jsx
      {tab === "painel" && <Dashboard lotes={lotes} onGoFiltered={goFiltered} refreshKey={refreshKey} />}
```
vira:
```jsx
      {tab === "painel" && <Dashboard lotes={lotes} onGoFiltered={goFiltered} refreshKey={refreshKey} onOpenSalas={() => setShowSalas(true)} />}
```

- [ ] **Step 2: `Dashboard.jsx` — assinatura, ícone e estado**

Na assinatura do componente, adicionar a prop `onOpenSalas`:
```jsx
export default function Dashboard({ lotes, onGoFiltered, refreshKey, onOpenSalas }) {
```
Adicionar `DoorOpen` ao import de `lucide-react` (a linha que já importa `MapPin, Boxes, ...`).
Junto aos outros `useState`, adicionar:
```jsx
  const [semSala, setSemSala] = useState(0);
```

- [ ] **Step 3: Contar caixas sem sala no `Promise.all` de apoio**

No `useEffect` de "Views de apoio do painel" (linhas ~99–115), alterar o `Promise.all` e os setters:

```jsx
      const [t, p, f, c, ss] = await Promise.all([
        supabase.from("vw_throughput_dia").select("*").order("dia"),
        supabase.from("vw_produtividade_dia").select("*"),
        supabase.from("vw_precificacao_resumo").select("*").maybeSingle(),
        supabase.from("vw_caixas_abertas").select("*").order("criado_em"),
        supabase.from("caixas").select("codigo", { count: "exact", head: true }).is("sala_id", null),
      ]);
      if (cancel) return;
      setThroughput(t.data || []);
      setProd(p.data || []);
      setFin(f.data || null);
      setCaixas(c.data || []);
      setSemSala(ss.count || 0);
```

E no `.catch` do final, adicionar `setSemSala(0);` junto aos outros resets.

- [ ] **Step 4: `QueueRow` de atalho**

No bloco de filas/atalhos (onde estão os `QueueRow`, ~linha 216–227), adicionar, condicionado a `semSala > 0` e `onOpenSalas`:

```jsx
            {semSala > 0 && (
              <QueueRow icon={DoorOpen} color="bg-indigo-100 text-indigo-700" n={semSala}
                label="caixas sem sala" hint="Alocar as caixas numa sala" onClick={() => onOpenSalas?.()} />
            )}
```

> Se `QueueRow` já estiver dentro de um bloco condicionado por um total agregado (ex.: `(stats.pendMedida + ...) > 0`), colocar este novo `QueueRow` fora desse agregado (ou somar `semSala` ao total) para que apareça mesmo quando os outros contadores forem zero.

- [ ] **Step 5: Lint + build**

Run: `npm run lint && npm run build`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/screens/Dashboard.jsx src/App.jsx
git commit -m "feat(salas): Dashboard mostra e abre 'caixas sem sala'"
```

---

## Task 13: Verificação final (test + lint + build) e teste manual

**Files:** nenhum (verificação).

- [ ] **Step 1: Suíte de testes puros**

Run: `npm run test`
Expected: todos os blocos "asserções OK", incluindo `test:salas`.

- [ ] **Step 2: Lint + build final**

Run: `npm run lint && npm run build`
Expected: sem erros; build `✓ built`.

- [ ] **Step 3: Roteiro de teste manual (após migration aplicada)**

Verificar no app rodando (`npm run dev`):
1. Botão flutuante **Salas** → criar "Galpão A" → abre detalhe `SALA-001`.
2. **Imprimir etiqueta** da sala (QR + nome) e conferir o preview.
3. **Encher sala**: escanear/ digitar uma caixa `CX-00X` → aparece em "Caixas na sala"; escanear um item solto `NOG-...` → aparece em "Itens soltos".
4. Escanear um item **que está numa caixa** → banner com opção "Retirar da caixa … e dar entrada nesta sala" → confirmar → item vira solto na sala e some da caixa; histórico registra `item:sala · retirado de CX-00X` com o usuário.
5. Abrir uma **caixa** (botão Caixa QR) → escolher a sala no seletor → Registrar chegada → etiqueta da caixa mostra "Sala: SALA-001 · Galpão A"; itens da caixa herdam a sala.
6. **Item solto** em ItemDetail → escolher sala; item em caixa → mostra "Sala: … (via caixa …)".
7. Dashboard mostra a contagem de "caixas sem sala".

- [ ] **Step 4: Commit (se houver ajustes)**

```bash
git add -A
git commit -m "chore(salas): ajustes finais da verificação"
```

---

## Notas de execução

- **Ordem sugerida:** Tasks 1→6 (schema + libs + etiquetas) fecham a base; 7→8 restauram o build verde (as telas de caixa que usavam `local`); 9→12 adicionam a tela de salas e integrações; 13 fecha.
- **Build intermediário vermelho:** entre a Task 5 e a Task 8 o build fica quebrado de propósito (as telas ainda mandam `local`). Se preferir manter verde a cada commit, faça 5→7→8 em sequência antes de rodar builds.
- **Migration:** só aplicar com aprovação de Pedro/Bárbara. As Tasks de código não dependem da aplicação para compilar, mas o teste manual (Task 13, Step 3) depende.
- **Decisão de navegação:** botão flutuante "Salas" (irmão de "Caixa QR"). Se a fileira ficar apertada no mobile, considerar mover "Salas" para dentro da `CaixasScreen` num segundo momento (fora do escopo agora).
