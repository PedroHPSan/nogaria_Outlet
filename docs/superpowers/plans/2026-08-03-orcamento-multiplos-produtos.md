# Orçamento de Múltiplos Produtos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir gerar um orçamento em PDF com até 10 produtos (uma página A4 por produto) a partir da seleção múltipla da aba Itens, e reduzir o texto compartilhável do WhatsApp — no orçamento único e no múltiplo — a apenas linhas de produto/valor mais o total.

**Architecture:** Toda a lógica nova de texto e de montagem de HTML vive em `src/lib/anuncioTemplate.js`, que é puro (sem rede) e já tem suíte de testes em Node. `gerarAnuncioHTML` é quebrado em `sheetAnuncio` (uma folha) + `documentoAnuncio` (envelope HTML com o CSS), o que permite empilhar N folhas num só documento. `src/lib/anuncio.js` vira uma casca fina que busca fotos/QR e delega. A UI reaproveita o `selectMode` que o `ItemsScreen` já tem para etiquetas.

**Tech Stack:** React 18 + Vite, Tailwind (classes inline), lucide-react (ícones), Supabase JS, testes puros em `node:assert/strict` rodados por `node scripts/test_*.mjs`.

## Global Constraints

- Limite de produtos por orçamento: **10**, definido uma única vez como `LIMITE_ORCAMENTO` em `src/lib/anuncio.js`.
- `fmtBRL` (de `src/lib/model.js`) formata **sem centavos** — `fmtBRL(1890)` → `"R$ 1.890"`. Nenhum teste deve cravar centavos; use `fmtBRL(valor)` para montar a string esperada.
- Item sem preço: `precoVenda(it)` retorna `null` quando `preco_ideal` não é `> 0`. Esses itens entram no orçamento como **"sob consulta"** e ficam **fora** da soma do total.
- O texto compartilhável não pode conter saudação, nome da empresa, linha `Cód:` nem pergunta final.
- `gerarAnuncioHTML(it, opts)` deve manter assinatura e saída equivalentes — os testes atuais de `scripts/test_anuncio.mjs` continuam passando sem edição.
- Comentários e nomes em português, no mesmo tom dos arquivos existentes (comentário-cabeçalho explicando o porquê do módulo).
- Cada task termina com `npm run test:anuncio` verde; as tasks de UI terminam também com `npm run build` verde.

---

### Task 1: Texto compartilhável (linha, mensagem única e mensagem múltipla)

Reescreve `mensagemWhatsApp` e adiciona as funções de linha/consolidação. Nada de HTML ainda.

**Files:**
- Modify: `src/lib/anuncioTemplate.js` (bloco de `mensagemWhatsApp`, linhas 44-57)
- Test: `scripts/test_anuncio.mjs`

**Interfaces:**
- Consumes: `precoVenda` (de `./export.js`), `fmtBRL` (de `./model.js`), `nomeAnuncio` (já no próprio arquivo) — todos já importados.
- Produces:
  - `linhaOrcamento(it) -> string` — `"<nome> — R$ X"` ou `"<nome> — sob consulta"`
  - `mensagemWhatsApp(it) -> string` — igual a `linhaOrcamento(it)` (assinatura antiga tinha 2º parâmetro `empresa`; ele deixa de ser usado e é removido)
  - `mensagemOrcamento(itens) -> string`
  - `totaisOrcamento(itens) -> { total: number, semPreco: string[], semFoto: string[] }`

- [ ] **Step 1: Escrever os testes que falham**

Em `scripts/test_anuncio.mjs`, trocar o import da linha 3 por:

```js
import {
  gerarAnuncioHTML, mensagemWhatsApp, nomeAnuncio,
  linhaOrcamento, mensagemOrcamento, totaisOrcamento,
} from "../src/lib/anuncioTemplate.js";
import { fmtBRL } from "../src/lib/model.js";
```

E **substituir** o bloco `console.log("mensagemWhatsApp");` (linhas 34-36) por:

