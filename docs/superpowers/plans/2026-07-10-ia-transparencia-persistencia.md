# Transparência e persistência do preenchimento por IA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o "Completar com IA" não-destrutivo (preenche só campos vazios, o resto vira sugestão), com um quadro durável "Análise da IA" por item (valores, diagnóstico, o que a IA não conseguiu) e marca "IA" por campo.

**Architecture:** Migration adiciona `itens.ia_analise jsonb`. A lógica de sugestões vira um módulo puro `iaAnalise.js` (testável) com a regra de "só vazios"; `ia.js` persiste o backfill + o snapshot numa escrita. `ItemDetail.jsx` reusa esses módulos, renderiza o card durável de `it.ia_analise` e mostra a marca "IA" por campo.

**Tech Stack:** React 18, Supabase JS, Tailwind, lucide-react. Testes: scripts `.mjs` com `node:assert` (só módulos puros — importar módulo que puxa `supabase.js` quebra em Node; por isso `iaAnalise.js` não importa `medidas.js`).

---

## File Structure

- Create: `supabase/migrations/20260710130000_itens_ia_analise.sql` — coluna nova.
- Create: `src/lib/iaAnalise.js` — puro: `construirSugestoes`, `separarSugestoes`, `patchVazios`, `montarAnalise`, `campoVazio`, `ALVO`.
- Create: `src/lib/ia.js` — `salvarAnaliseIA` (persistência).
- Modify: `src/screens/ItemDetail.jsx` — reusa os módulos; `enriquecer` não-destrutivo; card durável; marca "IA" por campo; `salvar` inclui `ia_analise`.
- Create: `scripts/test_iaanalise.mjs` — testa `iaAnalise.js`.
- Modify: `package.json` — inclui `test:iaanalise`.

---

## Task 1: Migration `itens.ia_analise`

**Files:**
- Create: `supabase/migrations/20260710130000_itens_ia_analise.sql`

- [ ] **Step 1: Escrever a migration**

Arquivo `supabase/migrations/20260710130000_itens_ia_analise.sql`:

```sql
-- Snapshot durável da última análise da IA por item (transparência/posterioridade).
alter table public.itens
  add column if not exists ia_analise jsonb;

comment on column public.itens.ia_analise is
  'Última análise do assistente de IA: { em, por, usou_foto, confianca, observacoes, campos_faltantes, sugestoes:[{k,label,val,patch}], aplicados:[k] }.';
```

- [ ] **Step 2: Aplicar a migration (requer aprovação Pedro/Bárbara)**

DDL — aplicar via MCP `apply_migration` (name: `itens_ia_analise`, query = conteúdo do arquivo) **somente após o ok**. Verificação após aplicar (MCP `execute_sql`):

```sql
select column_name, data_type from information_schema.columns
where table_schema='public' and table_name='itens' and column_name='ia_analise';
```
Esperado: 1 linha (`ia_analise`, `jsonb`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260710130000_itens_ia_analise.sql
git commit -m "feat(ia): migration itens.ia_analise (snapshot durável da análise)"
```

---

## Task 2: Módulo puro `iaAnalise.js` + teste + suíte

**Files:**
- Create: `src/lib/iaAnalise.js`
- Create: `scripts/test_iaanalise.mjs`
- Modify: `package.json`

- [ ] **Step 1: Escrever o teste que falha**

Arquivo `scripts/test_iaanalise.mjs`:

```javascript
// Testes das funções PURAS do assistente de IA (iaAnalise.js). Rode: npm run test:iaanalise
import assert from "node:assert/strict";
import { construirSugestoes, separarSugestoes, patchVazios, montarAnalise } from "../src/lib/iaAnalise.js";

let passou = 0;
const ok = (c, msg) => { assert.ok(c, msg); passou++; console.log(`  ok  ${msg}`); };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); passou++; console.log(`  ok  ${msg}`); };

