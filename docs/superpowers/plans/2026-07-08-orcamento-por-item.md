# Gerador de Orçamento por Item Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um botão "Orçamento" na tela de um item que gera um PDF A4 de venda (layout "Conversão/Marketplace") com foto, preço, ficha técnica, condição e CTA de WhatsApp + QR, pronto para enviar a clientes.

**Architecture:** Módulos pequenos seguindo o padrão do repo (núcleo puro + camada com rede + template puro + tela): `empresa.js` (config de contato), `anuncioTemplate.js` (HTML A4 puro, testável em Node), `anuncio.js` (busca fotos, gera QR, monta e imprime), `AnuncioModal.jsx` (prévia + ações) e o botão no `ItemDetail`. Reusa impressão em iframe (`imprimirPortfolio`), fotos→dataURI (`fotosComoDataURI`), QR (`genQrDataUrl`), selos de condição (`CATALOGO_ESTADO_BADGE`) e logos base64.

**Tech Stack:** React 18 + Vite + Tailwind, Supabase JS, lib `qrcode` (já dependência), lucide-react. Testes: scripts Node com `node:assert` (padrão `scripts/test_*.mjs`).

---

## File Structure

- **Create** `src/lib/empresa.js` — config de contato/marca + helper `waLink`.
- **Create** `src/lib/anuncioTemplate.js` — PURO: `nomeAnuncio`, `mensagemWhatsApp`, `gerarAnuncioHTML` + textos padrão.
- **Create** `scripts/test_anuncio.mjs` — testes do template puro.
- **Create** `src/lib/anuncio.js` — `fotosDoItem`, `montarAnuncio`, `imprimirAnuncio` (rede).
- **Create** `src/components/AnuncioModal.jsx` — modal de prévia + botões.
- **Modify** `src/screens/ItemDetail.jsx` — botão "Orçamento" + modal lazy.
- **Modify** `package.json` — script `test:anuncio` no pipeline `test`.

---

## Task 1: Config de contato (`empresa.js`)

**Files:**
- Create: `src/lib/empresa.js`

- [ ] **Step 1: Criar o arquivo**

```js
// src/lib/empresa.js
// Dados de contato/marca da Nogária usados no anúncio/orçamento por item.
// Edite aqui para mudar o WhatsApp/nome que aparece no PDF e no QR.
export const EMPRESA = {
  nome: "Nogária Outlet",
  whatsapp: "5591983929085",       // só dígitos (país+DDD+número), formato do wa.me
  whatsappLabel: "+55 91 98392-9085",
  tagline: "Logística Reversa & Outlet",
};

// Link wa.me com mensagem pré-preenchida (texto opcional).
export const waLink = (texto = "") =>
  `https://wa.me/${EMPRESA.whatsapp}${texto ? `?text=${encodeURIComponent(texto)}` : ""}`;
```

- [ ] **Step 2: Sanity check de import em Node**

Run: `node -e "import('./src/lib/empresa.js').then(m=>console.log(m.EMPRESA.nome, m.waLink('oi')))"`
Expected: imprime `Nogária Outlet https://wa.me/5591983929085?text=oi`

- [ ] **Step 3: Commit**

```bash
git add src/lib/empresa.js
git commit -m "feat(orcamento): config de contato da empresa (empresa.js)"
```

---

## Task 2: Template puro do anúncio (`anuncioTemplate.js`) — TDD

**Files:**
- Create: `src/lib/anuncioTemplate.js`
- Test: `scripts/test_anuncio.mjs`
- Modify: `package.json`

- [ ] **Step 1: Escrever o teste que falha**

Create `scripts/test_anuncio.mjs`:

