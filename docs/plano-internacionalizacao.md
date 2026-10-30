# Plano de internacionalização — venda para Espanha e Portugal

Revisão de 30/10/2026 (UTC-3) sobre a main (`cfb9e12`, PR #48 em produção) + working tree não commitado (numeração de calçados). `npm test` (558 asserções) e `npx vite build` passam no estado atual. Nada foi commitado, nem deployado, nem alterado em produção.

Legenda: **[F]** fato verificado no código · **[S]** suposição/inferência minha.

## 1. Resumo executivo

O fluxo de preço misto (R$ +20% → €) está implementado ponta a ponta e funciona: preview com os dois valores, página pública que rebusca a cotação a cada abertura, modal "Quero este" que recalcula antes de abrir o WhatsApp, textos pt/en/es. A numeração de calçados está convertida em telas, etiqueta, página e imagem — mas **sobre uma premissa errada (BR = EU)**: as tabelas de mercado e das marcas apontam BR ≈ EU − 2 (BR 38 ≈ EU 40). Divulgar hoje mostraria tamanhos 2 números menores para o europeu.

Os cinco pontos que impedem divulgar com segurança para ES/PT:

1. **Numeração BR→EU errada** (`src/lib/tamanhos.js:33`, `BR_PARA_EU = 0`). Bloqueante; correção de 1 linha + teste, mas precisa decisão do dono sobre a tabela e sobre mostrar o BR junto.
2. **Nenhum registro da cotação usada na venda.** A venda é gravada em colunas de `itens` (`src/lib/vendas.js:10-23`: `valor_vendido`, `canal_venda`, `taxa_venda`, `frete_pago`, `comprador`, `pedido_ref`) e as sacolas em `orcamentos` (`valor_pago`, `forma_pagamento`). Não há `moeda`, `valor_eur`, `cotacao`, `cotacao_em`. A única evidência do valor combinado é o texto do WhatsApp, editável pelo cliente.
3. **O R$ mostrado ao cliente é o R$ +20%** (`precoEuro.js:9-16`, `ofertaCore.js:24`). Brasileiro no mesmo grupo vê R$ 1.558,80 em vez de R$ 1.299; e o payload público guarda o R$ base (`ofertaCore.js:54`), então o acréscimo é dedutível por qualquer um que abra o JSON. Precisa decisão: links separados por público ou aceitar.
4. **Falha de cotação deixa o preço em spinner infinito** (`ProdutoPublicoView.jsx:94-96`): com `cotacao === false` o `misto.eur` é `null` e a tela mostra o loader para sempre; o botão de confirmar some (`:143`). Sem caminho de compra quando AwesomeAPI e Frankfurter falham.
5. **Conteúdo do produto continua em pt-BR** (nome, condição, badge, "Oferta indisponível", `<html lang="pt-BR">`, `og:locale pt_BR`) e o formato de moeda/hora é brasileiro (`€ 259,80` em vez de `259,80 €`; hora de Brasília sem indicação de fuso). Para ES/PT isso é "parcial", não "feito".

Fora do código: entrega internacional, IVA/alfândega, meio de pagamento em euros e GDPR não têm decisão nem lugar no app — ver §4.

## 2. Pedidos do dono × status

| # | Pedido | Status | Evidência |
|---|---|---|---|
| A1 | R$ +20% e mostrar também em € | **Feito** | `src/lib/precoEuro.js:4-16` (`ACRESCIMO_EURO`, `precoMisto`) |
| A2 | Valor atualizado no momento da compra | **Feito** | `src/screens/ProdutoPublicoView.jsx:62-66` (`abrirConfirmacao` → `cotacaoEuro({forcar:true})`), `:128-153` (modal) |
| A3 | Sempre mostrar data da cotação e cotação atual no texto, avisar que será refeito no dia da compra | **Feito** | `precoEuro.js:62,76-85` (`textoCotacao`, `textoGrupoEuro`); página `ProdutoPublicoView.jsx:121-126`; imagem `cardCore.js:119` |
| A4 | Cliente vê valor atualizado a cada clique no link | **Feito** | `ProdutoPublicoView.jsx:35` (busca com `forcar:true` a cada carga) |
| A5 | Cartão de preview mostra os DOIS valores (€ e R$) | **Feito** | `cardCore.js:106-117` (imagem), `ofertaCore.js:24,81` (og:title) |
| A6 | Texto do cartão avisa que ao clicar o valor é atualizado | **Feito** | `ofertaCore.js:38` + `precoEuro.js:65` (og:description trilíngue) |
| A7 | "Quero este" recalcula com cotação atual e a venda sai pelo valor correto | **Parcial** | Recalcula (`ProdutoPublicoView.jsx:62-66`) e manda na mensagem (`precoEuro.js:88-91`), mas o valor/cotação **não é gravado em lugar nenhum** (`vendas.js:10-23`, `sacolas.js:75-80`); a Bárbara só tem o texto do WhatsApp |
| A8 | 20% não aparece ao cliente | **Parcial** | Sem rótulo no texto/imagem (`precoEuro.js:67-73`); porém o payload público traz `preco` base (`ofertaCore.js:54`) e o R$ exibido é o +20% — a diferença é visível para quem conhece o preço BR ou lê o JSON |
| A9 | Textos (não imagem) em espanhol, inglês e português | **Parcial** | Textos de sistema: sim (`precoEuro.js:29-54`). Nome/condição/badge do produto, "Oferta indisponível" (`ProdutoPublicoView.jsx:45-52`), cabeçalho, `lang`/`og:locale`: só pt-BR. Imagem permanece em pt (TAM, NOGÁRIA OUTLET — conforme pedido) |
| B1 | Numeração na etiqueta impressa | **Feito (não commitado)** | `src/lib/labels.js:139`, `src/components/labels/LabelCard.jsx:124-128` (29 mm) e `:209-213` (62 mm) |
| B2 | Numeração traduzida ao padrão EU em telas, etiquetas e imagens | **Parcial (não commitado, premissa errada)** | `tamanhos.js:29-58` com `BR_PARA_EU = 0`; aplicado em `cardCore.js:137`, `ofertaCore.js:50`, `labels.js:139`, `anuncioTemplate.js:33`, `catalogoCore.js:94`, `portfolio.js:38,51`, `PortfolioScreen.jsx:101`, `ItemDetail.jsx:1026`, `NewItem.jsx:253`. **Faltou** `cardCore.js:164-168` (`cardOgOferta` usa `it.tamanho` cru → imagem de oferta com vários itens sai em BR) |

## 3. Achados da revisão

### 3.1 Bloqueantes para vender na Europa

**B-1. BR ≠ EU: a conversão está deslocada em ~2 números.** [F] `tamanhos.js:33` define `BR_PARA_EU = 0` e o comentário diz "BR 38 = EU 38". [S, com fontes] Tabelas de conversão brasileiras e de marcas (Havaianas, Nike BR, guias de compra) apontam EU ≈ BR + 2 para adulto (BR 38 ≈ EU 40; BR 42 ≈ EU 44) e também para infantil (BR 23/24 ≈ EU 25/26). Há variação por marca (+1 a +2) e por gênero em algumas tabelas. Fontes: [essemundoenosso](https://www.essemundoenosso.com.br/numeracao-de-calcados-na-europa-x-brasil), [grupodicas](https://www.grupodicas.com/?p=306440), [calculacentro](https://calculacentro.com/calculadora/conversor-calcado). Impacto: cliente europeu compra "EU 38" e recebe um BR 38 (= EU 40). Correção: `BR_PARA_EU = 2` + testes; conferir com 3–5 caixas físicas do estoque (a caixa de marca costuma trazer BR/EU/US) antes de fixar. Dados reais só têm BR (`itens.tamanho`), então o deslocamento vale para 100% do estoque.

**B-2. Cotação/valor da venda não é registrado.** [F] `registrarVenda` grava `valor_vendido` (R$), `canal_venda`, `taxa_venda`, `frete_pago`, `comprador`, `pedido_ref` em `itens` (`vendas.js:10-23`); `registrarPagamento` grava `forma_pagamento`/`valor_pago` em `orcamentos` (`sacolas.js:75-80`); `catalogos_publicos.payload` guarda só a cotação implícita no og (`ofertaCore.js:81`, não persiste `taxa`/`em`). Não existe tabela de pedidos/interesses. Consequência: a Bárbara recebe "€ 259,80 · R$ 1.558,80. Cotação: 1 € = R$ 6,00 (30/10/2026 14:05)" como texto livre de `wa.me` — o cliente pode editar antes de enviar (`ProdutoPublicoView.jsx:144`, `linkWa`). Correção mínima: colunas `moeda`, `valor_eur`, `cotacao`, `cotacao_em` em `itens` (venda) e `orcamentos` (sacola) + campos no card "Venda" do `ItemDetail`. Correção robusta: RPC anônima `registrar_interesse(slug, sku)` que calcula no servidor, grava `interesses(id, slug, sku, brl_base, brl_acrescido, eur, taxa, taxa_em, lang, criado_em)` e devolve um código curto que entra na mensagem ("Pedido #A1B2"); a Bárbara confere pelo código no app.

**B-3. Sem caminho de compra quando a cotação falha.** [F] `ProdutoPublicoView.jsx:35` seta `cotacao=false` em erro; `:84` monta `misto` com `taxa=undefined` → `eur=null`; `:94-96` renderiza `<Loader2>` eterno; `:143` esconde o botão "Confirmar". `cotacao.js:27` só tenta duas fontes, sem timeout (`fetch` sem `AbortSignal.timeout`). Correção: tratar `cotacao === false` na UI (mostrar só R$ +20% e botão "Enviar mesmo assim, valor em € a combinar") e `AbortSignal.timeout(6000)` nas duas chamadas.

**B-4. Mesmo link serve dois públicos com dois preços incompatíveis.** [F] O modo euro troca o R$ do preview, do texto e da página pelo R$ +20% (`ofertaCore.js:24`, `cardCore.js:106`, `precoEuro.js:72`). Se o dono postar esse link no grupo onde também há brasileiros, eles verão R$ 20% mais caro; se postar o link normal, o europeu não vê €. [S] Precisa de decisão (§4-D1). Enquanto isso, o payload público expõe `preco` base (`ofertaCore.js:54`); se a decisão for "esconder o acréscimo", o payload deve carregar `preco_base_eur` (já acrescido) e não o R$ original.

### 3.2 Importantes

**I-1. Faixa de imagem para oferta com vários itens ignora a conversão.** [F] `cardCore.js:164-168` usa `it.tamanho` em vez de `tamanhoExibicao(it)`. Teste de `test_oferta.mjs:98` só cobre `cardOgProduto`.

**I-2. Agrupar por tamanho converte roupa como se fosse calçado.** [F] `PortfolioScreen.jsx:101` e `portfolio.js:38,51` chamam `tamanhoEU(it.tamanho)` sem `ehCalcado` — "42" de roupa vira "EU 42" (e com `BR_PARA_EU=2`, "EU 44"). `catalogoCore.js:94` está certo (usa `tamanhoExibicao`). Trocar por `tamanhoExibicao(it)` nos três pontos.

**I-3. Etiqueta não mostra o BR para conferência interna.** [F] `labels.js:139` grava só `tamanhoExibicao` → "TAM EU 40"; a caixa física/ nota do fornecedor diz 38. Quem confere na sala vai estranhar. Recomendo "TAM EU 40 · BR 38" (compacto: duas linhas; cabe — a linha nova tem 11pt em rolo de 29 mm, `LabelCard.jsx:124`, [S] ~26 mm úteis comportam ~12 caracteres em 11pt; "EU 40 · BR 38" tem 13 — usar 10pt ou duas linhas). Validar com impressão real na QL-800.

**I-4. Fonte da cotação e hora de reserva enganosa.** [F] `cotacao.js:10` usa `bid` da AwesomeAPI (câmbio comercial, favorece a Nogária, ok). `cotacao.js:21` carimba a reserva Frankfurter com `T12:00:00Z` → aparece "09:00" de Brasília, mas a referência do BCE é publicada ~16:00 CET e é a de **ontem** fora do horário; o cliente lê uma hora que não existe. Fim de semana: AwesomeAPI devolve a última sexta — honesto, mas o texto "cotação do momento" fica falso. Correção: carimbar a fonte (`fonte: "awesome"|"bce"`) e exibir "cotação de referência do dia dd/mm" quando vier do BCE. [S] Spread/IOF/taxa de Wise/PayPal (~1–4% + IOF 0,38–1,1%) não estão modelados: o dono precisa confirmar que os 20% os cobrem (§4-D3).

**I-5. Cotação calculada no navegador, de terceiros, sem fonte única.** [F] `cotacao.js:7,16` chamam AwesomeAPI/Frankfurter direto do navegador do cliente: IP do visitante europeu vai para dois serviços externos (GDPR: sem aviso de privacidade), rate limit da AwesomeAPI por IP [S], e três momentos com três fontes possíveis (publicação, abertura, confirmação). Cache de 60 s é por aba (`cotacao.js:3`) — duas abas, dois valores. Correção: `api/cotacao.js` (Vercel function) com `Cache-Control: s-maxage=60, stale-while-revalidate=300`, fonte única, `{taxa, em, fonte}`; a página e a publicação usam só ele. Bônus: lá dá para registrar a cotação do dia em tabela para auditoria.

**I-6. Formato de moeda/hora/idioma não é europeu.** [F] `fmtEUR` usa `pt-BR` com `€` antes (`precoEuro.js:18`) — em ES/PT é `259,80 €`. `fmtDataCotacao` força `America/Sao_Paulo` sem rótulo (`:22-23`). `idiomaDoNavegador` corta em 2 letras (`:56-59`): `pt-PT` → textos pt-BR; `gl`, `ca`, `fr`, `it`, `de` → pt (melhor cair em `en`). `og:locale` fixo `pt_BR` (`ofertaCore.js:117`), `<html lang="pt-BR">` (`index.html:2`), "Oferta indisponível"/cabeçalho só em pt (`ProdutoPublicoView.jsx:45-52,71`). Correção: `Intl.NumberFormat(lang === "en" ? "en-IE" : lang === "es" ? "es-ES" : "pt-PT", {style:"currency", currency:"EUR"})` para €, data com `timeZoneName:"short"` no fuso do navegador + "(hora de Lisboa/Madrid)"; mapa `pt-PT → pt` com dicionário próprio se quiser diferenciar; idioma padrão `en` quando não for pt/es.

**I-7. Nome/condição/badge do produto só em pt-BR.** [F] `itemOferta` copia `produto`, `condicao` (`fraseCondicao`), `badge.txt` em pt (`ofertaCore.js:46-53`); a página mostra como está (`ProdutoPublicoView.jsx:89-101`). Opções: (a) traduzir na publicação com o `ia.js` existente e guardar `i18n: { en: {produto, condicao, badge}, es: {...} }` no payload (custo por link, cache por SKU em coluna `itens.i18n`); (b) campo manual `produto_en`/`produto_es`; (c) deixar em pt e avisar. Recomendo (a) com fallback pt.

**I-8. Mensagem do grupo: 3 blocos repetidos.** [F] `textoGrupoEuro` gera título, preço, link e três linhas longas com bandeira (`precoEuro.js:76-85`), ~450 caracteres. [S] No grupo isso funciona, mas o aviso triplicado abaixo do link empurra o preview; sugiro uma linha curta por idioma ("🇪🇸 Precio en € actualizado al abrir el enlace · cotización 30/10") e a cotação uma vez só.

**I-9. og:description trilíngue consome o espaço útil.** [F] `descricaoOg` prefixa `descricaoPreviewEuro()` (≈85 caracteres) e corta em 160 (`ofertaCore.js:38`); sobra ~70 para condição·marca·medidas·cor. Preview do WhatsApp mostra ~2 linhas. Sugiro aviso em 1 idioma (o do link) ou "€ price updates on click" só em en.

**I-10. `gerarLinkGrupo` (ItemDetail/Portfólio) não tem modo euro.** [F] `ofertaPublica.js:68-75` publica sem `euro`; só o `CatalogoRapidoModal` oferece a opção (`:238`). O dono vai gerar link do item e esquecer o €. Adicionar toggle/lembrar a última escolha.

**I-11. Erro depois de publicar.** [F] `CatalogoRapidoModal.jsx:147` chama `cotacaoEuro()` para montar o texto **depois** de `publicarOferta` já ter inserido a linha; se falhar, o link existe sem texto copiado e `executar` mostra erro. Reaproveitar a cotação que `publicarOferta` já buscou (devolver no retorno).

### 3.3 Melhorias

- **M-1** Arredondamento: `eur` com centavos (`€ 259,80`). Para outlet, arredondar para cima ao euro inteiro (`Math.ceil`) simplifica e absorve spread. Decisão do dono.
- **M-2** `ACRESCIMO_EURO` fixo (`precoEuro.js:4`); mover para `empresa_config` (já existe `carregarContato`) para o dono ajustar sem deploy.
- **M-3** `catalogos_publicos.payload` não guarda a cotação da publicação (`taxa`, `em`); guardar para auditoria do preview.
- **M-4** Race no modal: dois cliques rápidos em "Quero este" disparam duas buscas; a última resolvida vence (`ProdutoPublicoView.jsx:64`). Guardar um `id` de requisição.
- **M-5** Cache do WhatsApp: o cartão é imutável por URL (fato do WhatsApp) e o `api/og.js` cacheia 300 s + SWR 1 h (`og.js:40`) — compatível com a estratégia "preview fixo, página viva". Só documentar para a Bárbara: republicar = novo link.
- **M-6** Imagem: faixa de 170 px com € 76 px + R$ 44 px (`cardCore.js:115-116`) legível em miniatura; o rodapé "cotação dd/mm hh:mm" em 22 px (`:119`) não é legível na miniatura do WhatsApp — aceitável, é informativo.
- **M-7** Payload `tamanho` já convertido no snapshot (`ofertaCore.js:50`): mudar `BR_PARA_EU` não corrige links já publicados (expiram em 30 dias). Guardar o cru e converter na página.
- **M-8** `.github/workflows/ci.yml` passou para `workflow_dispatch` no mesmo working tree — mudança não relacionada à feature; commitar separado.
- **M-9** `scripts/out/teste_pesquisa_web.json` untracked — adicionar ao `.gitignore` ou remover.

### 3.4 Testes

[F] `scripts/test_oferta.mjs` cobre: `precoMisto`/`brlComAcrescimo`, título/descrição og em euro, imagem com dois valores (`cardOgProduto`), `textoCotacao` em Brasília, `textoGrupoEuro`, `mensagemInteresseEuro` es/en, `idiomaDoNavegador`, `tamanhoEU` (BR/US/UK/EU, faixas, meios, não convertíveis), `tamanhoExibicao`, imagem e payload com EU.
Faltam: `cotacao.js` (fetch mockado: sucesso, 500 → reserva, ambos falham, timeout, cache/forcar); `cardOgOferta` com tamanho (I-1); `agruparPorTamanho`/`PortfolioScreen` com roupa (I-2); `labels.js` (não importável em Node: `import ... from "./model"` sem extensão, `labels.js:6-8` — extrair `buildProductLabel` para `labelsCore.js` ou adicionar `.js`); `ProdutoPublicoView` (falha de cotação, modal, idioma) — Vitest + Testing Library ou Playwright local; `api/og.js` com `fetch` mockado; `tamanhoEU` com `BR_PARA_EU = 2` (teste atual fixa "38" → "EU 38" e vai quebrar — correto).

## 4. Decisões que dependem do dono (com recomendação)

| # | Decisão | Recomendação |
|---|---|---|
| D1 | Mesmo link para BR e ES/PT ou links separados? | **Separados**: link normal (R$) para o grupo BR; link euro para o grupo/lista ES-PT. Evita o R$ +20% ser visto por brasileiros e dispensa esconder o payload. Se for um grupo só, mostrar só € no modo euro (sem R$) e manter o R$ apenas na mensagem à Bárbara. |
| D2 | Tabela de conversão BR→EU | **+2 fixo** (adulto e infantil), validado com caixas físicas; permitir override por item no campo `tamanho` (ex.: "EU 41" já é respeitado por `tamanhoEU`). Etiqueta e tela interna com "EU 40 · BR 38". |
| D3 | Os 20% cobrem IOF, spread, taxa do meio de pagamento e risco cambial entre clique e pagamento? | Listar o meio de pagamento (D4) e calcular: Wise ~0,6–1,5% + IOF 0,38% (ou 1,1% se cartão), PayPal ~4–5% + spread ~3%. Com Wise, 20% sobra margem; com PayPal, apertado. Manter 20% e arredondar € para cima. |
| D4 | Como o europeu paga? | Pix não serve. Opções: Wise/Remessa Online em EUR (transferência SEPA para conta Wise da Nogária), PayPal, MB Way/Bizum só com conta local. Recomendo **Wise Business** (SEPA, cliente paga em €, Nogária recebe R$). Definir e colocar na mensagem de confirmação. |
| D5 | Entrega: quem é o cliente europeu — brasileiro que vai viajar/receber no Brasil, ou envio internacional? | [S] Se for envio para Europa: Correios Exporta Fácil/DHL, IVA + direitos aduaneiros pagos pelo destinatário (bens usados > 150 € pagam na UE), frete em € a cotar. Recomendo começar com **retirada/entrega no Brasil ou por portador** e deixar envio internacional para a Fase 2, com texto explícito na página ("entrega: combinar com a Nogária"). |
| D6 | Validade do € mostrado | Hoje o valor vale "no momento da confirmação". Definir janela (ex.: 24 h) e política se a cotação oscilar > 3% até o pagamento. Sugiro: valor em € travado por 24 h após a confirmação, registrado (B-2). |
| D7 | Tradução de nome/condição do produto | IA na publicação (I-7a), com revisão opcional. Alternativa barata: só condição/badge traduzidos por dicionário fixo e nome em pt. |
| D8 | GDPR/privacidade | A página pública registra visualização (`catalogoPublico.js:104`) e chama APIs externas. Incluir aviso curto de privacidade no rodapé e trocar as chamadas por endpoint próprio (I-5). |
| D9 | Hora da cotação | Mostrar no fuso do visitante com sigla (CET/WET) e "hora de Brasília" quando for a referência BCB. |
| D10 | Idioma padrão para navegadores não pt/es | `en` (hoje cai em pt). |

## 5. Plano em fases

Esforço: P ≤ 2 h · M ≤ 1 dia · G > 1 dia. Tudo validado localmente (`npm test`, `vite build`, Supabase local) antes de um único push.

### Fase 0 — antes de divulgar no grupo (correções)

| Item | Esforço | Risco | Critério de aceite |
|---|---|---|---|
| 0.1 `BR_PARA_EU = 2` (D2), `cardOgOferta` usando `tamanhoExibicao` (I-1), `tamanhoExibicao` em `portfolio.js`/`PortfolioScreen.jsx` (I-2), etiqueta "EU 40 · BR 38" (I-3); atualizar `test_oferta.mjs` | P | Baixo (só exibição; dado cru intacto) | "38 BR" → "EU 40" em tela, etiqueta, página e imagens (1 e vários itens); roupa "42" segue "42"; etiqueta impressa em 29 mm legível (foto da impressão) |
| 0.2 Tratar falha de cotação (B-3): sem spinner infinito, botão de envio com "€ a confirmar", `AbortSignal.timeout` | P | Baixo | Com rede das APIs bloqueada, a página mostra R$ +20%, aviso e permite enviar mensagem |
| 0.3 Registrar o valor combinado (B-2 mínimo): migration `itens.{moeda, valor_eur, cotacao, cotacao_em}` e `orcamentos.{moeda, valor_eur, cotacao, cotacao_em}`; campos no card Venda do `ItemDetail` e no pagamento da sacola | M | Médio (migration em produção; aprovação Pedro/Bárbara) | Venda em € gravada com cotação e data; Dashboard/lucro continuam em R$ (`valor_vendido`) |
| 0.4 Decidir D1 e aplicar: se links separados, nenhuma mudança de código; se grupo único, remover o R$ da página/preview euro e guardar no payload só o valor acrescido | P–M | Baixo | Brasileiro nunca vê R$ +20% / acréscimo não dedutível do payload |
| 0.5 `api/cotacao.js` como fonte única com cache 60 s e `fonte` (I-5, I-4); `cotacao.js` passa a chamá-lo; guardar `{taxa, em, fonte}` no payload na publicação (M-3) | M | Médio (nova function Vercel; vale uma invocação por abertura de link — baixo custo) | Publicação, página e confirmação usam a mesma fonte; log mostra 1 chamada externa/min no máximo; teste Node com fetch mockado |
| 0.6 Formato europeu (I-6): `259,80 €`, hora no fuso do visitante com sigla, `pt-PT`/outros → mapeamento, padrão `en`, `lang`/`og:locale` dinâmicos no `og.js` quando `payload.euro` | P | Baixo | Navegador pt-PT/es-ES/en-GB: moeda, hora e idioma corretos; snapshot de HTML do og.js com `og:locale` `es_ES` |
| 0.7 Modo euro no `gerarLinkGrupo` (I-10) e reuso da cotação da publicação (I-11) | P | Baixo | Link gerado do ItemDetail com toggle €; sem segunda chamada de cotação |
| 0.8 Commit separado da mudança de CI e limpeza de `scripts/out` (M-8, M-9) | P | — | `git status` limpo; working tree da feature só com arquivos da feature |

### Fase 1 — operação de venda para ES/PT

| Item | Esforço | Risco | Critério de aceite |
|---|---|---|---|
| 1.1 Pedido registrado no servidor: tabela `interesses` + RPC anônima `registrar_interesse(slug, sku, lang)` que calcula no servidor e devolve código; mensagem ao WhatsApp traz o código; tela "Pedidos" (ou aba nas Sacolas) para a Bárbara conferir e converter em venda | G | Médio (RLS; abuso de RPC anônima → limitar por slug válido e rate limit simples) | Cliente envia "Pedido #A1B2"; a Bárbara abre o pedido e vê €, R$, cotação, hora; "Vender" preenche o card com esses valores |
| 1.2 Tradução do conteúdo do produto (D7): `itens.i18n` jsonb preenchido por IA na primeira publicação euro, com cache; página usa `i18n[lang]` com fallback pt | M–G | Médio (custo de IA por SKU, qualidade) | Produto publicado em euro mostra nome/condição em es/en; segunda publicação não chama IA |
| 1.3 Pagamento e entrega na página (D4, D5): bloco "Como pagar / Como receber" por idioma, lido de `empresa_config`; incluído na mensagem de confirmação | P–M | Baixo | Texto configurável sem deploy; aparece nos 3 idiomas |
| 1.4 Janela de validade do € (D6): `interesses.valido_ate`; a Bárbara vê "vencido" e recalcula pelo app | P | Baixo | Pedido com > 24 h aparece marcado e com botão "recalcular" |
| 1.5 Aviso de privacidade curto no rodapé da página pública (D8) + `registrarVisualizacao` sem IP/UA | P | Baixo | Rodapé em 3 idiomas; nenhuma chamada externa do navegador do cliente |
| 1.6 Mensagem do grupo compacta (I-8) e og:description por idioma (I-9) — opção "idioma do link" (pt/es/en) na publicação | P | Baixo | Texto ≤ 250 caracteres; description ≤ 160 com condição e marca visíveis |
| 1.7 Testes: `cotacao` mockado, `labelsCore` em Node, Playwright local para `/p/<slug>` (falha de cotação, modal, idioma) | M | — | `npm test` cobre os cenários; Playwright roda no gate local |

### Fase 2 — melhorias

| Item | Esforço | Risco | Critério de aceite |
|---|---|---|---|
| 2.1 `ACRESCIMO_EURO` e arredondamento (M-1, M-2) em `empresa_config` | P | Baixo | Alterar no app reflete no próximo link |
| 2.2 Envio internacional (D5): frete em € por faixa de peso (`itens.peso_kg` já existe), aviso de IVA/alfândega por país, status "ENVIADO" com rastreio | G | Alto (regra fiscal) | Página mostra frete estimado em € e aviso de impostos; venda guarda rastreio |
| 2.3 Tamanho cru no payload e conversão na página (M-7); override por item (`tamanho_eu`) | P | Baixo | Mudar a tabela corrige links vivos |
| 2.4 Catálogo PDF / anúncio com EU+BR e idioma (hoje só `anuncioTemplate.js:33` converte) | M | Baixo | PDF em es/en com numeração EU |
| 2.5 Observabilidade: log de cotação usada por publicação/pedido e alerta se a diferença entre fontes > 2% | P | Baixo | Tabela `cotacoes` consultável |
| 2.6 Idioma pt-PT próprio (dicionário) se o público português pedir | P | Baixo | `pt-PT` escolhe textos próprios |

## 6. Verificações executadas

- `npm test`: 558 asserções, exit 0 (inclui `test:oferta` com os testes de numeração do working tree).
- `npx vite build`: exit 0 (aviso de chunk > 500 kB, pré-existente).
- Nenhum arquivo de código alterado; nenhum deploy, commit, push ou acesso de escrita a produção.

## 7. Status da implementação (31/10/2026)

Decisões do dono que mudaram o plano: conversão **EU = BR + 2** (tabela de mercado, sem medir palmilha); **um único link** para brasileiros e europeus (seletor BR/EU na página; cartão e texto do grupo com "€ · R$"); pagamento por **transferência para conta na Espanha** (€) ou **Pix** (R$).

| Item | Status | Onde |
|---|---|---|
| 0.1 BR→EU +2, imagem de oferta, etiqueta "EU 40 · BR 38" | Feito | `tamanhos.js`, `cardCore.js`, `labels.js`, `LabelCard.jsx` |
| 0.2 Falha de cotação sem spinner infinito, timeout 4 s | Feito | `ProdutoPublicoView.jsx`, `cotacao.js` |
| 0.3 Registro da venda em € (valor, cotação, hora) | Feito (itens); sacolas ficaram de fora | migration `20261031120000`, `ItemDetail.jsx` |
| 0.4 Um link para os dois públicos; R$ +20% nunca mostrado | Feito | `ProdutoPublicoView.jsx`, `precoEuro.js` |
| 0.5 Fonte única de cotação + cotação guardada no payload | Feito | `api/cotacao.js`, `ofertaPublica.js` |
| 0.6 Formato europeu (`259,80 €`), hora em UTC/fuso do visitante, `lang` dinâmico, padrão `en` | Feito (exceto `og:locale` dinâmico) | `precoEuro.js`, `ProdutoPublicoView.jsx` |
| 0.7 Link do item/portfólio com € por padrão; cotação reaproveitada | Feito | `ofertaPublica.js`, `ItemDetail.jsx`, `PortfolioScreen.jsx`, `CatalogoRapidoModal.jsx` |
| 1.1 Pedido registrado no servidor com código + tela de conferência | Feito | migration `20261031130000`, `interesses.js`, `PedidosEuroScreen.jsx` |
| 1.2 Tradução do conteúdo | Parcial: selo e frase de condição em 3 idiomas; **nome do produto segue em pt** (IA por SKU ficou para depois) | `precoEuro.js` |
| 1.3 Como pagar / entrega | Feito com texto genérico (sem dados bancários) | `precoEuro.js` |
| 1.4 Validade 24 h do pedido | Feito (marca "vencido" e recalcula na tela) | `interesses.js`, `PedidosEuroScreen.jsx` |
| 1.5 Aviso de privacidade; página sem terceiros no navegador | Feito | `ProdutoPublicoView.jsx` |
| 1.6 Mensagem do grupo compacta | Feito | `precoEuro.js` |
| 1.7 Testes (cotação simulada, formatos, idioma, tradução) | Feito; faltam Playwright da página e `labels.js` em Node | `scripts/test_oferta.mjs` |
| 2.3 Numeração crua no payload, conversão na página | Feito | `ofertaCore.js`, `ProdutoPublicoView.jsx` |
| 2.1 Acréscimo/arredondamento configuráveis; 2.2 envio internacional; 2.4 PDF em es/en; 2.5 log de cotações; 2.6 pt-PT próprio | Pendente | — |

Cotação do pedido: vem da tabela `cotacoes`, gravada só pela Edge Function `cotacao` (service role); a RPC `registrar_interesse` não aceita taxa do cliente (revisão de segurança de 31/10). Exige cotação de até 15 min; sem ela o pedido segue sem código. Nome do produto e cor continuam em português. `og:locale` segue `pt_BR`.

Deploy: aplicar as duas migrations (aprovação Pedro/Bárbara), publicar a Edge Function (`supabase functions deploy cotacao --no-verify-jwt`) e só então `vercel deploy --prod`.

## 8. Destinos e locais de storage cadastráveis (base internacional)

Antes: `DESTINOS` fixo em `model.js` (Belém, SP storage, Venda local SP, A definir) e "Local físico" em texto livre. Agora:

- **Tabelas** `destinos` (nome, `internacional`, país, ativo, ordem) e `locais_storage` (destino, nome, ativo) — migration `20261031140000_destinos_locais.sql`, semeada com os 4 destinos atuais. `itens.destino` segue texto livre (sem FK): desativar ou criar destino não altera itens existentes.
- **Lista viva**: `carregarDestinos()` (`src/lib/destinos.js`) atualiza `DESTINOS` no lugar e as opções da planilha; as telas que já importam `DESTINOS` (itens, caixas, conferência, planilha, portfólio, novo item, card de preço) passam a refletir o cadastro. Sem a tabela (migration pendente) ou sem rede, vale a lista padrão — o app não quebra.
- **Tela** "Destinos e locais de storage" (Painel): criar destino (nome, país, marcar **Internacional**), criar locais por destino, desativar/reativar, e contagem de itens por destino. Destinos internacionais aparecem com o ícone de globo. Sugestões de local no campo "Local físico" do card de preço.
- **Preço**: o destino é informativo no motor de preço v2 (a margem mínima é única), então destinos novos não alteram o preço.
- **Filtro internacional**: "🌍 Somente internacionais" nas abas Itens e Catálogo e no catálogo rápido (checkbox que restringe os itens do PDF, links e textos); o Painel marca os destinos internacionais com 🌍.
- **Gestão**: renomear destino (atualiza `itens`, `caixas` e `locais_storage` que usavam o nome, com confirmação e contagem) e reordenar com setas. "A definir" não é renomeável nem desativável.
- **Limites**: salas físicas continuam no módulo Salas; renomear destino faz UPDATE em lote nas tabelas citadas (se falhar no meio, a mensagem pede repetir).
- **Deploy**: aplicar a migration antes do deploy; sem ela a tela mostra aviso e as listas ficam no padrão.
