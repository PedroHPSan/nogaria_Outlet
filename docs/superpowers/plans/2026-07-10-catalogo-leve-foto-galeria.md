# Catálogo leve + link compartilhável + foto da galeria — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir adicionar foto da galeria no mobile, gerar o catálogo num Web Worker (com progresso/cancelar, sem crash silencioso e PDF mais leve) e compartilhar o catálogo por um link público que expira em 30 dias.

**Architecture:** SPA React + Vite + Supabase (anon key, RLS), deploy Vercel (rewrites tudo p/ `/`). App inteiro atrás de login; sem router. O link público renderiza em `main.jsx` **antes** do `<App>`, lendo um snapshot congelado da tabela `catalogos_publicos`. O processamento de imagens do catálogo sai da thread principal para um Web Worker.

**Tech Stack:** React 18, Vite 5, Supabase JS, Web Worker + OffscreenCanvas, Tailwind, lucide-react. Testes puros em Node (`scripts/test_*.mjs`, `assert/strict`).

**Spec:** `docs/superpowers/specs/2026-07-10-catalogo-leve-foto-galeria-design.md`

---

## Estrutura de arquivos

**Módulo 1 — Foto galeria (sem banco):**
- Criar: `src/components/FotoInputs.jsx` — 2 inputs ocultos (câmera + galeria) via `forwardRef`.
- Modificar: `src/screens/FotoQrScreen.jsx`, `src/screens/ItemDetail.jsx`, `src/screens/ItemsScreen.jsx`.

**Módulo 2 — Motor em Web Worker:**
- Criar: `src/lib/catalogoImagensCore.js` — puro (dimensionar + constantes). Testável.
- Criar: `src/lib/catalogoWorker.js` — worker (fetch + OffscreenCanvas + progresso).
- Criar: `src/lib/catalogoImagens.js` — wrapper main-thread (spawn worker + fallback + cancel).
- Modificar: `src/screens/PortfolioScreen.jsx` (overlay de progresso), `src/lib/portfolio.js` (timeout guard).
- Criar teste: `scripts/test_catalogoimagens.mjs`.

**Módulo 3 — Link público:**
- Migration Supabase: tabela `catalogos_publicos` + RLS.
- Criar: `src/lib/catalogoPublico.js` — `montarPayload` (puro), `slugDeBytes` (puro), `gerarSlug`, `publicarCatalogo`, `buscarCatalogoPublico`.
- Criar: `src/screens/CatalogoPublicoView.jsx` — página pública autônoma.
- Modificar: `src/main.jsx` (rota `/c/`), `src/screens/PortfolioScreen.jsx` (botão "Gerar link").
- Criar teste: `scripts/test_catalogopublico.mjs`.

> **Nota de teste:** o repo só tem testes puros em Node. Componentes React e código de browser (worker, canvas, clipboard, supabase) são verificados **manualmente** (`npm run build` + teste no navegador). Só as funções puras ganham teste automatizado.

---

## MÓDULO 1 — Foto da galeria no mobile

### Task 1: Componente `FotoInputs`

**Files:**
- Create: `src/components/FotoInputs.jsx`

- [ ] **Step 1: Criar o componente**

`src/components/FotoInputs.jsx`:

```jsx
import React, { forwardRef, useImperativeHandle, useRef } from "react";

// Dois inputs de arquivo ocultos que compartilham o mesmo handler de fotos.
// - "câmera": capture="environment" → abre a câmera direto (atalho no mobile).
// - "galeria": SEM capture → deixa o SO oferecer a galeria/arquivos.
// Exposto por ref: abrirCamera() / abrirGaleria(). `onFiles` recebe o FileList.
const FotoInputs = forwardRef(function FotoInputs({ onFiles }, ref) {
  const camRef = useRef();
  const galRef = useRef();

  useImperativeHandle(ref, () => ({
    abrirCamera: () => camRef.current?.click(),
    abrirGaleria: () => galRef.current?.click(),
  }));

  const handle = (e) => {
    const files = e.target.files;
    e.target.value = "";
    if (files && files.length) onFiles(files);
  };

  return (
    <>
      <input ref={camRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={handle} />
      <input ref={galRef} type="file" accept="image/*" multiple className="hidden" onChange={handle} />
    </>
  );
});

export default FotoInputs;
```

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: build passa sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/components/FotoInputs.jsx
git commit -m "feat(fotos): componente FotoInputs (câmera + galeria)"
```

---

### Task 2: FotoQrScreen — botão Galeria

**Files:**
- Modify: `src/screens/FotoQrScreen.jsx`

- [ ] **Step 1: Importar o componente**

Trocar a linha 3:

```jsx
import { enviarFoto, marcarFotoFeita } from "../lib/fotos";
```

por:

```jsx
import { enviarFoto, marcarFotoFeita } from "../lib/fotos";
import FotoInputs from "../components/FotoInputs";
import { Images } from "lucide-react";
```

- [ ] **Step 2: Trocar o `fileRef` pela ref do componente**

Trocar a linha 20 `const fileRef = useRef();` por:

```jsx
  const fotoRef = useRef();
```

(Se `useRef` deixar de ser usado em outro ponto, manter o import — ainda é usado aqui.)

- [ ] **Step 3: Substituir o botão único e o input**

Trocar o bloco das linhas 83-89 (o botão "Tirar / enviar foto" + o `<input>`) por:

```jsx
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => fotoRef.current?.abrirCamera()} disabled={uploading}
              className="flex items-center justify-center gap-2 bg-orange-500 text-white rounded-2xl py-5 text-base font-bold shadow-sm active:bg-orange-600 disabled:opacity-50">
              {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Camera className="w-6 h-6" />}
              Câmera
            </button>
            <button onClick={() => fotoRef.current?.abrirGaleria()} disabled={uploading}
              className="flex items-center justify-center gap-2 bg-gray-800 text-white rounded-2xl py-5 text-base font-bold shadow-sm active:bg-gray-900 disabled:opacity-50">
              {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Images className="w-6 h-6" />}
              Galeria
            </button>
          </div>
          <FotoInputs ref={fotoRef} onFiles={subirFotos} />