const iaData = {
  titulo_anuncio: "Furadeira Bosch GSB 13 RE", descricao_anuncio: "Furadeira de impacto...",
  marca: "Bosch", modelo: "GSB 13 RE", grupo: null, ncm: null, voltagem: "220V", cor: null,
  dimensoes_estimadas: { comprimento_cm: 30, largura_cm: 8, altura_cm: 20, peso_kg: 1.8 },
  preco_ref_novo: 300, preco_ref_usado: 180, preco_ref_confianca: "MEDIA",
  pontos: ["potente", "com maleta"], palavras_chave: "furadeira, impacto",
  ficha_tecnica: [{ atributo: "Potência", valor: "750W" }],
  campos_faltantes: ["ncm", "cor"], observacoes: "Confirme a voltagem na etiqueta.", usou_foto: false,
};

console.log("construirSugestoes filtra nulos");
const sug = construirSugestoes(iaData, {});
ok(sug.some((s) => s.k === "titulo_anuncio"), "inclui título");
ok(!sug.some((s) => s.k === "grupo"), "exclui grupo (null)");
ok(!sug.some((s) => s.k === "cor"), "exclui cor (null)");

console.log("separarSugestoes é não-destrutivo");
const item = {
  titulo_anuncio: "Meu título manual", marca: "", modelo: null, voltagem: null,
  comprimento_cm: null, largura_cm: null, altura_cm: null, peso_real_kg: null,
  preco_ref_novo: null, preco_ref_usado: null, bullet_points: null, palavras_chave: "", ncm: null,
};
const { vazias, preenchidas } = separarSugestoes(sug, item);
ok(preenchidas.some((s) => s.k === "titulo_anuncio"), "título já preenchido vira sugestão manual");
ok(vazias.some((s) => s.k === "marca"), "marca vazia é auto-aplicável");
ok(vazias.some((s) => s.k === "dimensoes"), "dimensões todas vazias são auto-aplicáveis");

console.log("dimensões parcialmente preenchidas não são auto");
const sep2 = separarSugestoes(sug, { ...item, altura_cm: 10 });
ok(sep2.preenchidas.some((s) => s.k === "dimensoes"), "com uma dimensão preenchida, vira sugestão");

console.log("patchVazios mescla só as vazias");
const patch = patchVazios(vazias);
eq(patch.marca, "Bosch", "patch aplica marca");
ok(!("titulo_anuncio" in patch), "patch não inclui o título já preenchido");

console.log("montarAnalise monta o snapshot durável");
const analise = montarAnalise(iaData, sug, vazias.map((s) => s.k), { em: "2026-07-10T00:00:00Z", por: "eu@x" });
eq(analise.campos_faltantes, ["ncm", "cor"], "guarda campos_faltantes");
eq(analise.observacoes, "Confirme a voltagem na etiqueta.", "guarda o diagnóstico");
ok(analise.sugestoes.every((s) => "k" in s && "label" in s && "val" in s && "patch" in s), "sugestoes guardam {k,label,val,patch}");
ok(analise.aplicados.includes("marca"), "aplicados inclui marca");

console.log(`\n${passou} asserções OK`);
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `node scripts/test_iaanalise.mjs`
Esperado: FALHA (`Cannot find module '../src/lib/iaAnalise.js'`).

- [ ] **Step 3: Implementar o módulo puro**

Arquivo `src/lib/iaAnalise.js`:

```javascript
// Lógica pura do assistente de IA (sem Supabase, testável no Node). Constrói as
// sugestões campo-a-campo do retorno da edge function enriquecer-produto, separa o
// que pode ser preenchido automaticamente (campos vazios) do que já tem valor humano
// (sugestão manual) e monta o snapshot durável `ia_analise`.
import { fmtBRL } from "./model";

// Espelha MEDIDAS_FONTE.ESTIMADO sem importar medidas.js (que puxa supabase e
// quebraria os testes puros no Node).
const FONTE_ESTIMADO = "ESTIMADO";

export const campoVazio = (v) =>
  v == null || v === "" || (Array.isArray(v) && v.length === 0);

// k → colunas do item que representam o campo (para decidir se está "vazio").
export const ALVO = {
  titulo_anuncio: ["titulo_anuncio"],
  descricao_anuncio: ["descricao_anuncio"],
  marca: ["marca"],
  modelo: ["modelo"],
  grupo: ["grupo"],
  ncm: ["ncm"],
  voltagem: ["voltagem"],
  cor: ["cor"],
  dimensoes: ["comprimento_cm", "largura_cm", "altura_cm", "peso_real_kg"],
  preco: ["preco_ref_novo", "preco_ref_usado"],
  preco_ideal: ["preco_ideal"],
  bullet_points: ["bullet_points"],
  palavras_chave: ["palavras_chave"],
  ficha_tecnica: ["ficha_tecnica"],
};

// Constrói as sugestões aplicáveis a partir do retorno da IA (campo a campo).
export function construirSugestoes(iaData, item) {
  if (!iaData) return [];
  const d = iaData.dimensoes_estimadas || {};
  const temDim = [d.comprimento_cm, d.largura_cm, d.altura_cm, d.peso_kg].some((v) => v != null);
  const lista = [
    { k: "titulo_anuncio", label: "Título", val: iaData.titulo_anuncio, patch: { titulo_anuncio: iaData.titulo_anuncio } },
    { k: "descricao_anuncio", label: "Descrição", val: iaData.descricao_anuncio, patch: { descricao_anuncio: iaData.descricao_anuncio } },
    { k: "marca", label: "Marca", val: iaData.marca, patch: { marca: iaData.marca } },
    { k: "modelo", label: "Modelo", val: iaData.modelo, patch: { modelo: iaData.modelo } },
    { k: "grupo", label: "Categoria", val: iaData.grupo, patch: { grupo: iaData.grupo } },
    { k: "ncm", label: "NCM", val: iaData.ncm, patch: { ncm: iaData.ncm } },
    { k: "voltagem", label: "Voltagem", val: iaData.voltagem, patch: { voltagem: iaData.voltagem } },
    { k: "cor", label: "Cor", val: iaData.cor, patch: { cor: iaData.cor } },
    temDim && {
      k: "dimensoes", label: "Dimensões (C×L×A, peso)",
      val: `${d.comprimento_cm ?? "–"}×${d.largura_cm ?? "–"}×${d.altura_cm ?? "–"} cm · ${d.peso_kg ?? "–"} kg`,
      patch: {
        comprimento_cm: d.comprimento_cm ?? item.comprimento_cm, largura_cm: d.largura_cm ?? item.largura_cm,
        altura_cm: d.altura_cm ?? item.altura_cm, peso_real_kg: d.peso_kg ?? item.peso_real_kg,
        medidas_fonte: FONTE_ESTIMADO,
      },
    },
    (iaData.preco_ref_novo != null || iaData.preco_ref_usado != null) && {
      k: "preco", label: `Preço ref. (IA · ${iaData.preco_ref_confianca || "—"})`,
      val: `Novo ${fmtBRL(iaData.preco_ref_novo)} · Usado ${fmtBRL(iaData.preco_ref_usado)}`,
      patch: {
        preco_ref_novo: iaData.preco_ref_novo, preco_ref_usado: iaData.preco_ref_usado,
        preco_ref_confianca: iaData.preco_ref_confianca, preco_ref_fonte: "IA:claude",
      },
    },
    Array.isArray(iaData.pontos) && iaData.pontos.length > 0 && {
      k: "bullet_points", label: "Bullets (anúncio)", val: iaData.pontos.join(" · "),
      patch: { bullet_points: iaData.pontos },
    },
    iaData.palavras_chave && {
      k: "palavras_chave", label: "Palavras-chave", val: iaData.palavras_chave,
      patch: { palavras_chave: iaData.palavras_chave },
    },
    Array.isArray(iaData.ficha_tecnica) && iaData.ficha_tecnica.length > 0 && {
      k: "ficha_tecnica", label: "Ficha técnica",
      val: iaData.ficha_tecnica.map((f) => `${f.atributo}: ${f.valor}`).join(" · "),
      patch: { ficha_tecnica: iaData.ficha_tecnica },
    },
  ];
  return lista.filter((s) => s && s.val != null && s.val !== "");
}

// Uma sugestão é "vazia" (auto-aplicável) se TODAS as colunas-alvo estão vazias no item.
export function sugestaoVazia(sug, item) {
  const cols = ALVO[sug.k] || [sug.k];
  return cols.every((c) => campoVazio(item[c]));
}

// Separa as sugestões em vazias (auto) e preenchidas (já têm valor humano → manual).
export function separarSugestoes(sugestoes, item) {
  const vazias = [], preenchidas = [];
  for (const s of sugestoes) (sugestaoVazia(s, item) ? vazias : preenchidas).push(s);
  return { vazias, preenchidas };
}

// Mescla os patches das sugestões passadas num único patch.
export function patchVazios(vazias) {
  return Object.assign({}, ...vazias.map((s) => s.patch));
}

// Monta o snapshot durável ia_analise. `sugestoes` guarda {k,label,val,patch} para
// permitir aplicar as pendentes mesmo após recarregar.
export function montarAnalise(iaData, sugestoes, aplicados, { em, por }) {
  return {
    em, por,
    usou_foto: !!iaData.usou_foto,
    confianca: iaData.preco_ref_confianca || null,
    observacoes: iaData.observacoes || null,
    campos_faltantes: Array.isArray(iaData.campos_faltantes) ? iaData.campos_faltantes : [],
    sugestoes: sugestoes.map((s) => ({ k: s.k, label: s.label, val: s.val, patch: s.patch })),
    aplicados: [...aplicados],
  };
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `node scripts/test_iaanalise.mjs`
Esperado: `13 asserções OK`.

- [ ] **Step 5: Registrar na suíte**

Em `package.json`, adicionar (após `"test:catalogar": ...`):

```json
    "test:iaanalise": "node scripts/test_iaanalise.mjs",