```js
console.log("linhaOrcamento");
eq(linhaOrcamento(base), `Furadeira — ${fmtBRL(289)}`, "linha = nome + valor");
eq(
  linhaOrcamento({ ...base, preco_ideal: null }),
  "Furadeira — sob consulta",
  "sem preço vira 'sob consulta'"
);
eq(
  linhaOrcamento({ ...base, titulo_anuncio: "Furadeira de Impacto 750W" }),
  `Furadeira de Impacto 750W — ${fmtBRL(289)}`,
  "usa titulo_anuncio quando existe"
);

console.log("mensagemWhatsApp é só a linha");
const msg = mensagemWhatsApp(base);
eq(msg, linhaOrcamento(base), "mensagem única = linha do item");
eq(msg.split("\n").length, 1, "exatamente uma linha");
ok(!/Ol[áa]/i.test(msg), "sem saudação");
ok(!msg.includes("Cód"), "sem linha de código");
ok(!/dispon[íi]vel/i.test(msg), "sem pergunta final");
ok(!msg.includes("Nogária"), "sem nome da empresa");

console.log("mensagemOrcamento");
const tres = [
  { ...base, sku: "A", produto: "Furadeira", preco_ideal: 289 },
  { ...base, sku: "B", produto: "Parafusadeira", preco_ideal: 150 },
  { ...base, sku: "C", produto: "Serra", preco_ideal: 61 },
];
const msgTres = mensagemOrcamento(tres);
const linhasTres = msgTres.split("\n").filter((l) => l.trim() !== "");
eq(linhasTres.length, 4, "3 linhas de produto + 1 de total");
ok(linhasTres[0].startsWith("Furadeira — "), "1ª linha é o 1º produto");
eq(linhasTres[3], `Total: ${fmtBRL(500)}`, "total soma os três");

eq(mensagemOrcamento([base]), linhaOrcamento(base), "um item só: sem linha de total");

const comSemPreco = mensagemOrcamento([tres[0], { ...tres[1], preco_ideal: null }]);
ok(comSemPreco.includes("Parafusadeira — sob consulta"), "linha sob consulta");
ok(
  comSemPreco.includes(`Total: ${fmtBRL(289)} (+ itens sob consulta)`),
  "total ignora sem preço e sinaliza"
);

eq(
  mensagemOrcamento([{ ...tres[0], preco_ideal: null }, { ...tres[1], preco_ideal: null }]),
  "Furadeira — sob consulta\nParafusadeira — sob consulta",
  "nenhum item com preço: sem linha de total"
);

console.log("totaisOrcamento");
const tot = totaisOrcamento([
  { sku: "A", preco_ideal: 100, foto_feita: true },
  { sku: "B", preco_ideal: null, foto_feita: true },
  { sku: "C", preco_ideal: 50, foto_feita: false },
]);
eq(tot.total, 150, "soma só quem tem preço");
eq(tot.semPreco.join(","), "B", "lista SKUs sem preço");
eq(tot.semFoto.join(","), "C", "lista SKUs sem foto");
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:anuncio`
Expected: FAIL — `SyntaxError: The requested module '../src/lib/anuncioTemplate.js' does not provide an export named 'linhaOrcamento'`

- [ ] **Step 3: Implementar**

Em `src/lib/anuncioTemplate.js`, substituir todo o bloco atual de `mensagemWhatsApp` (o comentário da linha 44 e a função até a linha 57) por:

```js
// Linha de orçamento de um item, como aparece no texto enviado ao cliente:
// "Furadeira de Impacto 750W — R$ 289". Sem preço ideal → "sob consulta".
export function linhaOrcamento(it) {
  const preco = precoVenda(it);
  return `${nomeAnuncio(it)} — ${preco != null ? fmtBRL(preco) : "sob consulta"}`;
}

// Soma do orçamento + quem está incompleto. Itens sem preço ficam FORA do total.
export function totaisOrcamento(itens = []) {
  const lista = itens || [];
  return {
    total: lista.reduce((s, it) => s + (precoVenda(it) || 0), 0),
    semPreco: lista.filter((it) => precoVenda(it) == null).map((it) => it.sku),
    semFoto: lista.filter((it) => !it.foto_feita).map((it) => it.sku),
  };
}

// Texto compartilhado com o cliente: SÓ as linhas do orçamento. Com 2+ itens
// entra o total (somando apenas quem tem preço); com 1 item, nenhum total.
export function mensagemOrcamento(itens = []) {
  const lista = itens || [];
  const linhas = lista.map(linhaOrcamento);
  if (lista.length < 2) return linhas.join("\n");

  const { total, semPreco } = totaisOrcamento(lista);
  if (total <= 0) return linhas.join("\n");
  const sufixo = semPreco.length ? " (+ itens sob consulta)" : "";
  return [...linhas, "", `Total: ${fmtBRL(total)}${sufixo}`].join("\n");
}

// Mensagem do item único (usada no botão/QR do anúncio de um produto só).
export const mensagemWhatsApp = (it) => linhaOrcamento(it);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:anuncio`
Expected: PASS — todas as asserções OK, incluindo as antigas de `gerarAnuncioHTML`.