```

- [ ] **Step 4: Build + verificação manual**

Run: `npm run build`
Expected: passa. No mobile (ou DevTools responsivo), a tela de Foto por QR mostra **Câmera** e **Galeria**; "Galeria" abre o seletor de imagens do dispositivo e o upload funciona.

- [ ] **Step 5: Commit**

```bash
git add src/screens/FotoQrScreen.jsx
git commit -m "feat(fotos): botão Galeria na tela Foto por QR"
```

---

### Task 3: ItemDetail — botão Galeria

**Files:**
- Modify: `src/screens/ItemDetail.jsx`

- [ ] **Step 1: Importar o componente e o ícone**

Adicionar ao topo (junto aos imports existentes de `../components/...` e `lucide-react`):

```jsx
import FotoInputs from "../components/FotoInputs";
```

E incluir `Images` na lista de ícones importada de `lucide-react` (adicionar `Images` ao import já existente que traz `Camera`).

- [ ] **Step 2: Trocar o `fileRef` pela ref do componente**

Localizar `const fileRef = useRef();` (a ref usada no bloco de fotos, ~onde está `onClick={() => fileRef.current.click()}`) e renomear para:

```jsx
  const fotoRef = useRef();
```

- [ ] **Step 3: Substituir o botão único e o input (linhas ~722-729)**

Trocar o bloco:

```jsx
            <button
              onClick={() => fileRef.current.click()} disabled={uploading}
              className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400"
            >
              {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Camera className="w-6 h-6" />}
            </button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple className="hidden"
              onChange={(e) => { subirFotos(e.target.files); e.target.value = ""; }} />
```

por:

```jsx
            <button
              onClick={() => fotoRef.current?.abrirCamera()} disabled={uploading}
              className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-0.5 text-gray-400"
              title="Tirar foto"
            >
              {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Camera className="w-6 h-6" />}
              <span className="text-[10px] font-semibold">Câmera</span>
            </button>
            <button
              onClick={() => fotoRef.current?.abrirGaleria()} disabled={uploading}
              className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-0.5 text-gray-400"
              title="Escolher da galeria"
            >
              {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Images className="w-6 h-6" />}
              <span className="text-[10px] font-semibold">Galeria</span>
            </button>
            <FotoInputs ref={fotoRef} onFiles={subirFotos} />
```

- [ ] **Step 4: Build + verificação manual**

Run: `npm run build`
Expected: passa. Na ficha do item há dois quadrados tracejados (Câmera e Galeria); "Galeria" abre o seletor e envia.

- [ ] **Step 5: Commit**

```bash
git add src/screens/ItemDetail.jsx
git commit -m "feat(fotos): botão Galeria na ficha do item"
```

---

### Task 4: ItemsScreen — folha de escolha (Câmera/Galeria) no atalho da lista

**Files:**
- Modify: `src/screens/ItemsScreen.jsx`

O atalho de foto na lista é um ícone por linha que dispara `iniciarFoto(sku)`. Como é ícone único, abrimos uma folha inferior com as duas opções.

- [ ] **Step 1: Importar componente e ícones**

Adicionar:

```jsx
import FotoInputs from "../components/FotoInputs";
```

E incluir `Images` e `X` na lista de ícones importada de `lucide-react` (se ainda não estiverem).

- [ ] **Step 2: Trocar `fileRef` por ref do componente e adicionar estado da folha**

Trocar a linha 42 `const fileRef = useRef();` por:

```jsx
  const fotoRef = useRef();
  const [escolherFonte, setEscolherFonte] = useState(false);
```

- [ ] **Step 3: Ajustar `iniciarFoto` para abrir a folha**

Trocar a linha 97:

```jsx
  const iniciarFoto = (sku) => { captureSku.current = sku; fileRef.current?.click(); };
```

por:

```jsx
  const iniciarFoto = (sku) => { captureSku.current = sku; setEscolherFonte(true); };
```

- [ ] **Step 4: Adaptar o handler para o novo componente**

Trocar `aoSelecionarFoto` (linhas 98-119) para receber o `FileList` direto (o `FotoInputs` já limpa o input):

```jsx
  const aoSelecionarFoto = async (fileList) => {
    const files = Array.from(fileList || []);
    const sku = captureSku.current;
    if (!files.length || !sku) return;
    setSavingFoto(sku);
    try {
      let primeira = null;
      const base = Date.now();
      for (let i = 0; i < files.length; i++) {
        const nova = await enviarFoto(sku, files[i], base + i);
        if (!primeira) primeira = nova.url;
      }
      await marcarFotoFeita(sku);
      setFotos((prev) => (prev[sku] ? prev : { ...prev, [sku]: primeira }));
      setItens((arr) => arr.map((it) => (it.sku === sku ? { ...it, foto_feita: true } : it)));
    } catch (err) {
      alert("Falha ao enviar a foto. Tente novamente.");
    } finally {
      setSavingFoto(null);
    }
  };
```

- [ ] **Step 5: Trocar o `<input>` (linhas 352-353) pelo componente + folha de escolha**

Trocar:

```jsx
      <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple className="hidden"
        onChange={aoSelecionarFoto} />