```
e acrescentar ` && npm run test:iaanalise` ao final do valor do script `test`.

- [ ] **Step 6: Rodar a suíte**

Run: `npm test`
Esperado: todos passam, incluindo `13 asserções OK` do `test:iaanalise`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/iaAnalise.js scripts/test_iaanalise.mjs package.json
git commit -m "feat(ia): módulo puro iaAnalise (sugestões, só-vazios, snapshot) + testes"
```

---

## Task 3: Persistência `salvarAnaliseIA` (`src/lib/ia.js`)

**Files:**
- Create: `src/lib/ia.js`

- [ ] **Step 1: Implementar**

Arquivo `src/lib/ia.js`:

```javascript
// Persistência do assistente de IA: grava o backfill (campos vazios) + o snapshot
// durável ia_analise numa única escrita, com auditoria best-effort.
import { supabase } from "./supabase";

export async function salvarAnaliseIA(sku, patch, iaAnalise, user) {
  const { data, error } = await supabase.from("itens")
    .update({ ...patch, ia_analise: iaAnalise, upd_by: user?.email })
    .eq("sku", sku).select().single();
  if (error) throw error;
  try {
    await supabase.from("eventos").insert({
      sku, acao: "ia:enriquecido",
      detalhe: `${(iaAnalise.aplicados || []).length} campo(s) · confiança ${iaAnalise.confianca || "—"}`,
      usuario: user?.email,
    });
  } catch { /* auditoria best-effort */ }
  return data;
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Esperado: sem erros novos em `src/lib/ia.js`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ia.js
git commit -m "feat(ia): salvarAnaliseIA (backfill + snapshot numa escrita + auditoria)"
```

---

## Task 4: `ItemDetail` — enriquecer não-destrutivo + card durável

**Files:**
- Modify: `src/screens/ItemDetail.jsx`

- [ ] **Step 1: Imports dos novos módulos**

Em `src/screens/ItemDetail.jsx`, logo abaixo de `import { derivarPreco } from "../lib/precoView";`, adicionar:

```javascript
import { construirSugestoes, separarSugestoes, patchVazios, montarAnalise } from "../lib/iaAnalise";
import { salvarAnaliseIA } from "../lib/ia";
```

- [ ] **Step 2: Remover a lógica local de sugestões**

Remover, em `src/screens/ItemDetail.jsx`, o bloco do comentário
`// Constrói as sugestões aplicáveis a partir do retorno da IA (campo a campo).`
até o fim da função local `const construirSugestoes = (iaData, item) => { ... };` (o `};` que fecha, antes do comentário `// Junta os patches...`), E o bloco:

```javascript
  // Junta os patches de todas as sugestões num único patch e sinaliza "completado via IA"
  // (marcador durável = mesmo do selo/filtro na tela de Itens).
  const patchTodasIA = (sugestoes) =>
    Object.assign({}, ...sugestoes.map((s) => s.patch), { preco_ref_fonte: "IA:claude" });
```
(As versões importadas de `iaAnalise.js` substituem essas locais.)