- [ ] **Step 5: Conferir que ninguém mais dependia do 2º parâmetro**

Run: `grep -rn "mensagemWhatsApp" src scripts`
Expected: só `src/lib/anuncio.js:32` (`mensagemWhatsApp(item, empresa)`) e o teste. A chamada em `anuncio.js` some na Task 3; até lá o `empresa` extra é ignorado sem quebrar nada.

- [ ] **Step 6: Commit**

```bash
git add src/lib/anuncioTemplate.js scripts/test_anuncio.mjs
git commit -m "feat(orcamento): texto do WhatsApp com apenas linhas e total"
```

---

### Task 2: Quebrar o template em folha + documento e gerar o HTML de N produtos

**Files:**
- Modify: `src/lib/anuncioTemplate.js` (constante `CSS` e função `gerarAnuncioHTML`, linhas 59-154)
- Test: `scripts/test_anuncio.mjs`

**Interfaces:**
- Consumes: `linhaOrcamento` da Task 1 (não usada aqui, mas mesmo módulo).
- Produces:
  - `sheetAnuncio(it, opts) -> string` — só o `<div class="sheet">…</div>`; `opts` = `{ fotos, qrDataUrl, pagamento, entrega }`
  - `documentoAnuncio(sheets, titulo) -> string` — documento HTML completo; `sheets` é `string[]`
  - `gerarAnuncioHTML(it, opts) -> string` — inalterado por fora
  - `gerarOrcamentoHTML(itens, opts) -> string` — `opts` = `{ porSku: { [sku]: { fotos, qrDataUrl } }, empresa, pagamento, entrega }`

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao import de `anuncioTemplate.js` em `scripts/test_anuncio.mjs`: `gerarOrcamentoHTML, sheetAnuncio, documentoAnuncio`.

Adicionar antes da linha final `console.log(\`\n${passou} asserções OK\`);`:

```js
console.log("sheetAnuncio / documentoAnuncio");
const folha = sheetAnuncio(base, {});
ok(folha.startsWith('<div class="sheet">'), "folha é só a div");
ok(!folha.includes("<!DOCTYPE"), "folha não traz o envelope");
ok(documentoAnuncio([folha], "T").includes("<!DOCTYPE html>"), "documento tem o envelope");
ok(documentoAnuncio([folha], "T").includes("<title>T</title>"), "documento usa o título");

console.log("gerarOrcamentoHTML");
const itensOrc = [
  { ...base, sku: "NOG-A", produto: "Furadeira" },
  { ...base, sku: "NOG-B", produto: "Parafusadeira" },
  { ...base, sku: "NOG-C", produto: "Serra" },
];
const orc = gerarOrcamentoHTML(itensOrc);
eq((orc.match(/<div class="sheet">/g) || []).length, 3, "uma folha por produto");
eq((orc.match(/<!DOCTYPE html>/g) || []).length, 1, "um único documento");
ok(orc.includes("page-break-after:always"), "CSS quebra página entre folhas");
ok(orc.includes(".sheet:last-child"), "última folha não força quebra");
["NOG-A", "NOG-B", "NOG-C"].forEach((s) => ok(orc.includes(s), `inclui ${s}`));
ok(orc.includes("<title>Orçamento (3 itens)"), "título com a contagem");

console.log("gerarOrcamentoHTML usa as fotos/QR por SKU");
const orcFotos = gerarOrcamentoHTML(itensOrc.slice(0, 2), {
  porSku: {
    "NOG-A": { fotos: { principal: "data:image/png;base64,AAA", galeria: [] }, qrDataUrl: "data:image/png;base64,QQQ" },
  },
});
ok(orcFotos.includes("data:image/png;base64,AAA"), "foto do 1º item entra");
ok(orcFotos.includes("data:image/png;base64,QQQ"), "QR do 1º item entra");
ok(orcFotos.includes("SEM FOTO"), "2º item sem foto cai no placeholder");
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:anuncio`
Expected: FAIL — `does not provide an export named 'gerarOrcamentoHTML'`

