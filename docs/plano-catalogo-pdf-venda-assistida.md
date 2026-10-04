# Plano — Catálogo PDF, divulgação e venda assistida

Data: 2026-10-03 · Status: proposta (nada implementado) · Autor: análise assistida

Objetivo do usuário: o vendedor seleciona produtos (ou uma sala), escolhe um layout, gera o
catálogo/orçamento em poucos cliques e envia/mostra ao cliente (WhatsApp, link, PDF), com preço
já pronto e defensável. Venda assistida e rápida.

---

## 1. O que JÁ existe no código (não duplicar)

| Área | Onde | O que faz | Limites hoje |
|---|---|---|---|
| Catálogo PDF de marca | `src/screens/PortfolioScreen.jsx` (aba "Catálogo"), `src/lib/catalogo.js`, `catalogoCore.js`, `catalogoTemplate.js`, `catalogoImagens.js` + `catalogoWorker.js` | Filtros (lote/classe/status/grupo/destino/caixa/busca) → só itens com `preco_ideal > 0` e `estado` mapeado → dedup (`dedupCatalogo`) → seções por categoria/tamanho/lote/marca (`agruparCatalogo`) → HTML A4 (capa, cabeçalho, grade 2 col, selo de condição, preço, "N disponíveis", rodapé numerado, bloco "parcial") → `imprimirPortfolio` (iframe + `window.print`, "Salvar como PDF"). Fotos comprimidas em Web Worker com progresso/cancelar. | Entrada só por filtro (não por seleção manual nem por sala). Sem QR/link por item, sem contato do vendedor, sem "de/por", sem lista de preços compacta. O PDF não é um arquivo: depende do diálogo de impressão (frágil no iOS Safari em iframe). Nada é persistido. |
| Catálogo público (link) | `src/lib/catalogoPublico.js`, `src/screens/CatalogoPublicoView.jsx`, rota `/c/<slug>` em `src/main.jsx`, tabela `catalogos_publicos` (slug, payload jsonb, `expira_em` 30 d, RLS anon só não expirados) | Snapshot autocontido com signed URLs de 30 d; página sem login, grade responsiva com selo/preço/qtd. | Sem CTA (WhatsApp) por item, sem SKU no payload, sem contador de visualizações, sem vendedor, sem "quero este". |
| Orçamento multi-produto | `src/lib/selecao.js` (Map sku→item, sobrevive a filtro/paginação), `src/lib/anuncio.js` (`montarOrcamento`, `LIMITE_ORCAMENTO=10`), `src/lib/anuncioTemplate.js` (`sheetAnuncio` 1 página A4/item, specs, preço, QR `wa.me` do item, CTA), `src/components/AnuncioModal.jsx` (Copiar msg / WhatsApp / Salvar PDF), `src/lib/empresa.js` (`EMPRESA`, `waLink`, `waLinkSemDestino`) | Seleção em massa no `ItemsScreen` → PDF 1 folha/produto + texto pronto (`mensagemOrcamento`: linhas + Total) | Não persiste o orçamento, não reserva, não vira pedido. Contato único da empresa (não há vendedor). Limite 10 itens. |
| Vendas | `src/lib/vendas.js`, `src/screens/VendasScreen.jsx` | `registrarVenda` grava em `itens` (valor, canal, comprador, `pedido_ref`, status `VENDIDO`), `marcarEntregue`, agregados por canal/lote. | Sem tabela de pedidos/reservas; 1 SKU = 1 unidade; sem status RESERVADO (`STATUS_FLOW` em `model.js`). |
| Salas / Caixas | `src/lib/salas.js` (`conteudoSala`), `src/screens/SalasScreen.jsx`, `caixas.js` | Sala = local físico com caixas + itens soltos; eventos. | Não existe "catálogo da sala" nem "combo da sala". |
| Precificação | `src/lib/pricing.js` (`precificar`: ref × fCond × fEmb × fRisco; piso = custos ÷ (1−taxa−reserva−margem)), `pricingParams.js` (tabelas `pricing_*`), `precoView.js` (`derivarPreco`: memória de cálculo, flags "abaixo do piso"), `classificacao.js` (A+/A/B/C/D/E por valor/volume/condição), `components/PricingCard.jsx`, view `vw_precificacao` | Preço recomendado (teto) e piso por canal; operador aplica `preco_ideal`. IA (`iaAnalise.js`, edge `enriquecer-produto`) sugere título/descrição/preço. | Sem desconto por tempo parado, sem arredondamento psicológico, sem aprovação formal, sem preço "de" (referência de novo existe em `preco_ref_novo`/`preco_ref_fonte` mas não é exibido ao cliente), sem aplicação em massa. |
| Etiquetas PDF | `src/lib/labelPdf.js` (jsPDF vetorial + QR via `qrcode`) | Prova que `jspdf` e `qrcode` já estão no bundle e o padrão de desenho em mm funciona. | — |
| Infra | `vercel.json` (SPA estática, deploy só por CLI, sem functions), Supabase edge functions (`enriquecer-produto`, `precos-mercado`, `publicar-amazon`, `amazon-listings`, `ml-notifications`), bucket privado `fotos-produtos` (signed URLs) | — | Não há API serverless própria; custo atual de compute ≈ 0. |
| Testes | `scripts/test_*.mjs` (Node puro, `npm run test:*`), módulos "Core" separados do cliente Supabase | — | — |

Conclusão: ~70 % do fluxo "selecionar → PDF → WhatsApp" existe em partes desconectadas. O plano liga as
partes (seleção/sala → catálogo), troca a geração do PDF por arquivo real compartilhável, adiciona regras
de preço rápido e persiste o orçamento como objeto de venda.

---

## 2. Pesquisa — como o mercado faz (só o que foi encontrado)

