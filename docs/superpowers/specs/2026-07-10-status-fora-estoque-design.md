# VENDIDO/ENTREGUE/DESCARTE fora do estoque e das caixas

Data: 2026-07-10
Status: aprovado

## Problema

Itens com status VENDIDO e ENTREGUE já foram entregues aos clientes — não são
mais estoque e não estão fisicamente em caixas. Hoje eles ainda aparecem na
listagem geral (Itens), na Conferência e no conteúdo das caixas, poluindo as
visões operacionais. O catálogo público e o portfólio **já** os excluem.

## Decisão

Filtragem de **exibição/contagem** apenas. Nada é apagado; o `caixa_id`
permanece como histórico de onde o item esteve. O conjunto "fora do estoque
ativo" é `["VENDIDO", "ENTREGUE", "DESCARTE"]` — o mesmo já usado por catálogo e
portfólio. DESCARTE entra junto por decisão do usuário (consistência com as
visões de estoque vendável).

O Dashboard **não** é alterado (decisão do usuário): continua contando
VENDIDO/ENTREGUE nos totais, no valor vendido e no "a encaixotar" (`semCaixa`),
e o card de caixas abertas segue usando a view SQL `vw_caixas_abertas`.

## Mudanças

### 1. Fonte única — `src/lib/model.js`
- `export const STATUS_FORA_ESTOQUE = ["VENDIDO", "ENTREGUE", "DESCARTE"];`
- `export const foraDoEstoque = (status) => STATUS_FORA_ESTOQUE.includes(status);`
- Helper de conveniência para PostgREST:
  `export const STATUS_FORA_ESTOQUE_IN = \`(${STATUS_FORA_ESTOQUE.join(",")})\`;`
- `catalogoCore.js` (`CATALOGO_STATUS_EXCLUIR`) e `portfolio.js` (`STATUS_FORA`)
  passam a derivar de `STATUS_FORA_ESTOQUE` em vez de manter cópias literais.
  Sem mudança de comportamento (as três listas já são o mesmo conjunto).
  `model.js` é puro (sem `supabase`), então importar dele em `catalogoCore.js`
  não quebra a importabilidade em testes Node.

### 2. Listagem geral — `src/screens/ItemsScreen.jsx` (~linha 129)
- Hoje: `if (fStatus) query = query.eq("status", fStatus);`
- Novo: `if (fStatus) query = query.eq("status", fStatus); else query = query.not("status", "in", STATUS_FORA_ESTOQUE_IN);`
- Efeito: sem status selecionado, o estoque ativo é o padrão; escolher
  VENDIDO/ENTREGUE/DESCARTE no dropdown continua mostrando esses itens. O
  `count` exibido reflete o estoque ativo.

### 3. Conferência — `src/screens/ConferenciaScreen.jsx` (`fetchItens`, ~linha 32)
- Adicionar `q = q.not("status", "in", STATUS_FORA_ESTOQUE_IN);` dentro de
  `fetchItens`, cobrindo todas as seções (definir lote, encaixotar, etc.).

### 4. Caixas — `src/lib/caixas.js` (`itensDaCaixa`, ~linha 120)
- Adicionar `.not("status", "in", STATUS_FORA_ESTOQUE_IN)` à query.
- Consequência aceita: a contagem de itens de uma caixa na tela da caixa pode
  divergir do `n_itens` do Dashboard (view SQL não filtrada). Tradeoff da
  decisão de não mexer no Dashboard.

## Testes

`scripts/test_estoque.mjs` (ligado ao `npm test`):
- `STATUS_FORA_ESTOQUE` contém exatamente VENDIDO, ENTREGUE, DESCARTE.
- `foraDoEstoque`: true para os três; false para PRONTO/ANUNCIADO/A_CATALOGAR.
- `CATALOGO_STATUS_EXCLUIR` e `STATUS_FORA` (pós-consolidação) representam o
  mesmo conjunto que `STATUS_FORA_ESTOQUE`.

## Fora de escopo

- Alterar Dashboard, view `vw_caixas_abertas` ou qualquer contagem SQL.
- Limpar/alterar `caixa_id` automaticamente ao vender/entregar.
- Mudar a tela de Vendas (que já filtra por VENDIDO/ENTREGUE de propósito).