```

por:

```jsx
      <FotoInputs ref={fotoRef} onFiles={aoSelecionarFoto} />
      {escolherFonte && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-end" onClick={() => setEscolherFonte(false)}>
          <div className="w-full bg-white rounded-t-2xl p-4 space-y-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-bold text-gray-800">Adicionar foto</span>
              <button onClick={() => setEscolherFonte(false)} aria-label="Fechar"><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <button onClick={() => { setEscolherFonte(false); fotoRef.current?.abrirCamera(); }}
              className="w-full flex items-center gap-3 bg-orange-500 text-white rounded-xl py-3.5 px-4 font-bold active:bg-orange-600">
              <Camera className="w-5 h-5" /> Câmera
            </button>
            <button onClick={() => { setEscolherFonte(false); fotoRef.current?.abrirGaleria(); }}
              className="w-full flex items-center gap-3 bg-gray-800 text-white rounded-xl py-3.5 px-4 font-bold active:bg-gray-900">
              <Images className="w-5 h-5" /> Escolher da galeria
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 6: Build + verificação manual**

Run: `npm run build`
Expected: passa. Na lista de Itens, tocar no ícone de foto abre uma folha com "Câmera" e "Escolher da galeria"; ambas enviam para o SKU certo.

- [ ] **Step 7: Commit**

```bash
git add src/screens/ItemsScreen.jsx
git commit -m "feat(fotos): folha Câmera/Galeria no atalho de foto da lista"
```

---

## MÓDULO 2 — Motor do catálogo em Web Worker

### Task 5: Núcleo puro do redimensionamento

**Files:**
- Create: `src/lib/catalogoImagensCore.js`
- Test: `scripts/test_catalogoimagens.mjs`

- [ ] **Step 1: Escrever o teste (falha)**

`scripts/test_catalogoimagens.mjs`:

```js
// Teste do núcleo puro de imagens do catálogo. Rode: npm run test:catalogoimagens
import assert from "node:assert/strict";
import { dimensionarAlvo, MAX_LADO, JPEG_QUALITY } from "../src/lib/catalogoImagensCore.js";

let passou = 0;
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); passou++; console.log(`  ok  ${msg}`); };
const ok = (c, msg) => { assert.ok(c, msg); passou++; console.log(`  ok  ${msg}`); };

console.log("constantes de compressão");
ok(MAX_LADO === 1000, "MAX_LADO = 1000");
ok(JPEG_QUALITY > 0 && JPEG_QUALITY < 1, "JPEG_QUALITY entre 0 e 1");

console.log("\ndimensionarAlvo mantém proporção e limita o lado maior");
eq(dimensionarAlvo(2000, 1000, 1000), { w: 1000, h: 500 }, "paisagem 2000x1000 → 1000x500");
eq(dimensionarAlvo(1000, 2000, 1000), { w: 500, h: 1000 }, "retrato 1000x2000 → 500x1000");
eq(dimensionarAlvo(800, 600, 1000), { w: 800, h: 600 }, "menor que o alvo não amplia");
eq(dimensionarAlvo(3000, 3000, 1000), { w: 1000, h: 1000 }, "quadrado grande → 1000x1000");

console.log(`\n${passou} asserções OK`);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/test_catalogoimagens.mjs`
Expected: FALHA (`Cannot find module .../catalogoImagensCore.js`).

- [ ] **Step 3: Implementar o núcleo**

`src/lib/catalogoImagensCore.js`:

```js
// Núcleo PURO do preparo de imagens do catálogo (sem browser/rede): parâmetros de
// compressão e cálculo do tamanho-alvo. Importável em Node para teste; usado tanto
// pelo Web Worker quanto pelo fallback no main-thread.

// Lado maior máximo (px) da foto embutida no PDF e qualidade do JPEG. Equilíbrio
// nitidez × peso definido no spec (2026-07-10).
export const MAX_LADO = 1000;
export const JPEG_QUALITY = 0.72;

// Retorna { w, h } inteiros mantendo a proporção, com o lado maior limitado a
// maxLado. Nunca amplia (imagens menores que maxLado passam iguais).
export function dimensionarAlvo(w, h, maxLado = MAX_LADO) {
  const largura = Math.max(1, Math.round(w || 0));
  const altura = Math.max(1, Math.round(h || 0));
  const maior = Math.max(largura, altura);
  if (maior <= maxLado) return { w: largura, h: altura };
  const escala = maxLado / maior;
  return { w: Math.max(1, Math.round(largura * escala)), h: Math.max(1, Math.round(altura * escala)) };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node scripts/test_catalogoimagens.mjs`
Expected: PASS (todas as asserções OK).

- [ ] **Step 5: Registrar o script de teste**

Em `package.json`, no bloco `scripts`, adicionar após a linha `"test:iaanalise"`:

```json
    "test:catalogoimagens": "node scripts/test_catalogoimagens.mjs",
```

E incluir `&& npm run test:catalogoimagens` no final do script `"test"`.

- [ ] **Step 6: Rodar a suíte**

Run: `npm test`
Expected: todos os testes, incluindo `test:catalogoimagens`, passam.

- [ ] **Step 7: Commit**

```bash
git add src/lib/catalogoImagensCore.js scripts/test_catalogoimagens.mjs package.json
git commit -m "feat(catalogo): núcleo puro de redimensionamento de imagem + teste"
```

---

### Task 6: Web Worker de preparo de fotos

**Files:**
- Create: `src/lib/catalogoWorker.js`

- [ ] **Step 1: Escrever o worker**

`src/lib/catalogoWorker.js`:

```js
// Web Worker: baixa cada foto, redimensiona (OffscreenCanvas) e re-encoda em JPEG
// comprimido → dataURI base64. Emite progresso a cada foto. Best-effort: foto que
// falhar é omitida. Roda fora da thread principal (não trava a UI).
import { dimensionarAlvo, MAX_LADO, JPEG_QUALITY } from "./catalogoImagensCore.js";

async function blobParaDataURI(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return `data:image/jpeg;base64,${btoa(bin)}`;
}

async function comprimir(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("fetch falhou");
  const bmp = await createImageBitmap(await resp.blob());
  const { w, h } = dimensionarAlvo(bmp.width, bmp.height, MAX_LADO);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const out = await canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
  return blobParaDataURI(out);
}

self.onmessage = async (e) => {
  const { entradas } = e.data; // [{ sku, url }]
  const total = entradas.length;
  const fotos = {};
  let feitas = 0;
  for (const { sku, url } of entradas) {
    try {
      fotos[sku] = await comprimir(url);
    } catch {
      /* omite esta foto */
    }
    feitas++;
    self.postMessage({ tipo: "progresso", feitas, total });
  }
  self.postMessage({ tipo: "fim", fotos });
};
```

- [ ] **Step 2: Build (garante que o Vite empacota o worker)**

Run: `npm run build`
Expected: build passa. (O worker é referenciado na Task 7 via `new URL(...)`; o Vite só o empacota quando importado — validação real de bundling ocorre após a Task 7.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/catalogoWorker.js
git commit -m "feat(catalogo): Web Worker de compressão de fotos"
```

---

### Task 7: Wrapper main-thread (spawn + progresso + cancelar + fallback)

**Files:**
- Create: `src/lib/catalogoImagens.js`

- [ ] **Step 1: Escrever o wrapper**

`src/lib/catalogoImagens.js`:

```js
// Prepara as fotos do catálogo para embutir no PDF, fora da thread principal.
// Sobe um Web Worker que baixa/redimensiona/comprime cada foto e reporta progresso.
// Fallback (sem Worker/OffscreenCanvas): comprime no main-thread em canvas comum,
// cedendo o event loop entre fotos para não travar a UI.
import { dimensionarAlvo, MAX_LADO, JPEG_QUALITY } from "./catalogoImagensCore.js";

const temWorker = typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";

// entradas: [{ sku, url }]. opts: { onProgress?({feitas,total}), signal?: AbortSignal }.
// Retorna { [sku]: dataURI }. Se signal abortar, rejeita com Error("cancelado").
export function prepararFotos(entradas, { onProgress, signal } = {}) {
  const lista = (entradas || []).filter((e) => e && e.url);
  if (!lista.length) return Promise.resolve({});
  return temWorker ? viaWorker(lista, onProgress, signal) : viaFallback(lista, onProgress, signal);
}

function viaWorker(lista, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./catalogoWorker.js", import.meta.url), { type: "module" });
    const onAbort = () => { worker.terminate(); reject(new Error("cancelado")); };
    if (signal) {
      if (signal.aborted) { worker.terminate(); return reject(new Error("cancelado")); }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.tipo === "progresso") onProgress?.({ feitas: m.feitas, total: m.total });
      else if (m.tipo === "fim") {
        signal?.removeEventListener("abort", onAbort);
        worker.terminate();
        resolve(m.fotos);
      }
    };
    worker.onerror = () => { signal?.removeEventListener("abort", onAbort); worker.terminate(); reject(new Error("worker falhou")); };
    worker.postMessage({ entradas: lista });
  });
}

