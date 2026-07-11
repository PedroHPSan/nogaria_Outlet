# Salas — armazenamento estruturado de caixas e itens

**Data:** 2026-07-11
**Contexto:** Hoje a localização física de caixas e itens é um texto livre
(`local_fisico`, ex.: "Belém · Galpão A") — informal e não reutilizável. As caixas
chegaram em Belém e é preciso saber, de forma estruturada, **em que sala** cada caixa
está. Itens grandes que não serão encaixotados também precisam ficar registrados dentro
de uma sala, sem estar em nenhuma caixa.

## Objetivos

1. Criar a entidade **`sala`** (código auto-gerado + nome) como local estruturado que
   **substitui** o `local_fisico` na interface.
2. Alocar **caixas** e **itens soltos** em salas, sabendo a qualquer momento o que há
   dentro de cada sala.
3. Dois fluxos de alocação: **dropdown** no detalhe da caixa/item e **scan em massa**
   ("encher a sala").
4. Etiqueta com **QR da sala** (para a porta), **sala nas etiquetas** de caixa/item, e
   um **atalho no Dashboard** para "caixas sem sala".

Fora de escopo (YAGNI): hierarquia de salas (sala dentro de sala), lotação/capacidade,
planta/mapa, vínculo sala↔destino/cidade, e **auto-migração** dos `local_fisico`
existentes (decisão: começar do zero — os valores antigos permanecem como histórico).

## Decisões de design (confirmadas)

- **Sala substitui o local:** `local_fisico` sai da interface; permanece no banco só
  como histórico (não é mais lido nem escrito pela UI). Abordagem **FK limpo** — uma
  fonte de verdade (`sala_id`).
- **Começar do zero:** salas nascem vazias; nada é auto-migrado do `local_fisico`.
- **Identidade da sala:** código auto-gerado (`SALA-001`) + nome descritivo.
- **Alocação:** dropdown no detalhe **e** scan em massa.
- **Item em caixa não se move sozinho.** A localização de um item encaixotado é a da
  sua caixa (herança propagada). Para mover só o item, é preciso **retirá-lo da caixa**
  primeiro (ação explícita, registrando quem movimentou).
- **Venda inalterada:** produto VENDIDO/ENTREGUE/DESCARTE sai do estoque/caixa como
  sempre (fluxo `STATUS_FORA_ESTOQUE` intacto); nada de novo aqui.

## Modelo de dados atual (relevante)

- `caixas(codigo PK, tipo, destino, local_fisico, referencia, status, chegou_em,
  conferida_em, ...)` — RLS habilitada.
- `itens(... caixa_id FK→caixas.codigo, local_fisico, destino, status, ...)` — o item
  **herda `local_fisico`/`destino` da caixa** ao ser encaixotado (snapshot propagado
  por `adicionarItemCaixa`, `atualizarCaixa`, `registrarChegada`, `definirLocalCaixa`).
- `eventos(id, sku, acao, detalhe, usuario, ts)` — histórico; eventos de caixa usam o
  **código da caixa** no campo `sku`.
- `src/lib/caixas.js` já propaga `destino`/`local_fisico` para `.eq("caixa_id", codigo)`.

## 1. Schema (migration nova — requer aprovação Pedro/Bárbara)

```sql
-- Tabela salas
create table if not exists salas (
  codigo     text primary key,               -- 'SALA-001' (auto-gerado)
  nome       text not null,                  -- descritivo, ex.: 'Galpão A'
  observacao text,
  ativa      boolean not null default true,  -- esconder do dropdown sem apagar
  criado_por text,
  criado_em  timestamptz not null default now()
);

-- FKs de localização (nullable; on delete set null p/ não travar exclusão de sala)
alter table caixas add column if not exists sala_id text
  references salas(codigo) on update cascade on delete set null;
alter table itens  add column if not exists sala_id text
  references salas(codigo) on update cascade on delete set null;
create index if not exists idx_caixas_sala on caixas (sala_id);
create index if not exists idx_itens_sala  on itens  (sala_id);

-- RLS espelhando o padrão (auth_full_<tabela>)
alter table salas enable row level security;
drop policy if exists auth_full_salas on salas;
create policy auth_full_salas on salas for all to authenticated using (true) with check (true);
```

`local_fisico` **não é removido** (histórico). Nenhum backfill.

## 2. Regras de localização

- Localização da **caixa** = `caixa.sala_id`.
- Localização do **item**:
  - `caixa_id` preenchido → sala herdada da caixa; `item.sala_id` é mantido em sincronia
    (propagado) sempre que a sala da caixa muda ou o item entra na caixa.
  - `caixa_id` nulo (solto) → `item.sala_id` definido diretamente.
- Conteúdo de uma sala = caixas com `sala_id = X` **+** itens soltos
  (`sala_id = X AND caixa_id IS NULL`), sempre ocultando `STATUS_FORA_ESTOQUE`.

## 3. Backend

### `src/lib/salas.js` (novo)

- `proximoCodigoSala()` — sequencial `SALA-###` (mesmo parse do `proximoCodigoCaixa`).
- `criarSala({ nome, observacao }, user)` — insert com retry em colisão de código;
  evento `sala:criada`.
- `atualizarSala(codigo, patch, user)` — renomear/editar/`ativa`; evento `sala:editada`.
- `listarSalas({ ativa } = {})` — lista (default: só ativas), mais recentes primeiro.
- `buscarSala(codigo)` — por código (scan do QR).
- `conteudoSala(codigo)` — `{ caixas: [...], itensSoltos: [...] }` (oculta fora-estoque).
- `alocarCaixaNaSala(codigoCaixa, salaCodigo, user)` — set `caixa.sala_id` **e propaga
  `sala_id` aos itens** da caixa; evento `caixa:sala` (detalhe = código da sala).