- [ ] **Step 3: Remover o estado `ia` e derivados**

Em `src/screens/ItemDetail.jsx`, remover a linha do estado `ia`:

```javascript
  const [ia, setIa] = useState(null); // sugestões da IA (enriquecer-produto)
```
E remover as linhas:

```javascript
  // Sugestões do retorno atual (revisão/reaplicação). O fill já aconteceu em `enriquecer`.
  const sugestoesIA = construirSugestoes(ia, it);
  const aplicarTodasIA = () => { if (sugestoesIA.length) set(patchTodasIA(sugestoesIA)); };
```

- [ ] **Step 4: Reescrever o sucesso do `enriquecer`**

Em `src/screens/ItemDetail.jsx`, dentro de `enriquecer`, substituir o trecho:

```javascript
      setIa(data);
      setIaProgresso(100);
      // Fill automático: aplica todas as sugestões aos campos assim que a IA retorna.
      // (Continua editável; só persiste ao Salvar/Avançar.) A lista de sugestões abaixo
      // permanece para revisão e reaplicação campo a campo.
      const sugeridas = construirSugestoes(data, it);
      if (sugeridas.length) {
        const patch = patchTodasIA(sugeridas);
        // Preço ideal: a IA entrega só REFERÊNCIAS (preco_ref_novo/usado). Derivamos o
        // recomendado (mesmo motor do PricingCard) a partir das novas refs e gravamos em
        // preco_ideal — assim a pesquisa altera o valor de venda, não só os dados do anúncio.
        // (titulo_anuncio já vem sobrescrito no patch; só o anúncio muda, não o nome interno.)
        const grupo = params.grupos?.[(patch.grupo ?? it.grupo)] || {};
        const d = derivarPreco({ ...it, ...patch }, grupo, params, custoItem);
        if (d.recomendado > 0) patch.preco_ideal = d.recomendado;
        set(patch);
      }
```
por:

```javascript
      setIaProgresso(100);
      // Sugestões campo a campo + preço ideal derivado das novas referências.
      const sugeridas = construirSugestoes(data, it);
      const grupoBase = params.grupos?.[(data.grupo ?? it.grupo)] || {};
      const dp = derivarPreco(
        { ...it, preco_ref_novo: data.preco_ref_novo ?? it.preco_ref_novo, preco_ref_usado: data.preco_ref_usado ?? it.preco_ref_usado },
        grupoBase, params, custoItem
      );
      if (dp.recomendado > 0) {
        sugeridas.push({ k: "preco_ideal", label: "Preço ideal (recomendado)", val: fmtBRL(dp.recomendado), patch: { preco_ideal: dp.recomendado } });
      }
      // Não-destrutivo: auto-aplica só os campos vazios; o resto fica como sugestão.
      const { vazias } = separarSugestoes(sugeridas, it);
      const patch = patchVazios(vazias);
      const aplicados = vazias.map((s) => s.k);
      const iaAnalise = montarAnalise(data, sugeridas, aplicados, { em: new Date().toISOString(), por: user.email });
      // Persiste o backfill dos vazios + o quadro durável numa escrita; atualiza a ficha.
      const linha = await salvarAnaliseIA(it.sku, patch, iaAnalise, user);
      setIt(linha);
      dirty.current = false;
      onSaved(linha);
```

- [ ] **Step 5: `jaIA` a partir do snapshot durável**

Em `src/screens/ItemDetail.jsx`, substituir:

```javascript
  // Item já completado via IA (marcador durável). Desabilita os botões salvo "refazer".
  const jaIA = it.preco_ref_fonte === "IA:claude";
```
por:

```javascript
  // Item já analisado pela IA (snapshot durável). Desabilita os botões salvo "refazer".
  const jaIA = !!it.ia_analise;
  const iaFez = (k) => !!it.ia_analise?.aplicados?.includes(k);
  const aplicarSugestao = (s) => {
    set(s.patch);
    setIt((p) => (p.ia_analise
      ? { ...p, ia_analise: { ...p.ia_analise, aplicados: [...new Set([...(p.ia_analise.aplicados || []), s.k])] } }
      : p));
  };
```

- [ ] **Step 6: Card durável "Análise da IA"**

