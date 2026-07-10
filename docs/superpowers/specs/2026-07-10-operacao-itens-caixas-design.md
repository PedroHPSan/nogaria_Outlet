# Melhorias de operação: catalogar por lote, reabrir caixa e visibilidade de caixa

**Data:** 2026-07-10
**Contexto:** Três melhorias de operação pedidas para dar mais fluidez ao dia a dia:
(1) filtrar itens "A Catalogar" por lote específico com menos toques; (2) reabrir uma
caixa fechada para incluir mais itens e fechar de novo; (3) enxergar melhor em qual
caixa cada item está. Nenhuma exige mudança de schema — tudo reaproveita colunas e
funções já existentes.

## Objetivos

1. **Catalogar por lote (`ItemsScreen`):** acesso rápido a um seletor de lotes com a
   contagem de itens `status=A_CATALOGAR` em cada um; escolher um lote aplica o filtro
   `status=A_CATALOGAR` + `lote`.
2. **Reabrir caixa (`ConferenciaScreen` → Encaixotar):** botão "Reabrir" nas caixas
   fechadas, que reabre e já entra no fluxo de encaixotar (escanear itens) e fechar.
3. **Visibilidade de caixa:** mostrar a caixa do item na ficha (`ItemDetail`) e permitir
   filtrar a lista de itens por caixa; o selo da lista passa a mostrar também o local.

Fora de escopo: navegação da ficha do item para a tela da caixa (o cartão da caixa em
`ItemDetail` é informativo); agrupar itens por caixa na lista; qualquer migration.

## Estado atual (relevante)

- `itens`: colunas `status` (enum `item_status`, inclui `A_CATALOGAR`), `lote`,
  `caixa_id` (FK→`caixas.codigo`), `local_fisico`, `destino`.
- `ItemsScreen` já tem filtros de `lote` e `status` (dentro de um painel recolhível) e
  já exibe um selo com `it.caixa_id` na linha do item. Busca paginada (`PAGE=50`).
- `ConferenciaScreen` → `Encaixotar` cria/abre/escaneia/fecha caixas. As caixas
  **fechadas** aparecem em `CaixaFechadaItem` como **consulta somente-leitura**. A lib
  `lib/caixas.js` já expõe `reabrirCaixa(codigo, user)` (sem UI hoje).
- `ItemDetail` **não** mostra em qual caixa (`caixa_id`) o item está. `lib/caixas.js`
  expõe `buscarCaixa(codigo)`.
- Padrão de testes: só módulos **puros** (sem importar `supabase.js`, que quebra no
  Node). Ex.: `caixasFormat.js` + `scripts/test_caixas.mjs`.

## 1. Catalogar por lote (`ItemsScreen`)

**Dados (contagem por lote):** o cliente Supabase não agrupa direto; fazemos a contagem
no cliente, paginando a coluna `lote` dos itens `A_CATALOGAR` (padrão de
`classificarSemClasse`, páginas de 1000).

- Novo módulo **puro** `src/lib/catalogarStats.js`:
  - `tallyPorLote(rows)` — recebe `[{lote}]`, devolve `[{lote, count}]` agrupado por
    `lote` (null vira `null`), ordenado por `count` desc e, empatando, por `lote` asc
    (nulls por último).
- Em `src/lib/conferencia.js` (já ligado ao Supabase): `contarACatalogarPorLote()` —
  pagina `select("lote").eq("status","A_CATALOGAR")` e retorna `tallyPorLote(rows)`.

**UI:**
- Botão **"Catalogar"** (ícone `ClipboardList`) na barra de ações do topo, ao lado de
  "Caixa/Mala".
- Componente `CatalogarPorLote({ lotes, onPick, onClose })` (no próprio `ItemsScreen.jsx`,
  espelhando `BoxPicker`): carrega `contarACatalogarPorLote()`, mostra o total e a lista
  "Lote X — <referência> · N itens" (referência vinda da prop `lotes`) + "Sem lote (N)".
  Tocar num lote chama `onPick(loteValue)` — `loteValue` é `String(lote)` ou `LOTE_SEM`
  para itens sem lote.