- [ ] **Step 3: Ajustar o CSS**

Em `src/lib/anuncioTemplate.js`, na constante `CSS`, trocar a linha do `.sheet` por estas duas:

```css
.sheet{ width:210mm; min-height:297mm; padding:14mm 15mm 0; position:relative; display:flex; flex-direction:column; page-break-after:always; }
.sheet:last-child{ page-break-after:auto; }
```

- [ ] **Step 4: Quebrar `gerarAnuncioHTML` em folha + documento**

Substituir a função `gerarAnuncioHTML` inteira (do comentário na linha 97 até o fim do arquivo) por:

```js
// Uma folha A4 (o produto em si). Sem o envelope HTML — assim várias folhas
// podem ser empilhadas num só documento (orçamento com N produtos).
// opts: { fotos:{principal,galeria[]}, qrDataUrl, empresa, pagamento, entrega }.
// Sem preço → "Sob consulta"; sem foto → placeholder.
export function sheetAnuncio(it, opts = {}) {
  const {
    fotos = {}, qrDataUrl = null, empresa = EMPRESA,
    pagamento = PAGAMENTO_PADRAO, entrega = ENTREGA_PADRAO,
  } = opts;

  const preco = precoVenda(it);
  const badge = badgeEstado(it.estado);
  const nome = nomeAnuncio(it);
  const modelo = modeloLinha(it);
  const rows = specRows(it);
  const principal = fotos.principal;
  const galeria = (fotos.galeria || []).slice(0, 4);

  const specsHtml = rows
    .map(([k, v]) => `<div class="row"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(String(v))}</span></div>`)
    .join("");

  const thumbsHtml = galeria.length
    ? `<div class="thumbs">${galeria.map((u) => `<div class="t"><img src="${escapeHtml(u)}" alt=""></div>`).join("")}</div>`
    : "";

  const priceHtml = preco != null
    ? `<div class="priceband"><span class="lbl">PREÇO À VISTA</span><span class="val">${escapeHtml(fmtBRL(preco))}</span></div><div class="paycond">${escapeHtml(pagamento)}</div>`
    : `<div class="priceband"><span class="lbl">VALOR</span><span class="val">Sob consulta</span></div><div class="paycond">${escapeHtml(pagamento)}</div>`;

  const estadoPartes = [
    badge ? `<b>Condição:</b> ${escapeHtml(badge.txt)}` : null,
    it.cond_embalagem ? `<b>Embalagem:</b> ${escapeHtml(embalagemLabel(it.cond_embalagem))}` : null,
  ].filter(Boolean).join(" · ");
  const estadoHtml = `<div class="estado">${estadoPartes ? estadoPartes + "<br>" : ""}<b>Entrega:</b> ${escapeHtml(entrega)}</div>`;

  const qrHtml = qrDataUrl ? `<div class="qr"><img src="${escapeHtml(qrDataUrl)}" alt="QR WhatsApp"></div>` : "";

  return (
    `<div class="sheet">` +
      `<div class="head"><img src="${LOGO_HORIZONTAL}" alt="${escapeHtml(empresa.nome)}">` +
        (badge ? `<span class="badge ${badge.cls}">${escapeHtml(badge.txt)}</span>` : "") +
      `</div>` +
      `<div class="photo">${principal ? `<img src="${escapeHtml(principal)}" alt="">` : `<span class="noimg">SEM FOTO</span>`}</div>` +
      thumbsHtml +
      `<div class="pname">${escapeHtml(nome)}</div>` +
      (modelo ? `<div class="pmodel">${escapeHtml(modelo)}</div>` : "") +
      (it.descricao_anuncio ? `<div class="pdesc">${escapeHtml(it.descricao_anuncio)}</div>` : "") +
      priceHtml +
      (specsHtml ? `<div class="specs">${specsHtml}</div>` : "") +
      estadoHtml +
      `<div class="foot"><div class="cta">` +
        `<div class="wbtn"><span class="b">📱 Comprar no WhatsApp</span><div class="n">${escapeHtml(empresa.whatsappLabel)} · ${escapeHtml(empresa.nome)}</div></div>` +
        qrHtml +
      `</div><div class="bar"></div></div>` +
    `</div>`
  );
}

// Envelope HTML A4 com o CSS compartilhado por todas as folhas.
export function documentoAnuncio(sheets, titulo) {
  return (
    `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">` +
    `<title>${escapeHtml(titulo)}</title><style>${CSS}</style></head><body>` +
    sheets.join("") +
    `</body></html>`
  );
}

