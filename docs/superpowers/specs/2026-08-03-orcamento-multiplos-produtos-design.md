# Orçamento de múltiplos produtos — design

Data: 2026-08-03

## Problema

O orçamento hoje é de um item só: `ItemDetail` abre `AnuncioModal`, que chama
`montarAnuncio(item)` e renderiza uma folha A4. Não há como montar um orçamento
com vários produtos para um mesmo cliente.

Além disso, o texto que vai para o WhatsApp (e para o "Copiar msg") carrega
saudação, nome da empresa e pergunta final. O operador quer só as linhas de
produto e valor.

## Decisões

| Assunto | Decisão |
|---|---|
| Formato do PDF múltiplo | Uma página A4 por produto, num único documento. Sem folha de total. |
| Limite | 10 produtos por orçamento. |
| Texto WhatsApp | Uma linha por produto (`Nome — R$ X`); com 2+ itens, `Total:` no fim. Sem textos complementares. |
| Entrada na UI | Modo de seleção já existente do `ItemsScreen`, com duas ações na barra inferior. |
| QR de cada página | Do produto daquela página (comportamento atual mantido). |
| Item sem preço | Entra como "sob consulta", fora da soma do total. |

## Arquitetura

Três camadas, seguindo o que já existe:

1. **`src/lib/anuncioTemplate.js`** — puro, sem rede, testável em Node.
2. **`src/lib/anuncio.js`** — orquestra fotos, QR e impressão.
3. **UI** — `AnuncioModal`, `ItemDetail`, `ItemsScreen`.

### 1. `anuncioTemplate.js` (puro)

Hoje `gerarAnuncioHTML` devolve um documento HTML completo por item, o que
impede empilhar páginas. Quebra em duas peças:

- `sheetAnuncio(it, opts)` → apenas `<div class="sheet">…</div>`, com o corpo
  atual e nenhuma mudança visual.
- `documentoAnuncio(sheets, titulo)` → `<!DOCTYPE html>` + `<style>CSS</style>`
  + as folhas concatenadas.
- `gerarAnuncioHTML(it, opts)` mantém a assinatura pública e vira
  `documentoAnuncio([sheetAnuncio(it, opts)], …)`. Nenhum chamador muda.
- `gerarOrcamentoHTML(itens, opts)` — novo. `opts.porSku = { [sku]: { fotos,
  qrDataUrl } }`; `empresa`, `pagamento` e `entrega` continuam globais ao
  documento. Título do documento: `Orçamento (N itens) — <empresa>`.

No CSS, o mesmo idioma já usado em `catalogoTemplate.js`:

```css
.sheet{ …; page-break-after:always; }
.sheet:last-child{ page-break-after:auto; }
```

**Texto compartilhável** (vale para único e múltiplo):

- `linhaOrcamento(it)` → `Furadeira de Impacto 750W — R$ 289`. (`fmtBRL` formata
  sem centavos.) Sem preço
  (`precoVenda(it) == null`) → `Furadeira de Impacto 750W — sob consulta`.
- `mensagemWhatsApp(it)` passa a ser exatamente `linhaOrcamento(it)`. Somem a
  saudação, a linha `Cód:`, o nome da empresa e o "Está disponível?".
- `mensagemOrcamento(itens)` → uma `linhaOrcamento` por item, uma por linha.
  Com 2+ itens, acrescenta linha em branco e `Total: R$ X`, somando só os itens
  com preço. Havendo item sob consulta, o total sai como
  `Total: R$ X (+ itens sob consulta)`. Com 1 item, sem linha de total —
  o resultado é idêntico a `mensagemWhatsApp`.
- Se nenhum item tiver preço, não há linha de total (não faz sentido `R$ 0,00`).

### 2. `anuncio.js` (orquestração)

- `export const LIMITE_ORCAMENTO = 10` — fonte única do limite, consumida tanto
  pela validação quanto pela UI.
- `montarOrcamento(itens, { empresa, onProgress } = {})` →
  `{ html, mensagem, link, total, semPreco, semFoto }`. O cálculo de
  `total`/`semPreco`/`semFoto` fica em `totaisOrcamento(itens)`, na camada pura,
  para poder ser testado em Node (este módulo importa o cliente Supabase e não
  roda fora do browser).
  - Lança erro se `itens.length` for 0 ou maior que `LIMITE_ORCAMENTO`.
  - Para cada item, busca fotos (`fotosDoItem`) e gera o QR do link da própria
    linha, em paralelo. `onProgress(feitas, total)` é chamado a cada item
    concluído, como o `PortfolioScreen` já faz na preparação de fotos.
  - `mensagem` = `mensagemOrcamento(itens)`; `link` = `waLink(mensagem)`.
  - `total` = soma dos itens com preço; `semPreco`/`semFoto` = arrays de SKU.
- `montarAnuncio(item, empresa)` continua exportada com o mesmo contrato e passa
  a delegar para `montarOrcamento([item], { empresa })`.
- Foto de item que falhar continua sendo omitida (best-effort), como hoje.

### 3. UI

**`AnuncioModal`** passa a receber `itens` (array) no lugar de `item`.

- Título: `Orçamento — <sku>` com um item; `Orçamento — N itens` com vários.
- A prévia deixa de fixar `aspect-ratio: 210/297` e passa a ter altura
  proporcional ao número de páginas, mantendo `max-width: 210mm`.
- Os avisos viram contagem: `⚠ 2 sem preço ideal — saem como "sob consulta"` e
  `⚠ 1 sem foto — sai com placeholder`, cada um só quando houver.
- Enquanto gera, mostra o progresso (`feitas/total`) em vez do spinner mudo.
- A barra de ações (Copiar msg / WhatsApp / Salvar PDF) não muda.

**`ItemDetail`** só passa `itens={[it]}`.

**`ItemsScreen`**:

- O botão `Etiquetas` do cabeçalho vira `Selecionar` (entra no mesmo
  `selectMode` de hoje).
- A barra inferior do modo seleção passa a ter dois botões lado a lado:
  `Etiquetas (N)` e `Orçamento (N)`.
- Acima de `LIMITE_ORCAMENTO` selecionados, o botão de orçamento fica
  desabilitado com o rótulo `Orçamento (máx. 10)`.
- Como já acontece com as etiquetas, valem os itens selecionados presentes na
  página atual (`itens.filter(i => selected.has(i.sku))`).

## Erros

- Seleção acima do limite: bloqueada na UI antes de chamar a lib; a lib também
  valida, para não depender só da tela.
- Falha ao buscar fotos de um item: a página sai com placeholder, o orçamento
  continua.
- `navigator.clipboard` indisponível: comportamento atual mantido (silencioso).

## Testes

`scripts/test_anuncio.mjs` (puro, já no `npm test`) ganha:

- `mensagemWhatsApp` de um item: exatamente uma linha, contendo nome e valor,
  sem "Olá", sem "Cód:", sem "disponível".
- `mensagemOrcamento` com 3 itens: 3 linhas de produto + `Total:` com a soma.
- Item sem preço: linha com "sob consulta", fora da soma, total marcado com
  `(+ itens sob consulta)`.
- `mensagemOrcamento` de um item só: sem linha de total.
- `gerarOrcamentoHTML` com 3 itens: um único documento, 3 ocorrências de
  `class="sheet"`, `page-break-after` presente no CSS.
- `gerarAnuncioHTML` segue passando nos testes atuais (documento completo,
  preço, SKU, escape de HTML).