async function comprimirMain(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("fetch falhou");
  const bmp = await createImageBitmap(await resp.blob());
  const { w, h } = dimensionarAlvo(bmp.width, bmp.height, MAX_LADO);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

async function viaFallback(lista, onProgress, signal) {
  const fotos = {};
  let feitas = 0;
  for (const { sku, url } of lista) {
    if (signal?.aborted) throw new Error("cancelado");
    try { fotos[sku] = await comprimirMain(url); } catch { /* omite */ }
    feitas++;
    onProgress?.({ feitas, total: lista.length });
    await new Promise((r) => setTimeout(r, 0)); // cede o event loop
  }
  return fotos;
}
```

- [ ] **Step 2: Build (valida bundling do worker)**

Run: `npm run build`
Expected: build passa e o Vite emite um chunk do worker (arquivo separado em `dist/assets`).

- [ ] **Step 3: Commit**

```bash
git add src/lib/catalogoImagens.js
git commit -m "feat(catalogo): wrapper prepararFotos (worker + fallback + cancelar)"
```

---

### Task 8: PortfolioScreen — overlay de progresso + cancelar no "Gerar PDF"

**Files:**
- Modify: `src/screens/PortfolioScreen.jsx`

- [ ] **Step 1: Trocar imports**

Na linha 9, remover `fotosComoDataURI` do import de `../lib/portfolio` (manter os demais):

```jsx
import { imprimirPortfolio, ordenarTamanhos, tamanhoLabel } from "../lib/portfolio";
```

Adicionar após a linha 9:

```jsx
import { prepararFotos } from "../lib/catalogoImagens";
```

E incluir `X` na lista de ícones importada de `lucide-react` (linha 2-4).

- [ ] **Step 2: Adicionar estado de progresso**

Após a linha 68 (`const [gerando, setGerando] = useState(false);`) adicionar:

```jsx
  const [progresso, setProgresso] = useState(null); // { feitas, total } enquanto prepara fotos
  const abortRef = useRef(null);
```

- [ ] **Step 3: Reescrever `gerar()` (linhas 131-155)**

```jsx
  const gerar = async () => {
    if (!total) return;
    setGerando(true);
    try {
      const cards = dedupCatalogo(itens);
      const secoes = agruparCatalogo(cards, agrupar);
      const cats = [...new Set(itens.map((i) => (i.grupo || "").trim()).filter(Boolean))];
      let fotosPdf = {};
      if (comFoto) {
        const entradas = cards
          .map((c) => ({ sku: c.rep.sku, url: fotos[c.rep.sku] }))
          .filter((e) => e.url);
        if (entradas.length) {
          const ctrl = new AbortController();
          abortRef.current = ctrl;
          setProgresso({ feitas: 0, total: entradas.length });
          try {
            fotosPdf = await prepararFotos(entradas, {
              signal: ctrl.signal,
              onProgress: (p) => setProgresso(p),
            });
          } catch (err) {
            if (err?.message === "cancelado") return; // usuário cancelou: aborta silenciosamente
            throw err;
          } finally {
            abortRef.current = null;
            setProgresso(null);
          }
        }
      }
      const html = gerarCatalogoHTML(secoes, {
        titulo: titulo.trim() || "Catálogo de Produtos",
        subtitulo: cats.join(" · "),
        edicao, parcial, comFoto, mostrarPreco, fotos: fotosPdf,
      });
      imprimirPortfolio(html);
    } finally {
      setGerando(false);
    }
  };
```

- [ ] **Step 4: Adicionar o overlay de progresso**

Logo antes do fechamento final `</div>` do componente (após o bloco da "Barra de geração", ~linha 323), adicionar:

```jsx
      {progresso && (
        <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center px-8">
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl">
            <p className="text-sm font-bold text-gray-800 mb-1">Preparando o catálogo…</p>
            <p className="text-xs text-gray-500 mb-3">Comprimindo {progresso.feitas} de {progresso.total} fotos</p>
            <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
              <div className="h-full bg-orange-500 transition-all"
                style={{ width: `${progresso.total ? Math.round((progresso.feitas / progresso.total) * 100) : 0}%` }} />
            </div>
            <button onClick={() => abortRef.current?.abort()}
              className="mt-4 w-full flex items-center justify-center gap-1.5 border border-gray-300 text-gray-700 rounded-xl py-2.5 text-sm font-semibold active:bg-gray-100">
              <X className="w-4 h-4" /> Cancelar
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Build + verificação manual**

Run: `npm run build`
Expected: passa. Ao gerar um catálogo com fotos, aparece o overlay "Comprimindo X de N fotos" com barra avançando; **Cancelar** interrompe e fecha; sem fotos ou ao terminar, abre o diálogo de impressão. O PDF resultante é visivelmente mais leve que antes.

- [ ] **Step 6: Commit**

```bash
git add src/screens/PortfolioScreen.jsx
git commit -m "feat(catalogo): progresso + cancelar ao gerar PDF (Web Worker)"
```

---

### Task 9: Timeout guard na impressão

**Files:**
- Modify: `src/lib/portfolio.js`

Hoje, se o diálogo de impressão não retornar, nada avisa o usuário. Adicionamos um retorno de status.

- [ ] **Step 1: Ajustar `imprimirPortfolio` para retornar uma Promise resolvida no fim/timeout**

Na função `imprimirPortfolio` (linha 171), trocar a assinatura e o `cleanup`/final para resolver uma Promise. Substituir de `export function imprimirPortfolio(html) {` até o `}` final da função por:

```js
export function imprimirPortfolio(html) {
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    Object.assign(iframe.style, {
      position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0", visibility: "hidden",
    });
    document.body.appendChild(iframe);

    let done = false;
    const cleanup = (resultado) => {
      if (done) return;
      done = true;
      resolve(resultado);
      setTimeout(() => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }, 500);
    };

    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();

    const imgs = Array.from(doc.images || []);
    Promise.all(imgs.map(waitImage)).then(() => {
      const win = iframe.contentWindow;
      requestAnimationFrame(() => {
        try {
          win.focus();
          win.onafterprint = () => cleanup("impresso");
          win.print();
        } catch {
          cleanup("erro");
        }
        setTimeout(() => cleanup("timeout"), 60000);
      });
    });
  });
}
```

- [ ] **Step 2: Build + verificação manual**

Run: `npm run build`
Expected: passa. A impressão continua funcionando; `imprimirPortfolio` agora resolve (`"impresso"`/`"timeout"`/`"erro"`) — comportamento visível inalterado, mas encadeável.

- [ ] **Step 3: Commit**

```bash
git add src/lib/portfolio.js
git commit -m "refactor(catalogo): imprimirPortfolio retorna status (guard de timeout)"
```

---

## MÓDULO 3 — Link web compartilhável (snapshot 30 dias)

### Task 10: Migration `catalogos_publicos` + RLS

> ⚠️ **Requer aprovação de schema (Pedro/Bárbara).** Confirme antes de aplicar. Aplicar via Supabase MCP `apply_migration` (nome: `catalogos_publicos`).

**Files:**
- Migration (Supabase, remoto)

- [ ] **Step 1: Revisar o SQL com o dono do schema**

```sql
create table if not exists public.catalogos_publicos (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  titulo text,
  edicao text,
  payload jsonb not null,
  criado_por uuid references auth.users(id),
  created_at timestamptz not null default now(),
  expira_em timestamptz not null default (now() + interval '30 days')
);

alter table public.catalogos_publicos enable row level security;

-- Leitura pública SOMENTE de catálogos não expirados (link compartilhável).
create policy "catalogos_publicos_select_anon"
  on public.catalogos_publicos for select
  to anon, authenticated
  using (expira_em > now());

-- Só usuário autenticado publica, e como ele mesmo.
create policy "catalogos_publicos_insert_auth"
  on public.catalogos_publicos for insert
  to authenticated
  with check (criado_por = auth.uid());

create index if not exists catalogos_publicos_slug_idx on public.catalogos_publicos (slug);
```

- [ ] **Step 2: Aplicar a migration**

Via Supabase MCP: `apply_migration` com `name: "catalogos_publicos"` e o SQL acima.
Expected: sucesso; `list_tables` mostra `catalogos_publicos`.

- [ ] **Step 3: Conferir advisors de segurança**

Via Supabase MCP: `get_advisors` (security).
Expected: nenhum alerta novo de RLS desabilitado na tabela.

---

### Task 11: `catalogoPublico.js` — payload puro + slug + persistência

**Files:**
- Create: `src/lib/catalogoPublico.js`
- Test: `scripts/test_catalogopublico.mjs`

- [ ] **Step 1: Escrever o teste (falha)**

`scripts/test_catalogopublico.mjs`:

```js
// Teste das funções puras do catálogo público. Rode: npm run test:catalogopublico
import assert from "node:assert/strict";
import { montarPayload, slugDeBytes } from "../src/lib/catalogoPublico.js";

let passou = 0;
const eq = (a, b, msg) => { assert.equal(a, b, msg); passou++; console.log(`  ok  ${msg}`); };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); passou++; console.log(`  ok  ${msg}`); };
const ok = (c, msg) => { assert.ok(c, msg); passou++; console.log(`  ok  ${msg}`); };

// Uma seção como a que agruparCatalogo produz (card = { rep, qtd, skus }).
const secoes = [{
  titulo: "Ferramentas",
  cards: [
    { rep: { sku: "A1", produto: "Furadeira", marca: "Bosch", cor: "Azul", estado: "Novo", preco_ideal: 200 }, qtd: 2, skus: ["A1", "A2"] },
    { rep: { sku: "B1", produto: "Serra", marca: "Makita", cor: "", estado: "Usado", preco_ideal: 150 }, qtd: 1, skus: ["B1"] },
  ],
}];
const fotosUrl = { A1: "https://x/a1.jpg" }; // B1 sem foto

console.log("montarPayload — estrutura e preço visível");
const pv = montarPayload(secoes, { titulo: "Cat", edicao: "Jul/2026", subtitulo: "Ferramentas", mostrarPreco: true }, fotosUrl);
eq(pv.versao, 1, "versao = 1");
eq(pv.titulo, "Cat", "titulo preservado");
eq(pv.mostrarPreco, true, "mostrarPreco true");
eq(pv.totalItens, 3, "totalItens = Σ qtd (2 + 1)");
eq(pv.secoes[0].cards[0].preco, 200, "card com preço (mostrarPreco true)");
eq(pv.secoes[0].cards[0].foto, "https://x/a1.jpg", "foto do rep incluída");
eq(pv.secoes[0].cards[0].qtd, 2, "qtd preservada");
eq(pv.secoes[0].cards[0].badge.txt, "Novo", "selo de condição resolvido");
eq(pv.secoes[0].cards[1].foto, null, "card sem foto → null");

console.log("\nmontarPayload — preço oculto zera preços");
const po = montarPayload(secoes, { mostrarPreco: false }, fotosUrl);
eq(po.secoes[0].cards[0].preco, null, "preço null quando mostrarPreco false");

console.log("\nslugDeBytes — url-safe e determinístico");
const s = slugDeBytes(new Uint8Array([0, 1, 255, 16, 200, 7]));
ok(/^[0-9a-z]+$/.test(s), "slug só tem [0-9a-z]");
eq(s, slugDeBytes(new Uint8Array([0, 1, 255, 16, 200, 7])), "determinístico p/ mesmos bytes");

console.log(`\n${passou} asserções OK`);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/test_catalogopublico.mjs`
Expected: FALHA (módulo não existe).

- [ ] **Step 3: Implementar o módulo**

`src/lib/catalogoPublico.js`:

```js
// Catálogo público (link compartilhável, snapshot de 30 dias). As funções puras
// (montarPayload, slugDeBytes) são testáveis em Node; publicar/buscar tocam o
// supabase. O payload é AUTOCONTIDO: a página pública renderiza só a partir dele,
// sem consultar `itens` nem o storage (anônimo lê um único registro).
import { supabase } from "./supabase.js";
import { precoVenda } from "./export.js";
import { CATALOGO_ESTADO_BADGE } from "./catalogoCore.js";

const VALIDADE_SEG = 30 * 24 * 60 * 60; // 30 dias (para as signed URLs das fotos)

// Monta o snapshot renderizável a partir das seções (agruparCatalogo), das opções
// e do mapa { [sku]: url } de fotos representativas. Puro.
export function montarPayload(secoes, opcoes = {}, fotosUrl = {}) {
  const { titulo = "Catálogo de Produtos", edicao = "", subtitulo = "", mostrarPreco = true } = opcoes;
  let totalItens = 0;
  const secoesOut = (secoes || []).map((sec) => ({
    titulo: sec.titulo,
    cards: (sec.cards || []).map((c) => {
      totalItens += c.qtd || 1;
      const badge = CATALOGO_ESTADO_BADGE[(c.rep.estado || "").trim()] || null;
      return {
        produto: c.rep.produto || c.rep.sku,
        marca: c.rep.marca || "",
        cor: c.rep.cor || "",
        badge: badge ? { txt: badge.txt, cls: badge.cls } : null,
        preco: mostrarPreco ? (precoVenda(c.rep) ?? null) : null,
        qtd: c.qtd || 1,
        foto: fotosUrl[c.rep.sku] || null,
      };
    }),
  }));
  return { versao: 1, titulo, edicao, subtitulo, mostrarPreco, totalItens, secoes: secoesOut };
}

// Converte bytes em um slug url-safe (base36). Puro.
export function slugDeBytes(bytes) {
  let s = "";
  for (const b of bytes) s += (b % 36).toString(36);
  return s;
}

// Gera um slug aleatório (browser: crypto). ~12 chars.
export function gerarSlug() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return slugDeBytes(bytes);
}

// Gera signed URLs de longa validade (30d) das fotos representativas. Retorna
// { [sku]: url }. Best-effort: foto que falhar fica de fora (card sem foto).
async function fotosAssinadas(cards) {
  const skus = cards.map((c) => c.rep.sku);
  if (!skus.length) return {};
  // 1ª foto (menor ordem) de cada SKU.
  const { data } = await supabase.from("fotos").select("sku, storage_path, ordem").in("sku", skus).order("ordem");
  const primeiraPorSku = new Map();
  for (const f of data || []) if (!primeiraPorSku.has(f.sku)) primeiraPorSku.set(f.sku, f.storage_path);
  const paths = [...primeiraPorSku.values()];
  if (!paths.length) return {};
  const { data: signed } = await supabase.storage.from("fotos-produtos").createSignedUrls(paths, VALIDADE_SEG);
  const urlByPath = {};
  for (const s of signed || []) if (s?.signedUrl) urlByPath[s.path] = s.signedUrl;
  const out = {};
  for (const [sku, path] of primeiraPorSku) if (urlByPath[path]) out[sku] = urlByPath[path];
  return out;
}

// Publica o catálogo e retorna { url, expira_em }. `secoes` = saída de agruparCatalogo.
export async function publicarCatalogo(secoes, opcoes = {}) {
  const cards = (secoes || []).flatMap((s) => s.cards || []);
  const fotosUrl = opcoes.comFoto === false ? {} : await fotosAssinadas(cards);
  const payload = montarPayload(secoes, opcoes, fotosUrl);
  const { data: sess } = await supabase.auth.getUser();
  const slug = gerarSlug();
  const { data, error } = await supabase
    .from("catalogos_publicos")
    .insert({ slug, titulo: payload.titulo, edicao: payload.edicao, payload, criado_por: sess?.user?.id })
    .select("slug, expira_em")
    .single();
  if (error) throw error;
  return { url: `${window.location.origin}/c/${data.slug}`, expira_em: data.expira_em };
}

// Busca um catálogo público pelo slug. Retorna { titulo, edicao, payload, expira_em }
// ou null (expirado/inexistente — o RLS já filtra os expirados).
export async function buscarCatalogoPublico(slug) {
  const { data, error } = await supabase
    .from("catalogos_publicos")
    .select("titulo, edicao, payload, expira_em")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `node scripts/test_catalogopublico.mjs`
Expected: PASS.

- [ ] **Step 5: Registrar o script de teste**

Em `package.json`, adicionar após `"test:catalogoimagens"`:

```json
    "test:catalogopublico": "node scripts/test_catalogopublico.mjs",
```

E incluir `&& npm run test:catalogopublico` no final do script `"test"`.

- [ ] **Step 6: Rodar a suíte e commitar**

Run: `npm test`
Expected: tudo passa.

```bash
git add src/lib/catalogoPublico.js scripts/test_catalogopublico.mjs package.json
git commit -m "feat(catalogo): módulo de link público (payload puro + persistência) + testes"
```

---

### Task 12: Página pública `CatalogoPublicoView`

**Files:**
- Create: `src/screens/CatalogoPublicoView.jsx`

- [ ] **Step 1: Escrever a página**

`src/screens/CatalogoPublicoView.jsx`:

```jsx
import React, { useEffect, useState } from "react";
import { buscarCatalogoPublico } from "../lib/catalogoPublico";
import { fmtBRL } from "../lib/model";
import { Loader2, Boxes } from "lucide-react";

// Selos de condição → cor (mesma paleta da galeria interna).
const BADGE_CLS = {
  novo: "bg-emerald-100 text-emerald-700",
  aberta: "bg-amber-100 text-amber-700",
  semi: "bg-sky-100 text-sky-700",
  asis: "bg-gray-200 text-gray-700",
};

// Página PÚBLICA (sem login) de um catálogo compartilhado. Lê só o snapshot do
// slug; renderiza a partir do payload autocontido.
export default function CatalogoPublicoView({ slug }) {
  const [estado, setEstado] = useState("carregando"); // carregando | ok | indisponivel
  const [dados, setDados] = useState(null);

  useEffect(() => {
    let vivo = true;
    buscarCatalogoPublico(slug).then((d) => {
      if (!vivo) return;
      if (!d) { setEstado("indisponivel"); return; }
      setDados(d); setEstado("ok");
    });
    return () => { vivo = false; };
  }, [slug]);

  if (estado === "carregando") {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>;
  }
  if (estado === "indisponivel") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 text-center px-8">
        <Boxes className="w-12 h-12 text-gray-300 mb-3" />
        <p className="text-gray-700 font-bold">Catálogo indisponível</p>
        <p className="text-sm text-gray-500 mt-1">Este link expirou ou não existe. Peça um novo à Nogária Outlet.</p>
      </div>
    );
  }

  const p = dados.payload;
  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      <header className="bg-gray-900 text-white px-4 py-4 sticky top-0 z-10">
        <h1 className="text-lg font-bold"><span className="text-orange-400">NOGÁRIA</span> OUTLET</h1>
        <p className="text-sm text-gray-200">{p.titulo}{p.edicao ? ` · ${p.edicao}` : ""}</p>
        {p.subtitulo && <p className="text-xs text-gray-400 mt-0.5">{p.subtitulo}</p>}
      </header>
      <div className="px-4 pt-4 space-y-5 max-w-3xl mx-auto">
        {p.secoes.map((sec, si) => (
          <section key={si}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-bold bg-gray-900 text-white rounded-lg px-2.5 py-1">{sec.titulo}</span>
              <span className="text-xs text-gray-400">{sec.cards.length} {sec.cards.length === 1 ? "item" : "itens"}</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
              {sec.cards.map((c, ci) => (
                <div key={ci} className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
                  <div className="aspect-square bg-gray-100 relative">
                    {c.foto ? (
                      <img src={c.foto} alt="" loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">sem foto</div>
                    )}
                    {c.badge && <span className={`absolute top-1.5 left-1.5 inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold ${BADGE_CLS[c.badge.cls] || "bg-white/90 text-gray-700"}`}>{c.badge.txt}</span>}
                    {c.qtd > 1 && <span className="absolute top-1.5 right-1.5 bg-black/60 text-white rounded-full px-2 py-0.5 text-[9px] font-bold">{c.qtd}un</span>}
                  </div>
                  <div className="p-2 flex-1 flex flex-col">
                    <p className="text-xs font-bold text-gray-900 leading-tight line-clamp-2">{c.produto}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5 truncate">{[c.marca, c.cor].filter(Boolean).join(" · ") || "—"}</p>
                    {p.mostrarPreco && c.preco != null && (
                      <p className="text-sm font-extrabold text-emerald-600 mt-auto pt-1">{fmtBRL(c.preco)}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
        <footer className="text-center text-xs text-gray-400 pt-4">NOGÁRIA OUTLET · {p.totalItens} {p.totalItens === 1 ? "item" : "itens"}</footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: passa.

- [ ] **Step 3: Commit**

```bash
git add src/screens/CatalogoPublicoView.jsx
git commit -m "feat(catalogo): página pública do link compartilhável"
```

---

### Task 13: Rota pública no bootstrap

**Files:**
- Modify: `src/main.jsx`

- [ ] **Step 1: Detectar `/c/<slug>` antes de montar o App**

Substituir todo o `src/main.jsx` por:

```jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import CatalogoPublicoView from "./screens/CatalogoPublicoView.jsx";
import "./index.css";

// Rota pública do catálogo compartilhado: /c/<slug>. Renderiza SEM o gate de login.
const m = window.location.pathname.match(/^\/c\/([^/]+)/);
const raiz = ReactDOM.createRoot(document.getElementById("root"));

raiz.render(
  <React.StrictMode>
    {m ? <CatalogoPublicoView slug={decodeURIComponent(m[1])} /> : <App />}
  </React.StrictMode>
);
```

- [ ] **Step 2: Build + verificação manual**

Run: `npm run build`
Expected: passa. Acessar `/c/qualquercoisa` (dev/preview) mostra "Catálogo indisponível" (sem redirecionar pro login). Um slug válido (após Task 14) renderiza a galeria pública.

- [ ] **Step 3: Commit**

```bash
git add src/main.jsx
git commit -m "feat(catalogo): rota pública /c/<slug> no bootstrap"
```

---

### Task 14: PortfolioScreen — botão "Gerar link"

**Files:**
- Modify: `src/screens/PortfolioScreen.jsx`

- [ ] **Step 1: Importar publicarCatalogo e ícones**

Adicionar após o import de `prepararFotos`:

```jsx
import { publicarCatalogo } from "../lib/catalogoPublico";
```

E incluir `Link2` e `Check` na lista de ícones de `lucide-react`.

- [ ] **Step 2: Estado do link**

Após `const [progresso, setProgresso] = useState(null);` adicionar:

```jsx
  const [gerandoLink, setGerandoLink] = useState(false);
  const [linkPronto, setLinkPronto] = useState(null); // { url, expira_em }
```

- [ ] **Step 3: Função `gerarLink()`**

Adicionar após a função `gerar()`:

```jsx
  const gerarLink = async () => {
    if (!total) return;
    setGerandoLink(true);
    setLinkPronto(null);
    try {
      const cards = dedupCatalogo(itens);
      const secoes = agruparCatalogo(cards, agrupar);
      const cats = [...new Set(itens.map((i) => (i.grupo || "").trim()).filter(Boolean))];
      const res = await publicarCatalogo(secoes, {
        titulo: titulo.trim() || "Catálogo de Produtos",
        subtitulo: cats.join(" · "),
        edicao, comFoto, mostrarPreco,
      });
      try { await navigator.clipboard.writeText(res.url); } catch { /* clipboard pode falhar */ }
      setLinkPronto(res);
    } catch {
      alert("Falha ao gerar o link. Tente novamente.");
    } finally {
      setGerandoLink(false);
    }
  };
```

- [ ] **Step 4: Botões na barra de geração**

Substituir o bloco da "Barra de geração" (o `{total > 0 && (...)}` ~linhas 313-323) por:

```jsx
      {total > 0 && (
        <div className="fixed bottom-14 inset-x-0 z-30 px-3">
          <div className="max-w-lg mx-auto space-y-2">
            {linkPronto && (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-600 text-white px-3 py-2 text-xs font-semibold shadow-lg">
                <Check className="w-4 h-4 flex-shrink-0" />
                <span className="truncate flex-1">Link copiado · válido até {new Date(linkPronto.expira_em).toLocaleDateString("pt-BR")}</span>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={gerarLink} disabled={gerandoLink || gerando}
                className="flex-1 flex items-center justify-center gap-2 bg-orange-500 text-white rounded-2xl py-3.5 font-bold shadow-lg active:bg-orange-600 disabled:opacity-60">
                {gerandoLink ? <Loader2 className="w-5 h-5 animate-spin" /> : <Link2 className="w-5 h-5" />}
                Gerar link
              </button>
              <button onClick={gerar} disabled={gerando || gerandoLink}
                className="flex-1 flex items-center justify-center gap-2 bg-gray-900 text-white rounded-2xl py-3.5 font-bold shadow-lg active:bg-gray-800 disabled:opacity-60">
                {gerando ? <Loader2 className="w-5 h-5 animate-spin" /> : <Printer className="w-5 h-5" />}
                PDF ({total})
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Build + verificação manual (fim-a-fim)**

Run: `npm run build`
Expected: passa. Com produtos prontos: **Gerar link** cria o registro, copia a URL e mostra a faixa "Link copiado · válido até DD/MM"; abrir a URL em aba anônima renderiza o catálogo público (fotos, preços conforme o toggle). **PDF** continua funcionando com o overlay de progresso.

- [ ] **Step 6: Commit**

```bash
git add src/screens/PortfolioScreen.jsx
git commit -m "feat(catalogo): botão Gerar link (snapshot público 30 dias)"
```

---

## Verificação final

- [ ] **Rodar a suíte de testes**

Run: `npm test`
Expected: todos os testes passam (incluindo `test:catalogoimagens` e `test:catalogopublico`).

- [ ] **Lint + build**

Run: `npm run lint && npm run build`
Expected: sem erros.

- [ ] **Checklist manual (mobile + desktop)**
  - Foto: Câmera e Galeria funcionam em FotoQrScreen, ItemDetail e no atalho da lista.
  - Catálogo PDF: overlay de progresso aparece, Cancelar funciona, PDF sai mais leve.
  - Link: gera, copia, abre público em aba anônima, respeita ocultar preço, expira em 30 dias.
```