Em `src/screens/ItemDetail.jsx`, substituir o bloco atual de renderização das sugestões:

```jsx
          {ia && sugestoesIA.length > 0 && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Campos preenchidos {ia.usou_foto ? "(com foto)" : ""}
                </span>
                <button onClick={aplicarTodasIA} className="text-xs font-semibold text-violet-700">Reaplicar tudo</button>
              </div>
              <div className="space-y-1.5">
                {sugestoesIA.map((s) => (
                  <div key={s.k} className="flex items-start gap-2 text-sm">
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] uppercase tracking-wide text-gray-400">{s.label}</span>
                      <p className="text-gray-800 leading-snug break-words">{s.val}</p>
                    </div>
                    <button onClick={() => set(s.patch)}
                      className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-violet-700 border border-violet-200 rounded-lg px-2 py-1 active:bg-violet-50">
                      <Check className="w-3 h-3" /> Reaplicar
                    </button>
                  </div>
                ))}
              </div>
              {ia.observacoes && <p className="text-xs text-gray-500 mt-2 leading-snug"><b>Diagnóstico:</b> {ia.observacoes}</p>}
            </div>
          )}
```
por:

```jsx
          {it.ia_analise && (() => {
            const a = it.ia_analise;
            const aplicados = a.aplicados || [];
            const sugestoes = a.sugestoes || [];
            const preenchidos = sugestoes.filter((s) => aplicados.includes(s.k));
            const pendentes = sugestoes.filter((s) => !aplicados.includes(s.k));
            return (
              <div className="mt-3 border-t border-gray-100 pt-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700">
                    <Sparkles className="w-3.5 h-3.5" /> Análise da IA{a.usou_foto ? " (com foto)" : ""}
                  </span>
                  <span className="text-[11px] text-gray-400">
                    {a.em ? new Date(a.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : ""}
                    {a.confianca ? ` · ${a.confianca}` : ""}
                  </span>
                </div>

                {preenchidos.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 mb-1 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Preenchidos pela IA
                    </p>
                    <div className="space-y-1">
                      {preenchidos.map((s) => (
                        <div key={s.k} className="text-sm">
                          <span className="text-[11px] uppercase tracking-wide text-gray-400">{s.label}</span>
                          <p className="text-gray-800 leading-snug break-words">{s.val}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {pendentes.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 mb-1">Sugestões (revisar — você já tinha valor)</p>
                    <div className="space-y-1.5">
                      {pendentes.map((s) => (
                        <div key={s.k} className="flex items-start gap-2 text-sm">
                          <div className="flex-1 min-w-0">
                            <span className="text-[11px] uppercase tracking-wide text-gray-400">{s.label}</span>
                            <p className="text-gray-800 leading-snug break-words">{s.val}</p>
                          </div>
                          {s.patch && (
                            <button onClick={() => aplicarSugestao(s)}
                              className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-violet-700 border border-violet-200 rounded-lg px-2 py-1 active:bg-violet-50">
                              <Check className="w-3 h-3" /> Aplicar
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {a.campos_faltantes?.length > 0 && (
                  <p className="text-xs text-gray-600 leading-snug">
                    <b className="text-gray-700">A IA não conseguiu:</b> {a.campos_faltantes.join(", ")}
                  </p>
                )}
                {a.observacoes && <p className="text-xs text-gray-500 leading-snug"><b>Dica:</b> {a.observacoes}</p>}
              </div>
            );
          })()}
```

- [ ] **Step 7: `salvar` persiste `ia_analise` atualizado**

Em `src/screens/ItemDetail.jsx`, na montagem do `patch` dentro de `salvar` (o objeto que termina com `upd_by: user.email,` e os spreads de status), adicionar a linha, logo antes de `upd_by: user.email,`:

```javascript
      ia_analise: it.ia_analise ?? null,
```

- [ ] **Step 8: Lint + build**

Run: `npm run lint && npm run build`
Esperado: sem erros (nenhuma referência remanescente a `ia`, `setIa`, `sugestoesIA`, `aplicarTodasIA`, `patchTodasIA`); build conclui.

- [ ] **Step 9: Commit**

```bash
git add src/screens/ItemDetail.jsx
git commit -m "feat(ia): enriquecer não-destrutivo + card durável 'Análise da IA'"
```