- `onPick` no `ItemsScreen`: `setFStatus("A_CATALOGAR"); setFLote(loteValue);
  setShowFilters(true); setCatalogarPicker(false);` (o `useEffect` de filtros já
  dispara a busca).

## 2. Reabrir caixa (`ConferenciaScreen` → Encaixotar)

- Importar `reabrirCaixa` de `lib/caixas`.
- No componente pai `Encaixotar`, novo handler:
  ```
  const reabrir = async (c) => {
    if (!window.confirm(`Reabrir a caixa ${c.codigo} para incluir itens?`)) return;
    await reabrirCaixa(c.codigo, user);
    onChanged?.();
    await loadAbertas();
    await abrirCaixa({ ...c, status: CAIXA_STATUS.ABERTA });
  };
  ```
  Reabre, recarrega as listas abertas/fechadas e **entra na caixa ativa** para escanear
  itens; o botão "Fechar caixa" já existente fecha de novo.
- `CaixaFechadaItem` recebe uma prop `onReabrir` e ganha um botão **"Reabrir"** (ícone
  `RotateCcw`/`Unlock`) na sua linha (ao lado das ações de expandir/imprimir), que chama
  `onReabrir(caixa)`. A renderização das fechadas passa `onReabrir={reabrir}`.

## 3. Visibilidade de "qual caixa o item está"

**`ItemDetail` — cartão informativo da caixa:**
- Importar `buscarCaixa` de `lib/caixas` (+ ícone `Package`, `CAIXA_STATUS` de
  `lib/caixas`).
- Estado `caixaInfo` + `useEffect` que, quando `it.caixa_id` muda, faz
  `buscarCaixa(it.caixa_id)` (best-effort; erro → não mostra).
- Renderizar, no topo da área rolável (antes do card "Assistente de IA"), **somente se
  `it.caixa_id`**: um cartão com o código, tipo (Caixa/Mala), destino, `local_fisico` e
  o status (badge **Aberta/Fechada**). Sem navegação — apenas informação.

**`ItemsScreen` — filtro por caixa + local no selo:**
- Estado `caixasList` carregado uma vez via `listarCaixas()` (todas).
- Novo filtro `fCaixa` (select) no painel: "Todas as caixas" + cada caixa
  (`código — destino/local`). Na query: `if (fCaixa) query = query.eq("caixa_id", fCaixa)`.
  Incluir `fCaixa` nas deps de `buscar`/`useEffect` e no cálculo de `nActive`.
- Na linha do item, quando `it.caixa_id`, acrescentar o `local_fisico` ao lado do
  código no selo/meta (ex.: `📦 CX-001 · Galpão A`); sem local, mantém só o código.

## Arquivos

- Create: `src/lib/catalogarStats.js` — `tallyPorLote` (puro).
- Modify: `src/lib/conferencia.js` — `contarACatalogarPorLote()`.
- Modify: `src/screens/ItemsScreen.jsx` — botão + modal `CatalogarPorLote`, filtro
  `fCaixa`, local no selo, carga de `caixasList`.
- Modify: `src/screens/ConferenciaScreen.jsx` — `reabrir` + botão "Reabrir" em
  `CaixaFechadaItem`.
- Modify: `src/screens/ItemDetail.jsx` — cartão informativo da caixa.
- Create: `scripts/test_catalogar.mjs` — testa `tallyPorLote`.
- Modify: `package.json` — inclui `test:catalogar` na suíte.

## Testes

`scripts/test_catalogar.mjs` cobre `tallyPorLote`: agrupamento por lote, contagem,
tratamento de `lote` nulo (bucket "sem lote") e ordenação (count desc, lote asc no
empate, nulls por último). As funções que tocam o Supabase seguem o padrão do repo
(sem teste unitário) e são validadas na verificação manual.

## Riscos / decisões

- Contagem por lote no cliente pagina todos os `A_CATALOGAR`; é leve (uma coluna
  inteira por linha) e segue o padrão já usado no backfill de classe. Sem migration.
- O cartão de caixa em `ItemDetail` faz uma busca extra (`buscarCaixa`) só quando o item
  está encaixotado — custo desprezível.
- Substituir/By-pass: nenhuma função existente muda de assinatura; tudo é adição.
