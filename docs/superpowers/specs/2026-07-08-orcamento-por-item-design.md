# Gerador de Orçamento por Item — PDF de venda (layout "Conversão / Marketplace")

**Data:** 2026-07-08
**Status:** aprovado para planejamento
**Contexto:** Nogária Outlet (React + Vite + Tailwind + Supabase)

## 1. Objetivo

Dar ao operador, a partir da tela de um item, um botão **"Orçamento"** que gera um
**PDF de 1 página (A4)** de venda daquele produto — com foto grande, preço em destaque,
ficha técnica, condição e um **CTA de WhatsApp com QR Code** — pronto para enviar a um
cliente interessado e **facilitar a compra**.

Reaproveita a marca Nogária (gradiente ciano→verde, azul-marinho `#004078`, o "N" e a
textura de ondas) e a infraestrutura de impressão já existente do catálogo/portfólio.

## 2. Escopo

**Inclui:**
- Botão na barra de ações do topo do `ItemDetail`.
- Modal de pré-visualização do anúncio (render HTML A4) com ações:
  **Salvar/Imprimir PDF**, **Copiar mensagem**, **Abrir WhatsApp**.
- Template A4 puro (layout C aprovado) com todos os blocos: foto + galeria, preço +
  condição de pagamento, specs técnicas, estado/embalagem/entrega, contato WhatsApp + QR.
- Config de contato da empresa em um arquivo editável.

**Não inclui (YAGNI):** imagem PNG/story, link web hospedado, edição inline de textos do
anúncio, histórico de orçamentos, parcelamento calculado. (Há um campo livre reservado
p/ "condição de pagamento" mas sem cálculo.)

## 3. Decisões (do brainstorming)

- **Saída:** PDF de 1 página (não PNG, não link web).
- **Layout:** direção **C — "Conversão / Marketplace"** (preço em faixa gradiente + CTA
  grande de WhatsApp; pensado p/ grupo/lista de WhatsApp).
- **Conteúdo:** foto grande + galeria; preço + condição de pagto; specs técnicas;
  estado + garantia/entrega.
- **CTA:** WhatsApp + QR Code.
- **Contato:** `Nogária Outlet` · WhatsApp `+55 91 98392-9085` → `wa.me/5591983929085`.

## 3.1 Textos padrão (aprovados)

- **Nome do produto:** `it.titulo_anuncio || it.produto` (mesmo padrão do `export.js`).
- **Descrição de venda:** se houver `it.descricao_anuncio`, entra como parágrafo curto
  logo abaixo do nome (bloco novo 4b no layout). Omitido se vazio.
- **Condição de pagamento (faixa de preço):** _"À vista no PIX ou combine o parcelamento no WhatsApp"_.
- **Entrega/retirada:** _"Retirada em Belém ou envio combinado (frete por conta do comprador)"_.

Ficam como constantes em `empresa.js`/`anuncioTemplate.js` (fáceis de editar).

## 4. Arquitetura

Módulos pequenos, com uma responsabilidade cada, seguindo o padrão já usado
(`catalogoCore` puro + `catalogo` com rede + template puro + tela).

### 4.1 `src/lib/empresa.js` (novo)
Config estática de contato/marca, fácil de editar:
```js
export const EMPRESA = {
  nome: "Nogária Outlet",
  whatsapp: "5591983929085",      // só dígitos, formato E.164 (país+DDD+número)
  whatsappLabel: "+55 91 98392-9085",
  tagline: "Logística Reversa & Outlet",
};
export const waLink = (texto) =>
  `https://wa.me/${EMPRESA.whatsapp}?text=${encodeURIComponent(texto)}`;
