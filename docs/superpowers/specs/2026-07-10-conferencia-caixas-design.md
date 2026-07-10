# Conferência e armazenamento de caixas

**Data:** 2026-07-10
**Contexto:** As caixas do outlet chegaram em Belém. É preciso (a) indicar/atualizar
onde cada caixa está fisicamente armazenada, propagando isso para os produtos dentro
dela; (b) registrar no histórico da caixa o dia da chegada e o local de armazenamento;
e (c) reconferir o conteúdo das caixas, já que algumas rasgaram no transporte (itens
podem ter sumido ou danificado).

## Objetivos

1. Permitir indicar/atualizar o **local de armazenamento** de uma caixa pela UI,
   propagando o local para todos os itens da caixa.
2. Criar um fluxo de **conferência de caixas** (caixa + itens): confirmar chegada,
   definir armazenamento e revisar item a item (presente / avariado / faltando).
3. Registrar no **histórico da caixa** (tabela `eventos`) a data de chegada e o local
   de armazenamento, além das marcações de avaria/falta e da conferência.

Fora de escopo: alterar `destino` (canal de venda) da caixa; qualquer refatoração não
relacionada; controle de perfis/permissões por usuário.

## Modelo de dados atual (relevante)

- `caixas(codigo PK, tipo, destino, local_fisico, referencia, status, criado_por,
  criado_em, fechada_por, fechada_em)` — RLS habilitada, com policy de UPDATE já
  existente (a função `atualizarCaixa` já atualiza a tabela hoje).
- `itens(... caixa_id FK→caixas.codigo, local_fisico, destino, estado tri_estado, ...)`
  — o item herda `local_fisico`/`destino` da caixa ao ser encaixotado.
- `eventos(id, sku, acao, detalhe, usuario, ts)` — histórico. Eventos de caixa usam o
  **código da caixa** no campo `sku` (padrão já existente: `caixa:criada`,
  `caixa:item_add`, `caixa:fechada`, `caixa:reaberta`).
- `src/lib/caixas.js` já expõe `atualizarCaixa(codigo, patch, user)`, que atualiza a
  caixa e **propaga `destino`/`local_fisico` para todos os itens** (`.eq("caixa_id", codigo)`).
  Hoje essa função **não grava evento**.

## 1. Schema (migration nova — requer aprovação Pedro/Bárbara)

Adicionar em `caixas` (tudo nullable, sem default que exija backfill):

| coluna | tipo | uso |
|---|---|---|
| `chegou_em` | `timestamptz` | data de chegada em Belém |
| `conferida_em` | `timestamptz` | carimbo da reconferência |
| `conferida_por` | `text` | e-mail de quem conferiu |

`local_fisico` já existe e é o "armazenamento" — não muda. As novas colunas herdam as
policies RLS atuais da tabela. Nome do arquivo: `supabase/migrations/<timestamp>_caixas_chegada_conferencia.sql`.

## 2. Lógica de dados (`src/lib/caixas.js`)

Funções novas, isoladas da UI, seguindo o padrão do arquivo (retry/eventos best-effort):

- **`definirLocalCaixa(codigo, local, user)`** — atualiza `local_fisico`, **propaga aos
  itens** (mesma mecânica de `atualizarCaixa`) e grava evento `caixa:local`
  (detalhe = novo local). Atende "indicar onde a caixa está armazenada".
- **`registrarChegada(codigo, { chegou_em, local }, user)`** — grava `chegou_em` e o
  `local_fisico` (propagando aos itens) e grava evento `caixa:chegada`
  (detalhe = `Belém · dd/mm/aaaa · <local>`). `chegou_em` aceita data escolhida
  (retroativa), default hoje.
- **`conferirCaixa(codigo, user)`** — carimba `conferida_em`/`conferida_por` e grava
  evento `caixa:conferida`.
- **`marcarItemAvariado(sku, user)`** — `itens.estado = 'Avariado'` + evento
  `caixa:item_avaria`. Item **permanece** na caixa.