// Anúncio/orçamento de UM item (API antiga, preservada).
export function gerarAnuncioHTML(it, opts = {}) {
  const empresa = opts.empresa || EMPRESA;
  return documentoAnuncio([sheetAnuncio(it, opts)], `${nomeAnuncio(it)} — ${empresa.nome}`);
}

// Orçamento com N produtos: uma folha A4 por item, num só documento.
// opts: { porSku:{ [sku]:{fotos,qrDataUrl} }, empresa, pagamento, entrega }.
export function gerarOrcamentoHTML(itens = [], opts = {}) {
  const { porSku = {}, empresa = EMPRESA, pagamento, entrega } = opts;
  const lista = itens || [];
  const sheets = lista.map((it) =>
    sheetAnuncio(it, { ...(porSku[it.sku] || {}), empresa, pagamento, entrega })
  );
  return documentoAnuncio(sheets, `Orçamento (${lista.length} itens) — ${empresa.nome}`);
}
```

Atenção: `sheetAnuncio` recebe `pagamento`/`entrega` possivelmente `undefined` vindos de `gerarOrcamentoHTML` — o destructuring com default já cobre isso.

- [ ] **Step 5: Rodar e ver passar**

Run: `npm run test:anuncio`
Expected: PASS — inclusive as asserções antigas de `gerarAnuncioHTML` (nome, `R$`, SKU, `PREÇO À VISTA`, `Sob consulta`, escape de `<script>`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/anuncioTemplate.js scripts/test_anuncio.mjs
git commit -m "feat(orcamento): HTML com uma pagina A4 por produto"
```

---

### Task 3: `montarOrcamento` — fotos, QR e limite

**Files:**
- Modify: `src/lib/anuncio.js` (linhas 1-43, todo o bloco de `montarAnuncio`)

**Interfaces:**
- Consumes: `sheetAnuncio`/`gerarOrcamentoHTML`, `mensagemOrcamento`, `mensagemWhatsApp`, `totaisOrcamento` (Tasks 1 e 2); `fotosDoItem` (já existe no arquivo); `waLink`, `genQrDataUrl`.
- Produces:
  - `LIMITE_ORCAMENTO = 10`
  - `montarOrcamento(itens, { empresa, onProgress }) -> Promise<{ html, mensagem, link, total, semPreco, semFoto }>`
  - `montarAnuncio(item, empresa) -> Promise<{ html, mensagem, link, … }>` (contrato antigo preservado)

Este módulo importa `./supabase.js`, que lê `import.meta.env` e não roda em Node puro — por isso não há teste automatizado aqui. A lógica testável já ficou em `anuncioTemplate.js`. Verificação = `npm run build` + o teste manual do Step 4.

- [ ] **Step 1: Atualizar imports e trocar o bloco de montagem**

Em `src/lib/anuncio.js`, trocar a linha 8 por:

```js
import {
  gerarOrcamentoHTML, mensagemOrcamento, mensagemWhatsApp, totaisOrcamento,
} from "./anuncioTemplate.js";
```

E substituir todo o bloco `montarAnuncio` (comentário da linha 30 até a linha 40) por:

```js
// Teto de produtos por orçamento: acima disso a geração fica lenta (uma foto
// em dataURI por item) e o PDF pesa demais no celular.
export const LIMITE_ORCAMENTO = 10;

// Monta o orçamento de 1..LIMITE_ORCAMENTO itens (NÃO imprime). Cada página
// leva o QR do seu próprio produto; o `link` devolvido é o do orçamento todo.
// onProgress(feitas, total) roda a cada item concluído.
export async function montarOrcamento(itens, { empresa = EMPRESA, onProgress } = {}) {
  const lista = itens || [];
  if (!lista.length) throw new Error("Selecione ao menos um produto.");
  if (lista.length > LIMITE_ORCAMENTO) {
    throw new Error(`Máximo de ${LIMITE_ORCAMENTO} produtos por orçamento.`);
  }

  let feitas = 0;
  const partes = await Promise.all(
    lista.map(async (it) => {
      const [fotos, qrDataUrl] = await Promise.all([
        fotosDoItem(it.sku),
        genQrDataUrl(waLink(mensagemWhatsApp(it))),
      ]);
      feitas += 1;
      onProgress?.(feitas, lista.length);
      return [it.sku, { fotos, qrDataUrl }];
    })
  );

  const porSku = Object.fromEntries(partes);
  const mensagem = mensagemOrcamento(lista);
  const { total, semPreco, semFoto } = totaisOrcamento(lista);
  return {
    html: gerarOrcamentoHTML(lista, { porSku, empresa }),
    mensagem,
    link: waLink(mensagem),
    total,
    semPreco,
    semFoto,
  };
}

// Compat: orçamento de um item só.
export const montarAnuncio = (item, empresa = EMPRESA) => montarOrcamento([item], { empresa });
```

- [ ] **Step 2: Ajustar o comentário-cabeçalho do arquivo**

Trocar as duas primeiras linhas do arquivo por:

```js
// Orquestra a geração do orçamento (1..10 itens): busca TODAS as fotos de cada
// SKU, gera o QR do WhatsApp de cada produto e monta o HTML A4 — uma página por
```

(mantendo a 3ª linha, sobre a impressão via `imprimirPortfolio`, como está)

- [ ] **Step 3: Verificar que nada quebrou no build**

Run: `npm run build`
Expected: build conclui sem erro; nenhum aviso de export inexistente.

- [ ] **Step 4: Teste manual do caminho antigo**

Run: `npm run dev`, abrir um item na aba Itens e clicar em Orçamento.
Expected: a folha sai igual à de antes; "Copiar msg" produz uma única linha `Nome — R$ X`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/anuncio.js
git commit -m "feat(orcamento): montarOrcamento com limite de 10 produtos"
```

---

### Task 4: `AnuncioModal` recebe uma lista de itens

**Files:**
- Modify: `src/components/AnuncioModal.jsx` (arquivo inteiro)
- Modify: `src/screens/ItemDetail.jsx:1128`

**Interfaces:**
- Consumes: `montarOrcamento`, `LIMITE_ORCAMENTO` (Task 3).
- Produces: `<AnuncioModal itens={Item[]} onClose={fn} />` — a prop `item` deixa de existir.

- [ ] **Step 1: Reescrever o modal**

Substituir `src/components/AnuncioModal.jsx` por:

```jsx
// Modal de prévia do orçamento (1..10 itens): renderiza o HTML A4 num iframe
// (srcDoc, sem o CSS do app) e oferece Copiar mensagem / WhatsApp / Salvar PDF.
import React, { useEffect, useState } from "react";
import { X, Loader2, Printer, Copy, MessageCircle, Check } from "lucide-react";
import { montarOrcamento, imprimirAnuncio } from "../lib/anuncio";