```

### 4.2 `src/lib/anuncioTemplate.js` (novo, PURO — testável em Node)
- `mensagemWhatsApp(item)` → string da mensagem de venda (nome, condição, preço, SKU,
  link implícito). Usada tanto pelo QR quanto pelo botão "Copiar/Abrir".
- `gerarAnuncioHTML(item, { fotos, qrDataUrl, empresa })` → **HTML A4 autônomo** (layout C).
  - `fotos`: `{ principal: dataURI|null, galeria: [dataURI,...] }`.
  - `qrDataUrl`: PNG data URL do QR (gerado fora, p/ manter a função pura).
  - Usa `LOGO_HORIZONTAL`/mark de `catalogoLogos.js` e os selos de condição de
    `catalogoCore.CATALOGO_ESTADO_BADGE`.
  - Reusa helpers: `escapeHtml` (portfolio), `precoVenda` (export), `fmtBRL`/`fmtKg`
    (model), `embalagemLabel` (model).
  - Sem preço → esconde a faixa de preço e mostra "Sob consulta".
  - Sem foto → placeholder cinza.
- CSS canônico inline (só Arial/Helvetica, `print-color-adjust:exact`, `@page A4`),
  no mesmo estilo do `catalogoTemplate`.

### 4.3 `src/lib/anuncio.js` (novo — com rede)
Orquestra a geração:
- `fotosDoItem(sku)` → busca **todas** as fotos do SKU na tabela `fotos` (ordenadas por
  `ordem`), assina URLs no bucket `fotos-produtos` e converte para dataURI via
  `fotosComoDataURI` (reuso de `portfolio.js`). Retorna `{ principal, galeria }`.
- `gerarQrDataUrl(texto)` → usa a lib `qrcode` (`QRCode.toDataURL`).
- `montarAnuncio(item)` → junta fotos + QR + mensagem e devolve
  `{ html, mensagem, link }` (não imprime — deixa a tela decidir).
- `imprimirAnuncio(html)` → reusa/reexporta `imprimirPortfolio` (iframe isolado →
  diálogo do navegador com "Salvar como PDF").

### 4.4 `src/components/AnuncioModal.jsx` (novo)
- Recebe `item` e `onClose`.
- Ao abrir: chama `montarAnuncio(item)`; enquanto carrega mostra spinner.
- Mostra o HTML num `<iframe srcDoc={html}>` (preview fiel, sem CSS do app).
- Rodapé com botões:
  - **Salvar/Imprimir PDF** → `imprimirAnuncio(html)`.
  - **Copiar mensagem** → `navigator.clipboard.writeText(mensagem)`.
  - **Abrir WhatsApp** → `window.open(link)`.
- Avisos: se `precoVenda(item)` é nulo, banner "Defina o preço ideal para exibir o valor";
  se sem fotos, "Sem fotos — o anúncio sairá com placeholder".

### 4.5 `src/screens/ItemDetail.jsx` (editar)
- Novo botão **"Orçamento"** (ícone `Receipt`, já importado) na barra de ações do topo,
  ao lado de "Celular"/"Imprimir etiqueta".
- Estado `const [anuncio, setAnuncio] = useState(false)`; abre `<AnuncioModal>` (lazy,
  igual ao `LabelPrint`, p/ não puxar `qrcode` até precisar).

## 5. Layout C — blocos do A4 (ordem vertical)

1. **Cabeçalho:** "N" gradiente + wordmark NOGÁRIA à esquerda; selo de condição à direita.
2. **Foto principal** grande.
3. **Tira de miniaturas** (demais fotos; some se só houver 1).
4. **Nome do produto** (`titulo_anuncio || produto`) + linha "MARCA · MODELO · COR" em caps.
4b. **Descrição de venda** (`descricao_anuncio`), parágrafo curto — omitido se vazio.
5. **Faixa de preço** com gradiente ciano→verde: "PREÇO À VISTA" + valor grande.
   Linha fina abaixo p/ condição de pagamento (texto livre; default "Consulte condições").
6. **Ficha técnica** (grid 2 col): marca, modelo, cor, tamanho, voltagem, medidas/peso, GTIN,
   lote/SKU. Omite campos vazios.
7. **Linha de estado:** estado + embalagem (`embalagemLabel`) + linha de entrega/retirada.
8. **Rodapé CTA:** botão verde "COMPRAR NO WHATSAPP" + `whatsappLabel` + **QR Code**.
9. **Barra gradiente** inferior.

## 6. Erros e bordas

- Foto que falha ao baixar/assinar → omitida (best-effort, como no catálogo).
- Sem nenhuma foto → placeholder; anúncio ainda é gerado.
- Sem preço → "Sob consulta" (não bloqueia).
- Impressão que falha → iframe é limpo mesmo assim (comportamento herdado).
- `clipboard`/`window.open` indisponível → botão degrada sem quebrar (try/catch).

## 7. Testes

- `scripts/test_anuncio.mjs` (opcional, no padrão dos demais `test_*.mjs`): importa
  `anuncioTemplate.js` (puro) e valida que `gerarAnuncioHTML` de um item mock:
  - inclui nome, preço formatado e SKU;
  - esconde a faixa de preço quando `preco_ideal` é nulo;
  - escapa HTML de campos de texto;
  - `mensagemWhatsApp` contém nome + preço.
- Adicionar ao script `test` do `package.json` se criado.

## 8. Reuso (sem duplicar)

- Impressão: `imprimirPortfolio` (portfolio.js).
- Fotos → dataURI: `fotosComoDataURI` (portfolio.js).
- Escape: `escapeHtml` (portfolio.js).
- Preço/formatos: `precoVenda` (export.js), `fmtBRL`/`fmtKg`/`embalagemLabel` (model.js).
- Selos de condição: `CATALOGO_ESTADO_BADGE` (catalogoCore.js).
- Logos base64: `catalogoLogos.js`.
- QR: lib `qrcode` (já é dependência).