- **`marcarItemFaltando(sku, user)`** — remove o item da caixa (`caixa_id = null`) +
  evento `caixa:item_faltando`. Item continua no sistema, agora "sem caixa".
- **`historicoCaixa(codigo)`** — lê `eventos` onde `sku = codigo`, mais recentes primeiro.

Para evitar duplicação, a propagação de `local_fisico` aos itens é centralizada (reuso
da lógica já presente em `atualizarCaixa`).

## 3. UI (`src/screens/CaixasScreen.jsx`)

O botão flutuante **"Caixa QR"** passa a abrir `CaixasScreen`, que **substitui** a atual
`CaixaQrScreen` (sem adicionar aba na barra inferior, que já tem 7 itens). A avaliação
de conteúdo (valor/peso/itens) da tela atual é preservada dentro do detalhe.

Estados da tela:

- **Lista** — chips de filtro *A conferir / Conferidas / Todas* (via `listarCaixas`);
  cada caixa mostra código, tipo, `local_fisico`, chegada, nº de itens e badge
  "conferida". Botão de escanear + input manual de código no topo.
- **Escanear** — reusa `BarcodeScanner` (QR); ao detectar/digitar, abre o detalhe.
- **Detalhe / Conferência**:
  - Cabeçalho com avaliação (valor/peso estimados — reuso de `classificacao.js`).
  - Campo **Local de armazenamento** (pré-preenchido com `local_fisico`) + **Data de
    chegada** (input date, default hoje, retroativa) → botão **"Registrar chegada +
    armazenamento"** (`registrarChegada`).
  - Lista de itens; cada item com ações rápidas **[Avariado]** e **[Faltando]** (com
    feedback visual do que já foi marcado na sessão). Item leva à ficha ao tocar.
  - Botão **"Marcar caixa conferida"** (`conferirCaixa`).
  - Seção **Histórico da caixa** (`historicoCaixa`): chegada, armazenamento,
    conferência, avarias e faltas.

`App.jsx`: o handler do botão passa a montar `CaixasScreen` no lugar de `CaixaQrScreen`;
mantém `onOpenItem` para abrir a ficha do item.

## 4. Registro global (`App.jsx`)

Adicionar rótulos em `eventoLabel` para os novos eventos, para aparecerem legíveis na
aba Registro: `caixa:chegada`, `caixa:local`, `caixa:conferida`, `caixa:item_avaria`,
`caixa:item_faltando`.

## 5. Testes (`scripts/test_caixas.mjs`)

Novo teste no padrão dos `scripts/test_*.mjs` existentes (mock do cliente supabase),
adicionado ao script `test` do `package.json`. Cobre:

- `definirLocalCaixa` atualiza a caixa, dispara o update de itens por `caixa_id` e grava
  o evento `caixa:local`.
- `registrarChegada` grava `chegou_em` + local + evento `caixa:chegada` com detalhe
  formatado.
- `marcarItemAvariado` seta `estado='Avariado'` + evento; `marcarItemFaltando` zera
  `caixa_id` + evento.

## Fluxo de uso (caixa chegou em Belém)

1. Operador abre "Caixa QR" → lista → filtra *A conferir*.
2. Escaneia/abre a caixa → informa a data de chegada e o local (ex.: "Belém · Galpão A")
   → "Registrar chegada + armazenamento". Local propaga para todos os itens; histórico
   recebe `caixa:chegada`.
3. Revisa os itens; marca avariados/faltantes conforme a caixa (algumas rasgaram).
4. "Marcar caixa conferida" → carimbo + evento; a caixa sai da lista de pendentes.

## Riscos / decisões

- **Migration** depende de aprovação (Pedro/Bárbara). O restante (lib + UI) não é
  bloqueado por dados legados, mas as colunas novas são necessárias para o filtro
  "conferidas" e a data de chegada persistida.
- Substituir `CaixaQrScreen` por `CaixasScreen` remove código somente-leitura; a
  avaliação de conteúdo é reaproveitada no detalhe, então não há perda de função.
- Marcações de item são best-effort no histórico (não bloqueiam a conferência), igual
  ao restante de `lib/caixas.js`.