```js
// Testes das funções PURAS do anúncio (anuncioTemplate.js). Rode: npm run test:anuncio
import assert from "node:assert/strict";
import { gerarAnuncioHTML, mensagemWhatsApp, nomeAnuncio } from "../src/lib/anuncioTemplate.js";

let passou = 0;
const ok = (c, msg) => { assert.ok(c, msg); passou++; console.log(`  ok  ${msg}`); };
const eq = (a, b, msg) => { assert.equal(a, b, msg); passou++; console.log(`  ok  ${msg}`); };

const base = {
  sku: "NOG-001-002", produto: "Furadeira", marca: "Bosch", modelo: "GSB 13 RE",
  cor: "Azul", estado: "Novo", preco_ideal: 289, voltagem: "220V",
};

console.log("nomeAnuncio prefere titulo_anuncio");
eq(nomeAnuncio({ produto: "Furadeira", titulo_anuncio: "Furadeira de Impacto 750W" }), "Furadeira de Impacto 750W", "usa titulo_anuncio");
eq(nomeAnuncio({ produto: "Furadeira" }), "Furadeira", "cai no produto");

console.log("gerarAnuncioHTML com preço");
const html = gerarAnuncioHTML(base, {});
ok(html.includes("Furadeira"), "inclui o nome");
ok(html.includes("R$"), "inclui preço formatado");
ok(html.includes("NOG-001-002"), "inclui SKU");
ok(html.includes("PREÇO À VISTA"), "mostra a faixa de preço à vista");

console.log("sem preço → sob consulta");
const semPreco = gerarAnuncioHTML({ ...base, preco_ideal: null }, {});
ok(!semPreco.includes("PREÇO À VISTA"), "esconde faixa de preço à vista");
ok(semPreco.includes("Sob consulta"), "mostra 'Sob consulta'");

console.log("escapa HTML de texto do usuário");
const xss = gerarAnuncioHTML({ ...base, produto: "<script>x</script>", titulo_anuncio: null }, {});
ok(!xss.includes("<script>x"), "escapa < do produto");

console.log("mensagemWhatsApp");
const msg = mensagemWhatsApp(base);
ok(msg.includes("Furadeira"), "mensagem tem o nome");
ok(msg.includes("R$"), "mensagem tem preço");

console.log(`\n${passou} asserções OK`);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/test_anuncio.mjs`
Expected: FAIL — `Cannot find module '.../src/lib/anuncioTemplate.js'`

- [ ] **Step 3: Implementar o template**

Create `src/lib/anuncioTemplate.js`:

```js
// Anúncio/orçamento de UM item → HTML A4 autônomo (layout "Conversão/Marketplace").
// PURO (sem rede): recebe as fotos já como dataURI e o QR já como dataURL — testável
// em Node. Reaproveita helpers de escape/preço/formatos e os selos de condição.
import { escapeHtml } from "./portfolio.js";
import { precoVenda } from "./export.js";
import { fmtBRL, fmtKg, embalagemLabel } from "./model.js";
import { CATALOGO_ESTADO_BADGE } from "./catalogoCore.js";
import { LOGO_HORIZONTAL } from "./catalogoLogos.js";
import { EMPRESA } from "./empresa.js";

export const PAGAMENTO_PADRAO = "À vista no PIX ou combine o parcelamento no WhatsApp";
export const ENTREGA_PADRAO = "Retirada em Belém ou envio combinado (frete por conta do comprador)";

export const nomeAnuncio = (it) => (it?.titulo_anuncio || it?.produto || it?.sku || "").trim();

// "MARCA · MODELO · COR" em caps, omitindo partes vazias.
function modeloLinha(it) {
  let s = [it.marca, it.modelo].filter(Boolean).join(" · ");
  if (it.cor) s = s ? `${s} · ${it.cor}` : it.cor;
  return s.toUpperCase();
}

// Linhas da ficha técnica (rótulo→valor), já sem os campos vazios.
function specRows(it) {
  const peso = it.peso_real_kg ?? it.peso_kg;
  const temDims = [it.comprimento_cm, it.largura_cm, it.altura_cm].every((v) => v != null && v !== "");
  const dims = temDims ? `${it.comprimento_cm}×${it.largura_cm}×${it.altura_cm} cm` : null;
  const rows = [
    ["Marca", it.marca],
    ["Modelo", it.modelo],
    ["Cor", it.cor],
    ["Tamanho", it.tamanho],
    ["Voltagem", it.voltagem && it.voltagem !== "N/A" ? it.voltagem : null],
    ["Peso", peso != null && peso !== "" ? fmtKg(peso) : null],
    ["Dimensões", dims],
    ["Cód. de barras", it.gtin],
    ["SKU", it.sku],
  ];
  return rows.filter(([, v]) => v != null && String(v).trim() !== "");
}

const badgeEstado = (estado) => CATALOGO_ESTADO_BADGE[(estado || "").trim()] || null;

// Mensagem que o CLIENTE envia ao tocar no WhatsApp/QR (perspectiva do comprador).
export function mensagemWhatsApp(it, empresa = EMPRESA) {
  const nome = nomeAnuncio(it);
  const preco = precoVenda(it);
  return [
    `Olá! Tenho interesse neste produto do ${empresa.nome}:`,
    "",
    `*${nome}*`,
    it.sku ? `Cód: ${it.sku}` : null,
    preco != null ? `Valor: ${fmtBRL(preco)}` : "Valor: sob consulta",
    "",
    "Está disponível?",
  ].filter((l) => l != null).join("\n");
}

const CSS = `
@page { size:A4; margin:0; }
* { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
html,body { margin:0; padding:0; font-family:Arial,"Helvetica Neue",Helvetica,sans-serif; color:#22303c; }
:root{ --navy:#004078; --cyan:#2BB5E8; --green:#5CB85C; --ink:#22303c; --line:#e6ebf0; }
.sheet{ width:210mm; min-height:297mm; padding:14mm 15mm 0; position:relative; display:flex; flex-direction:column; }
.head{ display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid var(--line); padding-bottom:9px; }
.head img{ height:11mm; }
.badge{ font-size:8pt; font-weight:800; letter-spacing:.6px; text-transform:uppercase; padding:5px 12px; border-radius:20px; }
.badge.novo{ background:#e7f6ec; color:#2f8b46; } .badge.semi{ background:#eaf4fb; color:#1f6fa8; }
.badge.aberta{ background:#fdf3e6; color:#bd7a1e; } .badge.asis{ background:#f1f3f5; color:#5f6b76; }
.photo{ margin-top:9mm; height:92mm; background:#f6f9fb; border:1px solid var(--line); border-radius:12px; display:flex; align-items:center; justify-content:center; overflow:hidden; }
.photo img{ max-width:100%; max-height:100%; object-fit:contain; }
.photo .noimg{ color:#9db3c4; font-size:11pt; letter-spacing:1px; }
.thumbs{ display:flex; gap:6px; margin-top:6px; }
.thumbs .t{ width:28mm; height:22mm; background:#f6f9fb; border:1px solid var(--line); border-radius:7px; overflow:hidden; }
.thumbs img{ width:100%; height:100%; object-fit:cover; }
.pname{ font-size:19pt; font-weight:800; color:var(--ink); line-height:1.15; margin-top:7mm; }
.pmodel{ font-size:9pt; color:#8693a0; letter-spacing:.6px; text-transform:uppercase; margin-top:3px; }
.pdesc{ font-size:9.5pt; color:#5f6e7a; line-height:1.45; margin-top:6px; }
.priceband{ margin-top:6mm; border-radius:12px; background:linear-gradient(90deg,var(--cyan),var(--green)); color:#fff; padding:12px 18px; display:flex; align-items:center; justify-content:space-between; }
.priceband .lbl{ font-size:9pt; font-weight:700; letter-spacing:1px; opacity:.95; }
.priceband .val{ font-size:27pt; font-weight:800; line-height:1; }
.paycond{ font-size:8.5pt; color:#5f6e7a; margin-top:5px; }
.specs{ margin-top:6mm; display:grid; grid-template-columns:1fr 1fr; gap:0 22px; }
.specs .row{ display:flex; justify-content:space-between; border-bottom:1px dotted var(--line); padding:5px 0; font-size:9.5pt; }
.specs .k{ color:#8a98a5; } .specs .v{ color:var(--ink); font-weight:700; text-align:right; }
.estado{ margin-top:5mm; font-size:9pt; color:#5f6e7a; line-height:1.5; }
.estado b{ color:var(--navy); }
.foot{ margin-top:auto; }
.cta{ background:#0a2540; border-radius:14px; padding:6mm 7mm; display:flex; align-items:center; gap:7mm; color:#fff; }
.cta .wbtn{ flex:1; }
.cta .wbtn .b{ background:#25D366; color:#fff; font-size:13pt; font-weight:800; padding:11px 16px; border-radius:9px; display:inline-block; }
.cta .wbtn .n{ font-size:10pt; margin-top:7px; color:#cfe0ee; }
.cta .qr{ background:#fff; padding:6px; border-radius:9px; } .cta .qr img{ width:26mm; height:26mm; display:block; }
.bar{ height:7px; background:linear-gradient(90deg,var(--cyan),var(--green)); margin-top:6mm; }
`;

// Monta o HTML A4 completo. opts: { fotos:{principal,galeria[]}, qrDataUrl, empresa,
// pagamento, entrega }. Sem preço → "Sob consulta"; sem foto → placeholder.
export function gerarAnuncioHTML(it, opts = {}) {
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
    `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">` +
    `<title>${escapeHtml(nome)} — ${escapeHtml(empresa.nome)}</title><style>${CSS}</style></head><body>` +
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
    `</div></body></html>`
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node scripts/test_anuncio.mjs`
Expected: PASS — todas as asserções `ok`, imprime `N asserções OK`

- [ ] **Step 5: Registrar no pipeline de testes**

Modify `package.json`: adicionar o script e encadear em `test`:

```json
    "test:anuncio": "node scripts/test_anuncio.mjs",
    "test": "npm run test:pricing && npm run test:categoria && npm run test:preflight && npm run test:precoview && npm run test:catalogo && npm run test:anuncio"
```

(adicione a linha `test:anuncio` junto aos demais `test:*` e acrescente `&& npm run test:anuncio` ao final do valor de `test`.)

- [ ] **Step 6: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS em todas as suítes, incluindo `test:anuncio`

- [ ] **Step 7: Commit**

```bash
git add src/lib/anuncioTemplate.js scripts/test_anuncio.mjs package.json
git commit -m "feat(orcamento): template A4 puro do anúncio + testes (anuncioTemplate.js)"
```

---

## Task 3: Orquestração com rede (`anuncio.js`)

**Files:**
- Create: `src/lib/anuncio.js`

Sem teste unitário (depende de Supabase/`fetch`). Validação por lint + uso na tela (Task 5).

- [ ] **Step 1: Criar o arquivo**

```js
// Orquestra a geração do anúncio/orçamento de um item: busca TODAS as fotos do SKU,
// gera o QR do link de WhatsApp e monta o HTML A4 (anuncioTemplate). A impressão reusa
// o iframe isolado do portfólio (imprimirPortfolio → diálogo "Salvar como PDF").
import { supabase } from "./supabase.js";
import { fotosComoDataURI, imprimirPortfolio } from "./portfolio.js";
import { genQrDataUrl } from "./labels.js";
import { EMPRESA, waLink } from "./empresa.js";
import { gerarAnuncioHTML, mensagemWhatsApp } from "./anuncioTemplate.js";

const BUCKET = "fotos-produtos";

// Todas as fotos do SKU (ordenadas por `ordem`) já como dataURI. A 1ª é a principal.
// Retorna { principal, galeria: [] } — best-effort (foto que falhar é omitida).
export async function fotosDoItem(sku) {
  if (!sku) return { principal: null, galeria: [] };
  const { data, error } = await supabase
    .from("fotos").select("storage_path, ordem").eq("sku", sku).order("ordem");
  if (error || !data?.length) return { principal: null, galeria: [] };

  const paths = data.map((f) => f.storage_path);
  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
  // Chaves sintéticas f0..fN preservam a ORDEM ao converter para dataURI.
  const urls = {};
  (signed || []).forEach((s, i) => { if (s?.signedUrl) urls[`f${i}`] = s.signedUrl; });
  const dataUris = await fotosComoDataURI(urls);
  const ordenadas = paths.map((_, i) => dataUris[`f${i}`]).filter(Boolean);
  return { principal: ordenadas[0] || null, galeria: ordenadas.slice(1) };
}

// Monta o anúncio completo (NÃO imprime). Retorna { html, mensagem, link }.
export async function montarAnuncio(item, empresa = EMPRESA) {
  const mensagem = mensagemWhatsApp(item, empresa);
  const link = waLink(mensagem);
  const [fotos, qrDataUrl] = await Promise.all([
    fotosDoItem(item.sku),
    genQrDataUrl(link),
  ]);
  const html = gerarAnuncioHTML(item, { fotos, qrDataUrl, empresa });
  return { html, mensagem, link };
}

// Impressão (iframe isolado → diálogo do navegador com "Salvar como PDF").
export const imprimirAnuncio = imprimirPortfolio;
```

- [ ] **Step 2: Verificar que o parser aceita o módulo (lint)**

Run: `npm run lint`
Expected: sem erros novos em `src/lib/anuncio.js`

- [ ] **Step 3: Commit**

```bash
git add src/lib/anuncio.js
git commit -m "feat(orcamento): orquestração (fotos+QR+montar+imprimir) em anuncio.js"
```

---

## Task 4: Modal de prévia (`AnuncioModal.jsx`)

**Files:**
- Create: `src/components/AnuncioModal.jsx`

- [ ] **Step 1: Criar o componente**

```jsx
// Modal de prévia do anúncio/orçamento de um item: renderiza o HTML A4 num iframe
// (srcDoc, sem o CSS do app) e oferece Copiar mensagem / WhatsApp / Salvar PDF.
import React, { useEffect, useState } from "react";
import { X, Loader2, Printer, Copy, MessageCircle, Check } from "lucide-react";
import { montarAnuncio, imprimirAnuncio } from "../lib/anuncio";
import { precoVenda } from "../lib/export";

export default function AnuncioModal({ item, onClose }) {
  const [loading, setLoading] = useState(true);
  const [dados, setDados] = useState(null); // { html, mensagem, link }
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const d = await montarAnuncio(item);
        if (!cancel) setDados(d);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [item]);

  const semPreco = precoVenda(item) == null;
  const semFoto = !item.foto_feita;

  const copiar = async () => {
    if (!dados) return;
    try {
      await navigator.clipboard.writeText(dados.mensagem);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch { /* clipboard indisponível */ }
  };
  const abrirWhats = () => { try { window.open(dados.link, "_blank"); } catch { /* noop */ } };

  return (
    <div className="fixed inset-0 z-[75] bg-gray-100 flex flex-col">
      <div className="bg-gray-900 text-white px-4 py-3 flex items-center justify-between shadow-md">
        <span className="font-bold">Orçamento — {item.sku}</span>
        <button onClick={onClose} className="p-1.5 rounded-lg bg-gray-800" aria-label="Fechar">
          <X className="w-5 h-5" />
        </button>
      </div>

      {(semPreco || semFoto) && (
        <div className="px-4 py-2 text-xs bg-amber-50 text-amber-800 border-b border-amber-200 space-y-0.5">
          {semPreco && <div>⚠ Sem preço ideal — o anúncio sai como "Sob consulta". Defina o preço no item.</div>}
          {semFoto && <div>⚠ Sem foto — o anúncio sai com placeholder.</div>}
        </div>
      )}

      <div className="flex-1 overflow-auto p-3 flex items-start justify-center">
        {loading && <Loader2 className="w-8 h-8 animate-spin text-orange-500 mt-10" />}
        {!loading && dados && (
          <iframe title="Prévia do anúncio" srcDoc={dados.html}
            className="bg-white shadow-lg w-full max-w-[210mm]"
            style={{ aspectRatio: "210 / 297", border: 0 }} />
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

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: sem erros novos em `src/components/AnuncioModal.jsx`

- [ ] **Step 3: Commit**

```bash
git add src/components/AnuncioModal.jsx
git commit -m "feat(orcamento): modal de prévia com Copiar/WhatsApp/Salvar PDF"
```

---

## Task 5: Botão "Orçamento" no `ItemDetail`

**Files:**
- Modify: `src/screens/ItemDetail.jsx`

O ícone `Receipt` já está importado (linha 5). `Loader2`, `Suspense`, `React.lazy` também já existem no arquivo.

- [ ] **Step 1: Adicionar o import lazy do modal**

Logo após a linha `const LabelPrint = React.lazy(() => import("../components/labels/LabelPrint"));` (≈ linha 24), adicionar:

```jsx
const AnuncioModal = React.lazy(() => import("../components/AnuncioModal"));
```

- [ ] **Step 2: Adicionar o estado do modal**

Logo após `const [printing, setPrinting] = useState(false);` (≈ linha 64), adicionar:

```jsx
  const [anuncio, setAnuncio] = useState(false);
```

- [ ] **Step 3: Adicionar o botão na barra de ações**

Na barra do topo, logo após o botão "Etiqueta" (`<button onClick={() => setPrinting(true)} ...> ... Etiqueta </button>`, ≈ linha 534-536), inserir:

```jsx
            <button onClick={() => setAnuncio(true)}
              className="flex items-center gap-1 bg-gray-800 rounded-full pl-2.5 pr-3 py-1 text-xs font-semibold text-gray-100"
              title="Gerar orçamento/anúncio (PDF)">
              <Receipt className="w-3.5 h-3.5" /> Orçamento
            </button>
```

- [ ] **Step 4: Renderizar o modal**

Logo após o bloco `{printing && ( ... </Suspense> )}` (≈ linha 1013), inserir:

```jsx
      {anuncio && (
        <Suspense fallback={<div className="fixed inset-0 z-[75] bg-white flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>}>
          <AnuncioModal item={it} onClose={() => setAnuncio(false)} />
        </Suspense>
      )}
```

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: sem erros novos em `src/screens/ItemDetail.jsx`

- [ ] **Step 6: Verificação manual no app**

Run: `npm run dev` e abrir a app.
1. Abrir um item **com preço e foto** → tocar em **Orçamento**.
   Esperado: modal abre, prévia A4 renderiza com foto, faixa de preço gradiente, ficha técnica, CTA verde + QR.
2. Tocar **Salvar PDF** → abre o diálogo de impressão do navegador (dá pra "Salvar como PDF").
3. Tocar **Copiar msg** → vira "Copiado"; colar em algum lugar mostra a mensagem com nome/preço.
4. Tocar **WhatsApp** → abre `wa.me/5591983929085` com a mensagem preenchida.
5. Abrir um item **sem preço** → banner de aviso aparece e a faixa mostra "Sob consulta".
6. Abrir um item **sem foto** → banner de aviso e placeholder "SEM FOTO".

- [ ] **Step 7: Commit**

```bash
git add src/screens/ItemDetail.jsx
git commit -m "feat(orcamento): botão Orçamento + modal lazy no ItemDetail"
```

---

## Self-Review (feito na escrita do plano)

- **Cobertura da spec:** empresa/config (T1) · template A4 layout C com todos os blocos incl. descrição da IA e specs (T2) · fotos+QR+impressão (T3) · modal com Copiar/WhatsApp/Salvar PDF + avisos sem preço/sem foto (T4) · botão no ItemDetail (T5). ✔
- **Sem placeholders:** todo código está completo e literal. ✔
- **Consistência de tipos/nomes:** `fotos:{principal,galeria[]}` produzido por `fotosDoItem` e consumido por `gerarAnuncioHTML`; `montarAnuncio`→`{html,mensagem,link}` consumido pelo `AnuncioModal`; `genQrDataUrl`/`fotosComoDataURI`/`imprimirPortfolio`/`CATALOGO_ESTADO_BADGE`/`LOGO_HORIZONTAL`/`precoVenda`/`fmtBRL`/`fmtKg`/`embalagemLabel` conferidos nos arquivos-fonte. ✔
- **Reuso:** nenhuma reimplementação de impressão, QR ou fotos→dataURI. ✔
```