### 2.1 Catálogo e distribuição
- **WhatsApp Business Catalog**: vitrine dentro do app com nome, preço, descrição, código e link; "coleções" organizam o catálogo; mensagens de catálogo têm botão "Ver catálogo". Na API, uma *multi-product message* leva até **30 produtos em seções** e o carrossel até **10 cards** ([WhatsApp blog](https://blog.whatsapp.com/introducing-catalogs-for-small-businesses), [Meta docs](https://developers.facebook.com/documentation/business-messaging/whatsapp/catalogs/share-products), [guia 2026](https://www.theconvertway.com/blog/how-to-make-catalogue-in-whatsapp)). Sincronização só pelo app WhatsApp Business, não pela versão pessoal ([Tiendanube ajuda](https://ayuda.tiendanube.com/whatsapp/como-conectar-tu-catalogo-de-productos-con-whatsapp-business)).
- **Nuvemshop/Tiendanube**: app "Abejita PDF Product Catalog" gera PDF/flipbook com os produtos da loja, layouts personalizáveis e **um link para compartilhar por WhatsApp/e-mail sem anexar arquivo pesado** ([Nuvemshop](https://www.nuvemshop.com.br/loja-aplicativos-nuvem/abejita-pdf-product-catalog)). Guia Nuvemshop de catálogo no WhatsApp ([link](https://www.nuvemshop.com.br/blog/catalogo-whatsapp/)).
- **Bling/Tiny**: integrações sincronizam preço/estoque do ERP com o catálogo do WhatsApp e geram orçamento/pedido a partir do chat ([socialhub](https://www.socialhub.pro/?p=26826)).
- **WhatsApp**: documentos (PDF) até **2 GB**; mídia (foto/vídeo) 16 MB ([infobae](https://www.infobae.com/en/2022/03/23/whatsapp-increases-the-size-of-documents-that-can-be-sent-to-2-gb)). Logo, PDF de 3–8 MB é aceitável, mas imagem de card deve ficar < 16 MB (fácil).
- **Mobly outlet**: produtos com pequenas avarias, retirada imediata e **etiqueta com QR code** para consultar informação/preço ([Mercado&Consumo](https://mercadoeconsumo.com.br/27/01/2022/destaque-do-dia/mobly-vai-abrir-showroom-dentro-de-outlet-liquitudo-no-interior-de-sao-paulo/)). Mobly adquiriu 61 % da Tok&Stok em 2024 ([Mercado&Consumo](https://mercadoeconsumo.com.br/12/11/2024/noticias-varejo/mobly-conclui-aquisicao-da-tokstok-e-fortalece-sua-posicao-no-segmento-de-moveis-e-decoracao/)).

### 2.2 Precificação de outlet/open-box/usado
- **Faixas por grade** (eletrônicos recondicionados/open-box): Grade A/Excelente 5–15 % (até 15–25 %) abaixo do varejo; B/Bom 15–25 % (até 25–35 %); C/Regular 25–40 % (até 35–50 %) ([refurb.me](https://www.refurb.me/blog/what-are-refurbished-grades-a-b-c), [ConsumerAffairs](https://www.consumeraffairs.com/news/open-box-vs-refurb-vs-renewed-the-real-differences-when-buying-electronics-102425.html), [KnowYourMobile](https://www.knowyourmobile.com/phones/refurbished-smartphones/refurbished-phone-grades-explained/)).
- **Wayfair Open Box** (móveis): devoluções em estado quase novo com 20–40 % off (até 70–75 % em promoções); mostra **preço original e preço open-box lado a lado**; nos outlets físicos começa ~50 % off e **o desconto aprofunda quanto mais tempo o item fica parado** ([Real Homes](https://www.realhomes.com/news/wayfair-open-box), [Hoodline 2026](https://hoodline.com/2026/08/wayfair-doubles-down-in-central-ohio-with-new-dublin-discount-outlet/)).
- **B-Stock** (liquidação B2B): condições padronizadas New / Like New / Refurbished / Used-Good / Used-Fair / Salvage ([B-Stock](https://bstock.com/supplystore/conditions/)). **Back Market**: 4 níveis visíveis ao comprador (Premium, Excelente, Muito bom, Bom) mapeados de até 6 grades do vendedor ([Sellermania](https://www.sellermania.com/en/blog/refurbished/back-market-seller-grades-marketplaces/)). Lição: grade **interna** (A+/A/B/C) ≠ rótulo **para o cliente** (já é o que `CATALOGO_ESTADO_BADGE` faz).
- **Markdown por idade de estoque**: regra em faixas, ex. 10 % entre 30–60 dias e 25 % a partir de 60 ([Aravenda](https://help.aravenda.com/portal/en/kb/articles/inventory-aging-price-markdown-automatic-price-reductions-discounts), [EDGE](https://edgeuser.com/Knowledge/Knowledge-Base/inventory-aged-inventory-management-aims-initial-setup), [Racklify](https://racklify.com/encyclopedia/markdown-pricing-strategies-for-retail-and-e-commerce/)). A contagem pode partir da data de criação ou da data em que ficou à venda — o Aravenda oferece as duas.
- **Charm pricing**: preços terminados em 9 vendem mais (estudo clássico: camisa a $39 vendeu mais que a $34 e $44); 30–65 % dos preços de varejo terminam em 9; **para itens caros, preço redondo transmite qualidade** ([WARC](https://cdn.warc.com/newsandopinion/opinion/nine-thats-a-magic-number/2050), [business.com](https://www.business.com/articles/the-game-of-pricing-how-the-number-9-affects-purchase-behavior/), [thom.eu](https://thom.eu/resources/points-of-view/5-psychological-mechanisms-to-increase-the-effectiveness-of-your-pricing-strategy/)).
- **Bundles de ambiente** (móveis): pacotes por cômodo com preço por peça decrescente conforme o nº de itens; reduz fadiga de decisão ([Urban Underpriced](https://markets.financialcontent.com/lightport.lightport3/article/pressadvantage-2025-12-8-urban-underpriced-announces-winter-furniture-bundle-program-across-five-locations), [ChargeOver](https://chargeover.com/blog/bundle-pricing)).
- **Brasil — exibição de preço**: Lei 10.962/2004 exige preço à vista visível e, no parcelado, condições claras; oferta vincula (CDC art. 30) e, havendo dois preços, vale o menor ([Correio 24h](https://www.correio24horas.com.br/minha-bahia/preco-duplicado-no-produto-saiba-o-que-fazer-e-quais-sao-os-direitos-do-consumidor-0825), [Migalhas](https://www.migalhas.com.br/depeso/416664/cuidado-com-o-preco-cobrado-na-etiqueta)). Há Nota Técnica Procon-MPMG nº 1 (set/2025) sobre modalidades de precificação ([PDF](https://www.mpmg.mp.br/data/files/C6/63/6F/D3/65F299106BD6B299BAA8F9C2/Nota%20tecnica%20n%201%20-%20Modalidades%20de%20precificacao%20em%20produtos%20e%20servicos%20-%20regra%20geral%20e%20excecoes_Procon-MPMG_08%20set%202025.pdf)) — não consegui extrair o texto; **não afirmo** regra específica sobre "de/por". Implicação prática: só mostrar "de R$ X" quando X for um preço real e rastreável (ex.: `preco_ref_novo` com `preco_ref_fonte`), rotulado como "preço de novo (referência)".

### 2.3 Geração de PDF e custo
- **Cliente vs servidor**: client-side (jsPDF/html2pdf) não tem custo de servidor e roda offline; Puppeteer dá fidelidade de navegador mas exige `puppeteer-core` + `@sparticuz/chromium-min` para caber no limite de 250 MB da function ([Vercel KB](https://vercel.com/kb/guide/deploying-puppeteer-with-nextjs-on-vercel), [Vercel limits](https://vercel.com/docs/functions/limitations), [Nutrient](https://www.nutrient.io/blog/javascript-pdf-libraries/)).
- **Vercel Fluid Compute**: Hobby inclui 4 h de Active CPU, 360 GB-h e 1 M invocações (e para de servir ao estourar); Pro cobra desde o 1º byte: US$ 0,128/CPU-h (EUA) a **US$ 0,221/CPU-h em São Paulo** + memória provisionada ([Makerkit 2026](https://makerkit.dev/blog/saas/vercel-cost), [Vercel pricing](https://blog.vercel.com/docs/fluid-compute/pricing)).
- **Supabase**: Free 500 k invocações de edge functions, 1 GB storage, 5 GB egress; Pro US$ 25 com 100 GB storage e 250 GB egress, depois US$ 0,09/GB ([jetadmin 2026](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/), [Makerkit](https://makerkit.dev/blog/saas/supabase-pricing)).
- **iOS Safari**: impressão via iframe funciona no desktop mas não no mobile; html2canvas+jsPDF no Safari pode levar 25–30 s contra 1–2 s no Chrome ([Pega](https://community.pega.com/support/support-articles/unable-save-excel-file-pdf-exporting-pdf), [Luminix](https://luminix.atlassian.net/wiki/x/CoB8oQ)). Ou seja: evitar `window.print` em iframe e evitar rasterizar o DOM; desenhar o PDF **vetorialmente** com jsPDF (texto) + JPEG já comprimido (fotos) — exatamente o padrão de `labelPdf.js`.

---

## 3. Lacunas (pesquisa × código)

1. **Entrada do catálogo**: só por filtro. Falta "Catálogo (N)" na seleção do `ItemsScreen` e "Catálogo da sala" no `SalasScreen`.
2. **PDF como arquivo**: hoje é diálogo de impressão. Falta gerar `Blob` PDF e usar `navigator.share({files})` (abre WhatsApp direto no celular) ou download; opcionalmente guardar no Storage para link curto.
3. **Templates**: só "grade 2 col". Faltam lista de preços compacta (3–4 col, sem foto grande), ficha 1/página reusando `sheetAnuncio`, capa com contato do vendedor, QR por card.
4. **Vendedor**: contato único (`EMPRESA`). Falta vendedor por usuário (nome, WhatsApp) no PDF, QR e link.
5. **Preço "de/por" e condição**: `preco_ref_novo` nunca chega ao cliente; selo existe, mas sem frase de condição ("caixa aberta, produto novo").
6. **Preço rápido**: sem markdown por idade, arredondamento, piso de margem automático na aplicação em massa, aprovação de exceção.
7. **Venda assistida**: orçamento não é persistido, não reserva item, não vira venda com um clique; link público não tem "quero este".
8. **Divulgação**: sem texto pronto para Instagram/grupos, sem card de imagem, sem métricas do link.
9. **Combos/sala**: sem preço de combo.

---

## 4. Decisões de arquitetura

### 4.1 Geração do PDF: **client-side com jsPDF (vetorial) — sem serverless**
Justificativa:
- Custo zero de compute (Vercel só serve estático; Supabase só storage/egress). Puppeteer em Vercel exigiria Pro, bundle especial e pagaria CPU por catálogo (São Paulo é a região mais cara); edge function Deno não roda Chromium.
- `jspdf` e `qrcode` já estão em `package.json`, e `labelPdf.js` já tem o padrão (mm, `addImage`, `splitTextToSize`). Fotos já saem comprimidas (JPEG, `MAX_LADO`/`JPEG_QUALITY` em `catalogoImagensCore.js`) do Worker.
- Resolve o iOS: `Blob` → `navigator.share({ files: [File] })` (Safari iOS 15+) com fallback para download (`URL.createObjectURL`). Sem rasterizar DOM (html2canvas lento no Safari).
- Mantém o HTML atual (`gerarCatalogoHTML`) como **prévia na tela** e como fallback de impressão no desktop; o PDF jsPDF é a saída para compartilhar.
- Estimativa de tamanho: 60 cards com foto 800 px JPEG q0,8 ≈ 60 × 60 KB ≈ 3,6 MB + texto. Dentro do confortável para WhatsApp.

Opção B (não escolhida agora, fácil de ligar depois): salvar o PDF no bucket privado `catalogos` e compartilhar signed URL de 30 d. Custo: 100 catálogos/mês × 4 MB × 10 aberturas ≈ 4 GB de egress/mês — dentro do Free (5 GB) apertado, folgado no Pro (250 GB). Ligar só se o link virar o canal principal.

### 4.2 Link público: estender `catalogos_publicos` (snapshot) em vez de abrir `itens` para anônimo
Payload `versao: 2` com `sku`, `fotos[]` (até 3 signed URLs), `condicaoTexto`, `precoDe`, `vendedor {nome, whatsapp}`. A página `/c/<slug>` ganha modal por card e botão "Quero este" → `wa.me/<vendedor>?text=...SKU...`. RLS continua a mesma (anon lê só o snapshot).

### 4.3 Orçamento vira entidade (`orcamentos`) com reserva leve
Reserva **não** entra em `STATUS_FLOW` (evitaria tocar filtros, catálogo, conferência, export). Em vez disso: `itens.reservado_ate` + `itens.reservado_por_orc`. Catálogo/portfólio/orçamento excluem itens com `reservado_ate > now()`; a conversão em venda chama `registrarVenda` (já existe) com `pedido_ref = ORC-####`.

### 4.4 Preço rápido: regras puras em `src/lib/precoRapido.js`, parâmetros no banco
Reusa `precificar`/`derivarPreco` (teto e piso). Camada nova aplica: markdown por idade → arredondamento → clamp no piso → flag de aprovação. Em massa, pela seleção já existente.

---

## 5. Fluxo do vendedor (alvo)

1. **Seleciona**: na aba Itens (seleção em massa) **ou** abre uma Sala → "Catálogo da sala" **ou** usa os filtros da aba Catálogo.
2. **Escolhe layout**: Grade (atual) · Lista de preços · Ficha por produto (orçamento) · Card Instagram.
3. **Ajusta** (opcional): mostrar preço, "de/por", título/edição, vendedor (pré-preenchido pelo login), validade.
4. **Gera**: PDF (arquivo) · Link público · Texto pronto. Barra inferior com 3 botões.
5. **Compartilha**: `navigator.share` (WhatsApp/Instagram) ou copia link/texto.
6. **Vende**: cliente responde → vendedor abre o orçamento (ORC-0012) → Reservar (48 h) → Confirmar venda (gera `registrarVenda` por SKU) → Entregue.

---

## 6. Templates de catálogo (jsPDF, A4 retrato, mm)

| Template | Uso | Conteúdo |
|---|---|---|
| **Capa** | todos | Logo, título, edição, "N produtos", vendedor (nome + WhatsApp + QR `wa.me`), validade dos preços, tagline. |
| **Grade** (padrão) | catálogo geral | 2×3 cards/página: foto 34 mm, nome, marca·modelo, selo de condição, **preço por** grande, "de R$ X (novo)" riscado só se houver referência com fonte, "N disponíveis", QR pequeno (wa.me com SKU) e SKU. Seções com cabeçalho (categoria/sala). |
| **Lista de preços** | atacado / muitos itens | Tabela 1 linha/item: miniatura 14 mm, SKU, produto, condição, preço, qtd. ~22 linhas/página. |
| **Ficha** | orçamento, item A+ | Reusa o layout de `sheetAnuncio` (foto grande, galeria, specs, preço, condição, CTA + QR). Portar para jsPDF ou manter HTML (ver fase 1). |
| **Fechamento** | todos | Condições (pagamento `PAGAMENTO_PADRAO`, entrega `ENTREGA_PADRAO`), observação de condição ("outlet: produtos novos de caixa aberta, seminovos testados; fotos reais"), contato. |
| **Card 1080×1080** | Instagram/WhatsApp status | Canvas: foto, selo, nome, preço, logo. PNG < 1 MB. |

Rótulos de condição ao cliente seguem `CATALOGO_ESTADO_BADGE` (Novo · Caixa aberta · Seminovo · Como está) + frase curta por `cond_embalagem` (`embalagemLabel`).

---

## 6A. Motor de geração v2 — flexível, multi-formato e com contato

Hoje o catálogo tem um caminho fixo (filtro → HTML A4 grade 2 col → diálogo de impressão). A v2 troca isso por um **motor declarativo**: o vendedor escolhe *conteúdo + modelo + formato + contato*, e o mesmo conjunto de dados gera todas as saídas.

### 6A.1 Arquitetura do motor

```
Fonte (seleção | sala | filtros | orçamento)
   → listarItensCatalogo({skus|salaId|filtros})        [existe, F0]
   → normalizar → dedup → agrupar → ordenar            [catalogoCore, puro]
   → CatalogoSpec { modelo, formato, opcoes, contato } [novo, puro, validado]
   → renderizador por formato:
        PDF (jsPDF)  | HTML/impressão | PNG (canvas) | Texto (WhatsApp/IG) | Link público | CSV
```

- `src/lib/catalogoSpec.js` (puro): schema + defaults + validação da spec; `specPadrao(modelo)`; serializável (jsonb) para **salvar predefinições** ("Catálogo de sala", "Lista atacado").
- Renderizadores independentes e plugáveis (`renderPdf`, `renderCardPng`, `renderTexto`, `renderLink`); adicionar um formato não toca nos outros.
- Mesmo `CatalogoSpec` alimenta prévia (HTML) e arquivo final → o que o vendedor vê é o que sai.

### 6A.2 Opções que o usuário controla (tela "Montar catálogo")

| Grupo | Opções |
|---|---|
| **Conteúdo** | fonte (seleção, sala, filtros, orçamento); incluir/excluir itens por checkbox; ordem (preço ↑↓, categoria, SKU, mais antigos primeiro, manual por arrastar); agrupar por (categoria, sala, marca, lote, tamanho, condição, faixa de preço); limite de itens |
| **Campos por item** | foto (1 ou galeria), nome, marca/modelo, medidas, voltagem, cor, condição + frase, SKU, quantidade, preço "por", "de/por" (só com referência rastreável), parcelamento, observação livre por item |
| **Preço** | mostrar/ocultar; "sob consulta"; desconto do catálogo (% global ou por faixa); preço de combo (sala); validade dos preços |
| **Visual** | modelo; tema de cor (azul-noite / azul / claro / verde — paleta do manual); fonte Sora; capa sim/não; fechamento sim/não; colunas (1–4) e tamanho da foto; densidade (compacto/confortável); logo (cor/branco) |
| **Textos** | título, subtítulo, edição, mensagem de abertura, condições de pagamento/entrega, aviso de condição ("outlet: itens com condição descrita"), rodapé |
| **Contato** | ver 6A.4 |
| **Saída** | formato (6A.3), nome do arquivo, enviar agora (Web Share) ou baixar; salvar predefinição |

### 6A.3 Modelos × formatos

| Modelo | PDF A4 | Imagem (PNG) | Texto | Link |
|---|---|---|---|---|
| **Catálogo completo** (capa + grade + fechamento) | ✔ | — | resumo | ✔ |
| **Lista de preços** (tabela compacta, atacado) | ✔ | — | ✔ lista | ✔ |
| **Ficha do produto** (1 por página, galeria) | ✔ | — | ✔ | ✔ |
| **Combo / Sala** (preço de combo, itens da sala) | ✔ | ✔ | ✔ | ✔ |
| **Lançamento / Oferta do dia** (1–4 produtos) | ✔ A5 | ✔ | ✔ | ✔ |
| **Instagram Feed** 1080×1350 (4:5) | — | ✔ | legenda + hashtags | — |
| **Instagram Story/Reels capa** 1080×1920 | — | ✔ | — | sticker de link |
| **Instagram Carrossel** (capa + N slides 1080×1350 + CTA) | ✔ (PDF) | ✔ (N PNG/ZIP) | legenda | — |
| **WhatsApp Status** 1080×1920 | — | ✔ | — | — |
| **WhatsApp mensagem** (texto + link; ≤ 30 itens, espelha o "multi-product message") | — | opcional | ✔ | ✔ |
| **Planilha** (CSV: nome, preço, descrição, código, link — importável no WhatsApp Business/ML) | — | — | — | CSV |

Detalhes de formato:
- **Instagram**: 1080×1350 (feed 4:5), 1080×1920 (story), margem de segurança de 250 px topo/base nos stories; PNG < 1 MB; legenda ≤ 2.200 caracteres, até 30 hashtags (sugerir 8–12 por grupo); carrossel até 10 slides.
- **WhatsApp**: PDF 3–8 MB (limite do app: 2 GB); imagem por `navigator.share`; texto com emoji discreto, preço em negrito (`*R$ 890*`) e **link do item** (`/c/<slug>#<sku>`).
- **PDF por outros meios**: download, e-mail (`mailto:` com anexo não é possível → Web Share ou link), impressão, e link assinado do bucket (Opção B, 4.1) para colar em qualquer canal.
- Renderizador de imagem: `<canvas>` com fonte Sora (carregada via `FontFace`), mesmos tokens do manual; sem rede além das fotos já em memória.

### 6A.4 Contato com a Nogária (em todas as saídas)

Princípio: **toda peça tem pelo menos 2 caminhos de contato, um clicável e um escaneável**.

| Canal | Onde aparece | Como funciona |
|---|---|---|
| **WhatsApp geral** (`EMPRESA.whatsapp`) | capa, fechamento, rodapé de cada página, texto | `wa.me/<n>?text=` com mensagem pré-preenchida |
| **WhatsApp do vendedor** | capa, fechamento, QR | vendedor logado (M1); fallback no geral |
| **QR por item** | cada card (F0 ✔), ficha, slide | mensagem com **SKU + nome** → o vendedor já sabe qual item |
| **QR de catálogo** | capa, último slide, story | abre o catálogo/lista inteiro ou "falar com vendedor" |
| **Botão "Quero este" / "Falar com a Nogária"** | link público (`/c/<slug>`) | abre WhatsApp com o item; contador de cliques |
| **Instagram / site / e-mail / telefone / endereço-retirada / horário** | fechamento, rodapé, bio de story | campos configuráveis em `empresa.js` → tabela `empresa_config` (M6) editável sem deploy |
| **Link na bio** (landing única) | Instagram | `/c/<slug>` com título, 3 destaques e botão WhatsApp |

Regras: telefone/URL sempre como **texto visível + QR** (PDF impresso não tem clique); links `wa.me` com número sem formatação; contato configurável por catálogo (geral × vendedor × sala); validar número (DDI+DDD) na configuração.

### 6A.5 Usabilidade

- **Assistente de 3 passos** (Conteúdo → Modelo/Opções → Gerar/Compartilhar) com **prévia ao vivo** (iframe escalado para largura da tela, como em `AnuncioModal`).
- **Predefinições**: salvar "Meu catálogo semanal", "Atacado", "Sala X"; **1 toque** repete com dados atualizados.
- **Modo rápido** (padrão): seleção → "Catálogo (N)" → PDF + WhatsApp com defaults bons (≤ 3 toques). **Modo avançado**: todas as opções.
- Avisos acionáveis antes de gerar: itens sem foto, sem preço, sem condição, tamanho estimado do PDF, itens reservados/vendidos.
- Gerar em **segundo plano** (Web Worker já usado nas fotos), com progresso e cancelar; resultado fica no **histórico** (últimos 20 catálogos: título, data, itens, formato, reabrir/recompartilhar).
- Acessível e mobile-first (alvos ≥ 44 px; uso com uma mão no celular do vendedor).

### 6A.6 Modelo de dados adicional (aprovação Pedro/Bárbara)

| # | Migration | Conteúdo |
|---|---|---|
| M6 | `empresa_config` | `(chave text pk, valor text)` — whatsapp, instagram, site, e-mail, telefone, endereço, horário, texto de pagamento/entrega; RLS auth full; leitura anon só das chaves públicas via view. |
| M7 | `catalogo_predefinicoes` + `catalogo_historico` | `(id, nome, spec jsonb, criado_por, criado_em)` e `(id, titulo, formato, n_itens, spec jsonb, criado_por, criado_em)`. RLS auth full. |

### 6A.7 Arquivos (novos / alterados)

**Novos**: `src/lib/catalogoSpec.js`, `src/lib/catalogoRender/{pdf,card,texto,csv}.js`, `src/lib/cardImagem.js` (canvas 1080×…), `src/lib/empresaConfig.js`, `src/components/CatalogoBuilder/{Passo1Conteudo,Passo2Modelo,Passo3Saida,Previa}.jsx`, `scripts/test_catalogospec.mjs`, `scripts/test_catalogocard.mjs`.
**Alterados**: `CatalogoRapidoModal.jsx` (vira o *modo rápido* do builder), `catalogoTemplate.js` (consome a spec: colunas, tema, campos), `empresa.js` (lê `empresa_config` com fallback atual), `divulgacao.js` (legendas por modelo), `PortfolioScreen.jsx` (abre o builder).

### 6A.8 Fases do motor v2

| Fase | Entrega | Esforço |
|---|---|---|
| **F1a** | `catalogoSpec` + renderizador PDF (jsPDF) com modelos Catálogo/Lista/Ficha, temas, colunas, campos; `compartilhar.js` | M |
| **F1b** | Builder em 3 passos com prévia ao vivo, modo rápido/avançado, predefinições e histórico (M7) | M |
| **F1c** | Contato completo: `empresa_config` (M6), QR de catálogo, rodapé/capa/fechamento com todos os canais | P |
| **F4a** | Imagens: Feed 4:5, Story 9:16, WhatsApp Status, Carrossel (ZIP/Web Share múltiplo) + legendas/hashtags | M |
| **F4b** | CSV p/ WhatsApp Business, link na bio, botão "Quero este" e contador no link público | M |

Critérios de aceite: (1) mesma spec → PDF, PNG e texto coerentes; (2) todo formato exibe ≥ 2 canais de contato; (3) seleção → PDF compartilhado em ≤ 3 toques no modo rápido; (4) predefinição reabre idêntica; (5) nenhum preço abaixo do piso ou "de" sem fonte.

Testes: `test:catalogospec` (defaults, validação, serialização), `test:catalogocard` (medidas dos formatos, truncamento, legenda ≤ 2.200, hashtags ≤ 30, margens de story), `test:catalogopdf` (paginação por modelo/colunas), além dos manuais em iOS/Android.

---

## 7. Regras de precificação rápida

Entrada: `derivarPreco(item, grupo, params, custoItem)` → `{ recomendado, piso }` (já existe). Nova camada `precoRapido.js`:

1. **Fator por grade** — já coberto por `fCond` (`NOVO_LACRADO 0,85 … SEM_TESTE 0,55`) × `fEmb` × `fRisco`. As faixas encontradas na pesquisa (A 5–25 %, B 15–35 %, C 25–50 % abaixo do novo) batem com os fatores atuais; não criar outra tabela. Apenas expor na UI a "grade de cliente" (selo) junto do fator.
2. **Desconto por tempo parado** — tabela `pricing_markdown_idade (dias_min, dias_max, pct)`; seed sugerido: 0–30 → 0 %, 31–60 → 10 %, 61–90 → 20 %, 91+ → 30 %. Base: `itens.disponivel_desde` (carimbo na 1ª vez que vira `PRONTO`/`ANUNCIADO`; backfill pelo 1º evento `status:PRONTO` em `eventos`). Aplicado sobre o `recomendado`, nunca abaixo do piso.
3. **Arredondamento psicológico** — `arredondar(p)`: < R$ 100 → termina em 9 (R$ 89); R$ 100–999 → termina em 9 na dezena (R$ 289, R$ 790); ≥ R$ 1.000 → múltiplo de 50 ou 100 (R$ 1.300) — preço redondo para itens caros, conforme pesquisa. Sempre arredonda **para baixo** até o piso.
4. **Piso de margem** — `max(precoCalculado, piso)`. Se `piso > recomendado` → item "inviável": sugestão "combo/lote" (já vem de `precificar.sugestao`).
5. **Preço "de"** — `precoDe = preco_ref_novo` só quando `preco_ref_fonte` preenchido e `precoDe > precoPor × 1,05`. Caso contrário não exibe.
6. **Aprovação** — exceções geram `itens.preco_aprovacao = 'PENDENTE'` + motivo: (a) preço manual < piso; (b) desconto total > 40 % do recomendado; (c) markdown aplicado em item classe A+. Aprovadores: Pedro e Bárbara (únicos usuários). Catálogo exclui pendentes (ou mostra "sob consulta").
7. **Combo de sala** — `salas.desconto_combo_pct` (ex.: 10 %) e `precoCombo = Σ precoPor × (1 − pct)`, respeitando Σ piso. Mostrado na capa/fechamento do catálogo da sala.
8. **Em massa** — na seleção: "Aplicar preço rápido (N)" mostra tabela SKU · atual · novo · Δ · flag; confirma → `update itens set preco_ideal` por SKU + evento `preco:rapido` com a memória (json). Reusa `PricingCard` para o caso unitário.

---

## 8. Divulgação

- `src/lib/divulgacao.js` (puro): `textoWhatsApp(itens|catalogo)` (título, N itens, 3 destaques com preço, link, validade, contato), `textoInstagram` (até 2.200 chars, hashtags por grupo), `legendaCard(item)`.
- Card PNG via `<canvas>` (`cardImagem.js`), compartilhado por `navigator.share` ou download.
- Link público com `visualizacoes` (incremento por RPC `security definer`, anon) para medir abertura.
- Catálogo WhatsApp Business (oficial) fica **fora** do escopo técnico: só é alimentado pelo app WhatsApp Business manualmente; o sistema pode exportar CSV compatível (nome, preço, descrição, código, link) como passo opcional.

---

## 9. Venda assistida (carrinho → orçamento → reserva → pedido)

Estados de `orcamentos.status`: `RASCUNHO → ENVIADO → RESERVADO → VENDIDO | CANCELADO | EXPIRADO`.

- Criar a partir da seleção (botão "Orçamento (N)" existente passa a **salvar** antes de gerar PDF/texto). Snapshot `itens jsonb [{sku, produto, preco, precoDe, foto}]`, `total`, `desconto_pct`, `cliente_nome`, `cliente_whatsapp`, `vendedor_id`, `validade` (default 48 h), `slug` público.
- Página pública `/o/<slug>`: mesma técnica do catálogo público; botão "Aceitar / Quero reservar" abre WhatsApp do vendedor com o código ORC.
- **Reservar**: `itens.reservado_ate = now()+48h`, `reservado_por_orc`; expira sozinha (consulta compara com `now()`); job não é necessário.
- **Confirmar venda**: para cada SKU → `registrarVenda(sku, {valor_vendido, canal_venda:'B2C / Venda direta', comprador, pedido_ref: ORC})`; orçamento → `VENDIDO`.
- Tela: `OrcamentosScreen` (lista por status, busca por cliente, ações) + card no `VendasScreen`.

---

## 10. Modelo de dados / migrations (todas exigem aprovação de Pedro/Bárbara antes de aplicar)

| # | Migration | Conteúdo |
|---|---|---|
| M1 | `vendedores` | `create table vendedores (user_id uuid pk references auth.users, nome text, whatsapp text, ativo bool)`; RLS `auth_full_*`. Fallback para `EMPRESA` quando não cadastrado. |
| M2 | `catalogos_publicos_v2` | `alter table catalogos_publicos add vendedor_id uuid, tipo text default 'catalogo', visualizacoes int default 0, pdf_path text`; RPC `catalogo_publico_visualizar(slug)` security definer. Bucket `catalogos` privado (opcional, 4.1-B). |
| M3 | `orcamentos` | tabela `orcamentos (id uuid, codigo text unique 'ORC-0001', slug text unique, status text check, itens jsonb, total numeric, desconto_pct numeric, cliente_nome, cliente_whatsapp, vendedor_id, validade timestamptz, criado_em, atualizado_em)`; RLS auth full + anon select por slug não expirado; `alter table itens add reservado_ate timestamptz, reservado_por_orc text`; index parcial em `reservado_ate`. |
| M4 | `preco_rapido` | `pricing_markdown_idade (dias_min int, dias_max int, pct numeric)` + seed; `alter table itens add disponivel_desde timestamptz, preco_aprovacao text, preco_aprovacao_motivo text`; backfill de `disponivel_desde` via `eventos` (`acao like 'status:PRONTO%'`) — **verificar primeiro se `itens` já tem carimbo de criação** (o schema inicial é stub no repo; não encontrei `criado_em` usado em `itens` no front). |
| M5 | `salas_combo` | `alter table salas add desconto_combo_pct numeric default 0`. |

Views: `vw_precificacao` não muda (markdown é camada JS); opcional `vw_itens_disponiveis` = estoque − vendidos − reservados ativos, para o catálogo.

---

## 11. Arquivos a criar / alterar (caminhos reais)

**Criar**
- `src/lib/catalogoPdfCore.js` — puro: layout em mm (grade, lista, capa, fechamento), paginação por template, formatação de/por, posições; testável sem jsPDF.
- `src/lib/catalogoPdf.js` — jsPDF: desenha a partir do core (`gerarCatalogoPdf(secoes, opts) → Blob`), reusa `prepararFotos` e `genQrDataUrl`.
- `src/lib/compartilhar.js` — `compartilharArquivo(blob, nome)` (Web Share → download), `compartilharTexto`.
- `src/lib/vendedores.js` — leitura/cache do vendedor logado; `contatoVendedor(user)` com fallback `EMPRESA`.
- `src/lib/precoRapido.js` — puro: `markdownPorIdade`, `arredondarPsicologico`, `precoDe`, `avaliarAprovacao`, `calcularPrecoRapido(item, derivado, params, hoje)`, `planoEmMassa(itens, …)`.
- `src/lib/precoRapidoDb.js` — carrega `pricing_markdown_idade`, aplica em massa (update + eventos).
- `src/lib/orcamentos.js` + `src/lib/orcamentosCore.js` — CRUD, transições de status, códigos, reserva, conversão em venda (chama `registrarVenda`).
- `src/lib/divulgacao.js` (puro) e `src/lib/cardImagem.js` (canvas).
- `src/screens/OrcamentosScreen.jsx`, `src/screens/OrcamentoPublicoView.jsx` (rota `/o/<slug>` em `main.jsx`).
- `src/components/CatalogoBuilderModal.jsx` — layout/opções/vendedor/validade + botões PDF / Link / Texto (usado por Itens, Salas e Catálogo).
- `src/components/PrecoRapidoModal.jsx` — tabela de aplicação em massa.
- `scripts/test_catalogopdf.mjs`, `scripts/test_precorapido.mjs`, `scripts/test_orcamentos.mjs`, `scripts/test_divulgacao.mjs`.
- `supabase/migrations/2026MMDD_*.sql` (M1–M5).

**Alterar**
- `src/screens/ItemsScreen.jsx` — barra de seleção ganha "Catálogo (N)" e "Preço rápido (N)"; "Orçamento (N)" passa a salvar o orçamento.
- `src/screens/SalasScreen.jsx` — ação "Catálogo da sala" (usa `conteudoSala` → itens das caixas + soltos → `CatalogoBuilderModal`).
- `src/screens/PortfolioScreen.jsx` — botão "PDF" passa a gerar arquivo (jsPDF) com seletor de template; "Imprimir" vira secundário; prévia continua HTML.
- `src/lib/catalogoCore.js` — `dedupCatalogo` recebe `excluirReservados`; card leva `precoDe`.
- `src/lib/catalogo.js` — `listarItensCatalogo` aceita `skus[]` (seleção) e `salaId`; exclui `reservado_ate > now()` e `preco_aprovacao = 'PENDENTE'`.
- `src/lib/catalogoPublico.js` / `src/screens/CatalogoPublicoView.jsx` — payload v2 (sku, fotos, precoDe, vendedor), modal por card, CTA, contador.
- `src/lib/anuncioTemplate.js` — "de/por" e condição textual na `sheetAnuncio`; vendedor em vez de `EMPRESA` fixo.
- `src/lib/anuncio.js` / `src/components/AnuncioModal.jsx` — compartilhar via `compartilhar.js`; `onSalvarOrcamento`.
- `src/lib/model.js` — `STATUS_ORCAMENTO`, helper `reservadoAtivo(it)`.
- `src/lib/pricingParams.js` — carrega `pricing_markdown_idade`.
- `src/App.jsx` — aba/entrada "Orçamentos" (pode viver dentro de Vendas para não crescer a barra).
- `package.json` — `test:catalogopdf`, `test:precorapido`, `test:orcamentos`, `test:divulgacao` e inclusão no `test`.

---

## 12. Fases, esforço e prioridade

| Fase | Entrega | Esforço | Depende de |
|---|---|---|---|
| **F0 — Ligar o que existe** | "Catálogo (N)" na seleção; "Catálogo da sala"; `listarItensCatalogo({skus, salaId})`; vendedor no PDF/QR (M1); QR+SKU por card no HTML atual; frase de condição | **P** (1–2 dias) | M1 |
| **F0 — status** | *Implementado:* `listarItensCatalogo({skus,salaId})`, "Catálogo (N)" na seleção, "Catálogo da sala", QR+SKU por card, frase de condição. *Pendente (M1):* vendedor por usuário. | — | — |
| **F1 — PDF arquivo + templates** (detalhado em 6A.8) | `catalogoPdfCore/Pdf.js` (capa, grade, lista, fechamento), `compartilhar.js` (Web Share/download), seletor de template, "de/por"; prévia HTML mantida; teste `test:catalogopdf` | **M** (3–5 dias) | F0 |
| **F2 — Preço rápido** | `precoRapido.js`, M4, modal em massa, aprovação, exclusão de pendentes no catálogo; teste `test:precorapido` | **M** (3–4 dias) | M4 |
| **F3 — Venda assistida** | M3, `orcamentos.js`, tela de orçamentos, link público `/o/<slug>`, reserva 48 h, conversão em venda; teste `test:orcamentos` | **G** (5–8 dias) | M3, F0 |
| **F4 — Divulgação e métricas** | `divulgacao.js`, card PNG, catálogo público v2 (CTA, modal, contador — M2), combo de sala (M5); teste `test:divulgacao` | **M** (3–4 dias) | M2, M5 |

Ordem recomendada: F0 → F1 → F3 → F2 → F4 (F3 antes de F2 porque fecha o ciclo de venda; F2 pode começar em paralelo por ser puro).

---

## 13. Riscos

| Risco | Mitigação |
|---|---|
| Web Share com arquivos não disponível (desktop Firefox, WebViews antigos) | Fallback download + "Copiar link"; detectar `navigator.canShare({files})`. |
| PDF pesado com muitas fotos (> 15 MB) | Limite por template (grade ≤ 120 cards), fotos 800 px q0,8 (worker já faz), aviso de tamanho antes de compartilhar. |
| Fontes/acentos no jsPDF (Helvetica padrão cobre pt-BR básico; "ç/ã" ok no WinAnsi) | Validar em teste visual; embutir fonte TTF só se faltar glifo. |
| Signed URLs de 30 d expiram no link público | Já é o comportamento atual; na v2 expor data de validade na página. |
| Markdown automático derrubar preço de item com referência errada | Nunca abaixo do piso; A+ exige aprovação; aplicação em massa sempre com prévia. |
| "De/por" questionável juridicamente | Só com fonte rastreável; rótulo "preço de novo (referência)"; sem "de" quando não há fonte. |
| Reserva esquecida bloqueando estoque | Expira sozinha (48 h); lista de reservas ativas na tela de orçamentos. |
| Crescimento de `catalogos_publicos` (jsonb) | Já expira em 30 d; limpeza por `delete where expira_em < now() - 60 d` (manual ou cron SQL). |

---

## 14. Métricas de sucesso

- Tempo "seleção → arquivo compartilhado" ≤ 60 s para 30 itens (medir no cliente, evento `catalogo:gerado` com duração).
- ≥ 80 % dos catálogos gerados a partir de seleção/sala (não de filtro genérico).
- Taxa de abertura do link público (`visualizacoes` / links gerados).
- Orçamentos: % convertidos em `VENDIDO` em 7 dias; tempo médio ENVIADO → VENDIDO.
- Itens > 60 dias com markdown aplicado: queda do estoque parado (dias médios em `disponivel_desde`).
- Zero preços publicados abaixo do piso sem aprovação.

---

## 15. Plano de testes

Padrão do repo: Node puro, `assert/strict`, módulos "Core" sem Supabase.

- `test:catalogopdf` — `catalogoPdfCore`: paginação por template (grade 6/página, lista 22/página), capa com/sem vendedor, "de/por" só com fonte, QR payload (`wa.me` + SKU), escape/truncamento de títulos, tamanho estimado.
- `test:precorapido` — faixas de idade (limites inclusivos), arredondamento por faixa (89 / 289 / 1.300), clamp no piso, aprovação (abaixo do piso, > 40 %, A+), `planoEmMassa` (Δ e flags), item sem `disponivel_desde` → sem markdown.
- `test:orcamentos` — `orcamentosCore`: código sequencial, transições válidas/inválidas, total e desconto, expiração, snapshot de itens, mensagem WhatsApp do orçamento (reusa `mensagemOrcamento`).
- `test:divulgacao` — textos (limite de caracteres, destaques, link, validade).
- `test:catalogopublico` (existente) — payload v2: `sku`, `precoDe`, `vendedor`, retrocompatibilidade com `versao: 1` na view.
- `test:anuncio` (existente) — `sheetAnuncio` com "de/por" e vendedor.
- Manual (webapp-testing/Playwright): compartilhar no iOS Safari e Android Chrome; abrir `/c/<slug>` e `/o/<slug>` sem login; impressão desktop.

---

## 16. Decisões que dependem do usuário

0. Canais de contato oficiais (WhatsApp, Instagram, site, e-mail, telefone, endereço/horário) para popular `empresa_config`; e se o contato por catálogo é o geral, o do vendedor ou ambos.

1. Aprovar as migrations M1–M5 (Pedro/Bárbara) e confirmar se `itens` já tem carimbo de criação (define o backfill de `disponivel_desde`).
2. Seeds de markdown (0/10/20/30 % em 30/60/90 d) e limiar de aprovação (40 %).
3. Regra do "de": usar `preco_ref_novo` com fonte ou não exibir "de" nunca.
4. Guardar PDF no Storage (link curto) já na F1 ou só quando o link virar canal principal.
5. Validade padrão da reserva (48 h) e do orçamento.
6. Onde fica "Orçamentos" na navegação (aba própria vs dentro de Vendas).

---

## 17. Fontes

- WhatsApp Catalogs: https://blog.whatsapp.com/introducing-catalogs-for-small-businesses · https://developers.facebook.com/documentation/business-messaging/whatsapp/catalogs/share-products · https://www.theconvertway.com/blog/how-to-make-catalogue-in-whatsapp · https://ayuda.tiendanube.com/whatsapp/como-conectar-tu-catalogo-de-productos-con-whatsapp-business
- Nuvemshop/Abejita PDF: https://www.nuvemshop.com.br/loja-aplicativos-nuvem/abejita-pdf-product-catalog · https://www.nuvemshop.com.br/blog/catalogo-whatsapp/
- Bling/Tiny + WhatsApp: https://www.socialhub.pro/?p=26826
- WhatsApp limite de documento 2 GB: https://www.infobae.com/en/2022/03/23/whatsapp-increases-the-size-of-documents-that-can-be-sent-to-2-gb
- Grades/descontos open-box: https://www.refurb.me/blog/what-are-refurbished-grades-a-b-c · https://www.consumeraffairs.com/news/open-box-vs-refurb-vs-renewed-the-real-differences-when-buying-electronics-102425.html · https://www.knowyourmobile.com/phones/refurbished-smartphones/refurbished-phone-grades-explained/
- Wayfair Open Box/outlet: https://www.realhomes.com/news/wayfair-open-box · https://hoodline.com/2026/08/wayfair-doubles-down-in-central-ohio-with-new-dublin-discount-outlet/
- B-Stock condições: https://bstock.com/supplystore/conditions/ · Back Market grades: https://www.sellermania.com/en/blog/refurbished/back-market-seller-grades-marketplaces/
- Mobly outlet/Tok&Stok: https://mercadoeconsumo.com.br/27/01/2022/destaque-do-dia/mobly-vai-abrir-showroom-dentro-de-outlet-liquitudo-no-interior-de-sao-paulo/ · https://mercadoeconsumo.com.br/12/11/2024/noticias-varejo/mobly-conclui-aquisicao-da-tokstok-e-fortalece-sua-posicao-no-segmento-de-moveis-e-decoracao/
- Markdown por idade: https://help.aravenda.com/portal/en/kb/articles/inventory-aging-price-markdown-automatic-price-reductions-discounts · https://edgeuser.com/Knowledge/Knowledge-Base/inventory-aged-inventory-management-aims-initial-setup · https://racklify.com/encyclopedia/markdown-pricing-strategies-for-retail-and-e-commerce/
- Charm pricing: https://cdn.warc.com/newsandopinion/opinion/nine-thats-a-magic-number/2050 · https://www.business.com/articles/the-game-of-pricing-how-the-number-9-affects-purchase-behavior/ · https://thom.eu/resources/points-of-view/5-psychological-mechanisms-to-increase-the-effectiveness-of-your-pricing-strategy/
- Bundles: https://markets.financialcontent.com/lightport.lightport3/article/pressadvantage-2025-12-8-urban-underpriced-announces-winter-furniture-bundle-program-across-five-locations · https://chargeover.com/blog/bundle-pricing
- Preço no Brasil (Lei 10.962/2004, CDC): https://www.correio24horas.com.br/minha-bahia/preco-duplicado-no-produto-saiba-o-que-fazer-e-quais-sao-os-direitos-do-consumidor-0825 · https://www.migalhas.com.br/depeso/416664/cuidado-com-o-preco-cobrado-na-etiqueta · Nota Técnica Procon-MPMG 1/2025: https://www.mpmg.mp.br/data/files/C6/63/6F/D3/65F299106BD6B299BAA8F9C2/Nota%20tecnica%20n%201%20-%20Modalidades%20de%20precificacao%20em%20produtos%20e%20servicos%20-%20regra%20geral%20e%20excecoes_Procon-MPMG_08%20set%202025.pdf
- PDF client vs server: https://vercel.com/kb/guide/deploying-puppeteer-with-nextjs-on-vercel · https://vercel.com/docs/functions/limitations · https://www.nutrient.io/blog/javascript-pdf-libraries/ · https://www.pkgpulse.com/guides/react-pdf-vs-react-pdf-renderer-vs-jspdf-pdf-in-react-2026
- Vercel custo: https://makerkit.dev/blog/saas/vercel-cost · https://blog.vercel.com/docs/fluid-compute/pricing
- Supabase custo: https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/ · https://makerkit.dev/blog/saas/supabase-pricing
- iOS Safari/impressão e html2canvas lento: https://community.pega.com/support/support-articles/unable-save-excel-file-pdf-exporting-pdf · https://luminix.atlassian.net/wiki/x/CoB8oQ