---

## Task 5: Marca "IA" por campo (`ItemDetail`)

**Files:**
- Modify: `src/screens/ItemDetail.jsx`

- [ ] **Step 1: Componente `IaTag`**

Em `src/screens/ItemDetail.jsx`, logo após o componente `function TriToggle(...) { ... }` (perto do topo do arquivo), adicionar:

```jsx
// Marquinha "IA" para rotular um campo preenchido pela IA (usa iaFez(k) do ItemDetail).
function IaTag({ on }) {
  if (!on) return null;
  return (
    <span title="Preenchido pela IA" className="ml-1 inline-flex items-center gap-0.5 align-middle px-1 py-0.5 rounded text-[9px] font-bold bg-violet-100 text-violet-700">
      <Sparkles className="w-2.5 h-2.5" /> IA
    </span>
  );
}
```

- [ ] **Step 2: Inserir a marca nos rótulos dos campos cobertos**

Para cada par `(k, texto do rótulo)` abaixo, localizar no formulário o elemento que renderiza o rótulo daquele campo (um `<label>`, `<span>` ou heading contendo exatamente o texto) e inserir `<IaTag on={iaFez("<k>")} />` imediatamente após o texto do rótulo, dentro do mesmo elemento:

| k | texto do rótulo a localizar |
|---|---|
| `titulo_anuncio` | Título do anúncio |
| `descricao_anuncio` | Descrição |
| `marca` | Marca |
| `modelo` | Modelo |
| `grupo` | Categoria |
| `ncm` | NCM |
| `voltagem` | Voltagem |
| `cor` | Cor |
| `dimensoes` | Dimensões |
| `preco` | Preço de referência |
| `preco_ideal` | Preço ideal |

Exemplo (para o rótulo "Marca"):

```jsx
<label className="...">Marca<IaTag on={iaFez("marca")} /></label>
```

Regra: se algum rótulo não existir exatamente com esse texto no arquivo, pular esse campo (não inventar rótulo) e seguir para o próximo — o card "Análise da IA" já garante a transparência mesmo sem a marca naquele campo.

- [ ] **Step 3: Lint + build**

Run: `npm run lint && npm run build`
Esperado: sem erros; build conclui.

- [ ] **Step 4: Commit**

```bash
git add src/screens/ItemDetail.jsx
git commit -m "feat(ia): marca 'IA' nos campos preenchidos pela IA"
```

---

## Verificação manual (após aplicar a migration)

1. `npm run dev`, abrir a ficha de um item com campos vazios → **Completar com IA**.
2. Só os campos vazios são preenchidos e salvos na hora; aparece o card **"Análise da IA"** com: Preenchidos pela IA, A IA não conseguiu (campos_faltantes) e Dica (observações).
3. Num item que já tinha, por ex., Título → o Título **não** é sobrescrito; aparece em "Sugestões (revisar)" com **Aplicar**.
4. Campos preenchidos pela IA mostram a marca **"IA"** no rótulo.
5. **Recarregar** (botão Atualizar) ou reabrir o item: o card "Análise da IA" e as marcas continuam lá (persistidos em `itens.ia_analise`).
6. Aba **Registro**: evento `ia:enriquecido` com o resumo.

---

## Self-Review

- **Cobertura do spec:** schema (Task 1), lib pura + testes (Task 2), persistência (Task 3), enriquecer não-destrutivo + card durável + salvar (Task 4), marca por campo (Task 5). Todos os itens do spec têm task.
- **Placeholders:** nenhum — todo passo tem código/comando. A Task 5 usa busca por texto de rótulo (o arquivo é grande); a regra de "pular se não achar" evita invenção.
- **Consistência de nomes:** `construirSugestoes/separarSugestoes/patchVazios/montarAnalise` (Task 2) usados no `enriquecer` (Task 4); `salvarAnaliseIA` (Task 3) idem; `it.ia_analise`/`aplicados`/`iaFez`/`aplicarSugestao`/`IaTag` consistentes (Tasks 4-5). `jaIA` passa a `!!it.ia_analise`.
- **Nota de teste:** só `iaAnalise.js` (puro) tem teste automatizado; `salvarAnaliseIA` e a UI são validados na verificação manual, consistente com o repo.