- `alocarItemNaSala(sku, salaCodigo, user, { forcarRetirarDaCaixa = false })` —
  para item **solto**: set `item.sala_id`; evento `item:sala`. Se o item estiver numa
  caixa e `forcarRetirarDaCaixa` for falso, **não altera nada** e retorna
  `{ precisaConfirmar: true, caixa_id }` para a UI oferecer a ação. Com
  `forcarRetirarDaCaixa: true`: remove da caixa (`caixa_id = null`), set `sala_id`,
  evento `item:sala` com `detalhe = "retirado de CX-001"` e `usuario` (quem movimentou).
- `removerCaixaDaSala(codigoCaixa, user)` / `removerItemDaSala(sku, user)` — set
  `sala_id = null` (e propaga p/ itens no caso da caixa); eventos correspondentes.
- `historicoSala(codigo)` — eventos com `sku = codigo`, recentes primeiro.

### Ajustes em `src/lib/caixas.js`

- `atualizarCaixa` / `registrarChegada` / `adicionarItemCaixa` passam a propagar
  **`sala_id`** aos itens (no lugar de `local_fisico`). `registrarChegada` deixa de
  gravar `local_fisico` a partir da UI; passa a aceitar `sala_id`.
- `definirLocalCaixa` é substituída por `alocarCaixaNaSala` (verificar/atualizar usos).
- Itens VENDIDO/ENTREGUE/DESCARTE seguem ocultos e intocados (venda inalterada).

## 4. Telas

### `src/screens/SalasScreen.jsx` (nova) — espelha a estrutura da `CaixasScreen`

- **Lista** de salas (busca + filtro ativas/todas) e botão **"Nova sala"** (nome +
  observação → cria `SALA-###`). Abrir sala por **tap ou scan de QR**.
- **`SalaDetalhe`:**
  - Cabeçalho: código + nome; editar nome/observação/`ativa`; **imprimir etiqueta** (QR).
  - **Conteúdo:** caixas na sala (com contagem/valor estimado) + itens soltos na sala.
  - **"Encher sala"** — scanner contínuo (reusa `BarcodeScanner qr continuous`):
    - `CX-*` / `MALA-*` → `alocarCaixaNaSala` (feedback + segue lendo).
    - SKU de item **solto** → `alocarItemNaSala` direto.
    - SKU de item **em caixa** → banner com opção **"Retirar da caixa CX-001 e dar
      entrada nesta sala"** → `alocarItemNaSala(..., { forcarRetirarDaCaixa: true })`,
      registrando quem movimentou. Sem confirmar, nada muda.
  - Remover caixa/item da sala.

### Navegação

- Nova entrada **"Salas"** no menu, ao lado de "Caixas" (verificar `App.jsx`/Dashboard).

### `src/screens/CaixasScreen.jsx` (detalhe da caixa)

- Trocar o input "Local de armazenamento" por **seletor de sala** (dropdown de salas
  ativas + opção "— sem sala —"). "Registrar chegada" grava `sala_id` (propaga aos
  itens). Reimpressão de etiqueta permanece.

### `src/screens/ConferenciaScreen.jsx` (criação da caixa)

- Trocar o input de local por **seletor de sala** (opcional na criação).

### `src/screens/ItemDetail.jsx`

- Item **solto** → seletor de sala (`alocarItemNaSala`).
- Item **em caixa** → mostra a sala herdada (read-only, "via caixa CX-001").

## 5. Etiquetas · Dashboard · Scanner

- **Etiquetas de caixa/item** (`src/lib/labels.js`, `LabelCard.jsx`): "Local: …" vira
  **"Sala: SALA-001 · Galpão A"**. Os builders (`buildBoxLabel`/`buildProductLabel`)
  passam a receber o rótulo da sala resolvido pelo chamador (que tem a lista de salas),
  já que são síncronos e não fazem fetch. Sem sala → "—".
- **Etiqueta da sala** (nova): `buildRoomLabel(sala)` → tipo `SALA`, QR = `codigo`,
  mostra nome. Layout novo em `LabelCard`; impressão reusa `LabelPrint`; `printLog`
  ganha ação `etiqueta_sala:impressa` (+ `buscarViasImpressaoSala`).
- **Dashboard:** `QueueRow` "caixas sem sala" (contagem de `caixas.sala_id IS NULL`) com
  atalho para resolver.
- **Scanner:** roteamento por prefixo do texto lido — `SALA-*`, `CX-*`, `MALA-*`, ou SKU
  de item — usado no fluxo "encher sala" e ao abrir sala por QR.

## Eventos (tabela `eventos`, `sku` = código da entidade)

`sala:criada`, `sala:editada`, `caixa:sala`, `item:sala` (com `detalhe` indicando
origem quando retirado de caixa), `etiqueta_sala:impressa` (via `printLog`). Todos com
`usuario` = quem executou (rastreio de movimentação).

## Notas de implementação

- Reusar ao máximo os padrões de `caixas.js`/`CaixasScreen.jsx`/`LabelPrint` — a sala é
  "irmã" da caixa em quase tudo (código sequencial, RLS, eventos, etiqueta, scan).
- A migration exige aprovação de Pedro/Bárbara antes de aplicar (padrão do projeto).