export default function AnuncioModal({ itens = [], onClose }) {
  const [loading, setLoading] = useState(true);
  const [dados, setDados] = useState(null);   // { html, mensagem, link, total, semPreco, semFoto }
  const [erro, setErro] = useState(null);
  const [progresso, setProgresso] = useState({ feitas: 0, total: itens.length });
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      setErro(null);
      try {
        const d = await montarOrcamento(itens, {
          onProgress: (feitas, total) => { if (!cancel) setProgresso({ feitas, total }); },
        });
        if (!cancel) setDados(d);
      } catch (e) {
        if (!cancel) setErro(e.message || "Falha ao gerar o orçamento.");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [itens]);

  const titulo = itens.length === 1 ? `Orçamento — ${itens[0].sku}` : `Orçamento — ${itens.length} itens`;

  const copiar = async () => {
    if (!dados) return;
    try {
      await navigator.clipboard.writeText(dados.mensagem);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch { /* clipboard indisponível */ }
  };
  const abrirWhats = () => { if (!dados) return; try { window.open(dados.link, "_blank"); } catch { /* noop */ } };

  return (
    <div className="fixed inset-0 z-[75] bg-gray-100 flex flex-col">
      <div className="bg-gray-900 text-white px-4 py-3 flex items-center justify-between shadow-md">
        <span className="font-bold">{titulo}</span>
        <button onClick={onClose} className="p-1.5 rounded-lg bg-gray-800" aria-label="Fechar">
          <X className="w-5 h-5" />
        </button>
      </div>

      {dados && (dados.semPreco.length > 0 || dados.semFoto.length > 0) && (
        <div className="px-4 py-2 text-xs bg-amber-50 text-amber-800 border-b border-amber-200 space-y-0.5">
          {dados.semPreco.length > 0 && (
            <div>⚠ {dados.semPreco.length} sem preço ideal — sai como "Sob consulta": {dados.semPreco.join(", ")}</div>
          )}
          {dados.semFoto.length > 0 && (
            <div>⚠ {dados.semFoto.length} sem foto — sai com placeholder: {dados.semFoto.join(", ")}</div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto p-3 flex items-start justify-center">
        {loading && (
          <div className="mt-10 flex flex-col items-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
            {progresso.total > 1 && <span>{progresso.feitas}/{progresso.total} produtos</span>}
          </div>
        )}
        {!loading && erro && <p className="mt-10 text-sm text-red-600">{erro}</p>}
        {!loading && dados && (
          <iframe title="Prévia do orçamento" srcDoc={dados.html}
            className="bg-white shadow-lg w-full max-w-[210mm]"
            style={{ height: `calc(${itens.length} * (100vw * 297 / 210))`, maxHeight: "none", border: 0 }} />
        )}
      </div>

      {!loading && dados && (
        <div className="p-3 border-t border-gray-200 bg-white flex gap-2 max-w-lg mx-auto w-full">
          <button onClick={copiar}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-semibold border border-gray-300 text-gray-700 bg-white">
            {copiado ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />} {copiado ? "Copiado" : "Copiar msg"}
          </button>
          <button onClick={abrirWhats}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-semibold border border-emerald-200 text-emerald-700 bg-emerald-50">
            <MessageCircle className="w-4 h-4" /> WhatsApp
          </button>
          <button onClick={() => imprimirAnuncio(dados.html)}
            className="flex-[1.4] flex items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-bold bg-gray-900 text-white">
            <Printer className="w-4 h-4" /> Salvar PDF
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Atualizar o chamador do `ItemDetail`**

Em `src/screens/ItemDetail.jsx`, trocar a linha 1128:

```jsx
<AnuncioModal item={it} onClose={() => setAnuncio(false)} />
```

por:

```jsx
<AnuncioModal itens={itensAnuncio} onClose={() => setAnuncio(false)} />
```

E, junto dos outros `useMemo` do componente, adicionar (o array precisa ter identidade estável, senão o `useEffect` do modal refaz a busca de fotos a cada render):

```jsx
const itensAnuncio = useMemo(() => [it], [it]);
```

Confirme que `useMemo` já está no import de `react` no topo do arquivo; se não estiver, acrescente.

- [ ] **Step 3: Verificar o build**

Run: `npm run build`
Expected: sem erro.

- [ ] **Step 4: Teste manual**

Run: `npm run dev`, abrir um item → Orçamento.
Expected: título `Orçamento — NOG-…`, prévia de uma página, avisos só quando faltar preço/foto, os três botões funcionando.

- [ ] **Step 5: Commit**

```bash
git add src/components/AnuncioModal.jsx src/screens/ItemDetail.jsx
git commit -m "feat(orcamento): modal aceita lista de itens"
```

---

### Task 5: Seleção múltipla na aba Itens com duas ações

**Files:**
- Modify: `src/screens/ItemsScreen.jsx` (imports no topo; bloco de seleção ~linhas 53-95; cabeçalho ~linhas 335-351; barra inferior ~linhas 466-477)

**Interfaces:**
- Consumes: `AnuncioModal` (Task 4), `LIMITE_ORCAMENTO` (Task 3).
- Produces: nada consumido por outras tasks.

- [ ] **Step 1: Imports**

Em `src/screens/ItemsScreen.jsx`:

- acrescentar `FileText` à lista de ícones importados de `lucide-react` (linha 9);
- acrescentar `import { LIMITE_ORCAMENTO } from "../lib/anuncio";`
- acrescentar, junto do lazy do `LabelPrint`:

```jsx
const AnuncioModal = React.lazy(() => import("../components/AnuncioModal"));
```

- [ ] **Step 2: Estado e handler do orçamento**

Logo abaixo de `const [printLabels, setPrintLabels] = useState(null);`, adicionar:

```jsx
const [orcamento, setOrcamento] = useState(null); // itens do orçamento em prévia
```

E, logo abaixo da função `imprimirSelecionados`, adicionar:

```jsx
// Orçamento dos selecionados desta página (mesmo critério das etiquetas).
const orcarSelecionados = () => {
  const escolhidos = itens.filter((i) => selected.has(i.sku));
  if (!escolhidos.length || escolhidos.length > LIMITE_ORCAMENTO) return;
  setOrcamento(escolhidos);
};
```

- [ ] **Step 3: Renomear o botão de entrada no modo seleção**

No cabeçalho, trocar o botão que hoje entra em `selectMode`:

```jsx
<button onClick={() => setSelectMode(true)}
  className="flex items-center gap-1 text-xs font-semibold text-white bg-orange-500 rounded-lg px-2 py-1">
  <Printer className="w-3.5 h-3.5" /> Etiquetas
</button>
```

por:

```jsx
<button onClick={() => setSelectMode(true)}
  className="flex items-center gap-1 text-xs font-semibold text-white bg-orange-500 rounded-lg px-2 py-1">
  <CheckSquare className="w-3.5 h-3.5" /> Selecionar
</button>
```

(`CheckSquare` já está importado.)

- [ ] **Step 4: Barra inferior com as duas ações**

Substituir o bloco da barra de impressão em massa por:

```jsx
{/* Ações da seleção (acima da navegação inferior) */}
{selectMode && selected.size > 0 && (
  <div className="fixed bottom-14 inset-x-0 z-30 px-3">
    <div className="max-w-lg mx-auto flex gap-2">
      <button onClick={imprimirSelecionados}
        className="flex-1 rounded-xl py-3.5 font-bold bg-gray-900 text-white shadow-lg flex items-center justify-center gap-2">
        <Printer className="w-4 h-4" /> Etiquetas ({selected.size})
      </button>
      <button onClick={orcarSelecionados} disabled={selected.size > LIMITE_ORCAMENTO}
        className={`flex-1 rounded-xl py-3.5 font-bold shadow-lg flex items-center justify-center gap-2 ${
          selected.size > LIMITE_ORCAMENTO
            ? "bg-gray-300 text-gray-500"
            : "bg-emerald-600 text-white"
        }`}>
        <FileText className="w-4 h-4" />
        {selected.size > LIMITE_ORCAMENTO ? `Orçamento (máx. ${LIMITE_ORCAMENTO})` : `Orçamento (${selected.size})`}
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 5: Renderizar o modal**

Ao lado do bloco `{printLabels && (…)}`, adicionar:

```jsx
{orcamento && (
  <Suspense fallback={<div className="fixed inset-0 z-[75] bg-white flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>}>
    <AnuncioModal itens={orcamento} onClose={() => setOrcamento(null)} />
  </Suspense>
)}
```

- [ ] **Step 6: Verificar build e lint**

Run: `npm run build && npm run lint`
Expected: ambos sem erro.

- [ ] **Step 7: Teste manual**

Run: `npm run dev`, aba Itens → `Selecionar` → marcar 3 produtos → `Orçamento (3)`.
Expected: PDF com 3 páginas A4, uma por produto, cada uma com seu QR; "Copiar msg" traz 3 linhas + `Total: R$ X`. Marcar 11 produtos deixa o botão cinza com `Orçamento (máx. 10)`.

- [ ] **Step 8: Commit**

```bash
git add src/screens/ItemsScreen.jsx
git commit -m "feat(orcamento): selecao multipla na aba Itens gera orcamento"
```

---

### Task 6: Suíte completa e fechamento

- [ ] **Step 1: Rodar a suíte inteira**

Run: `npm test`
Expected: todos os scripts passam, incluindo `test:anuncio` com as novas asserções.

- [ ] **Step 2: Conferir que não sobrou referência à prop antiga**

Run: `grep -rn "AnuncioModal" src` e `grep -rn "montarAnuncio\|mensagemWhatsApp" src`
Expected: nenhum uso de `item={` no `AnuncioModal`; `montarAnuncio` só existe como export de compat em `anuncio.js` (pode não ter mais chamadores — deixe exportado).

- [ ] **Step 3: Commit final, se algo mudou**

```bash
git add -A
git commit -m "chore(orcamento): ajustes finais da suite"
```
