# Catálogo leve + link compartilhável + foto da galeria no mobile

**Data:** 2026-07-10
**Status:** aprovado (brainstorming) → aguardando plano de implementação

## Problema

Três dores no fluxo atual:

1. **Mobile não adiciona foto da galeria.** Os inputs de foto usam `capture="environment"`,
   que força a câmera e esconde a opção "escolher da galeria" no celular.
2. **Portfólio pesado de enviar.** O catálogo é sempre um PDF, e as fotos vão embutidas
   em base64 na resolução original — arquivo grande demais para mandar no WhatsApp/email.
3. **Sensação de crash ao gerar o catálogo.** `PortfolioScreen.gerar()` busca cada foto,
   converte para base64 e injeta num HTML gigante na thread principal, sem feedback de
   progresso. Com muitos itens a tela congela; se a impressão engasga, parece que o
   sistema morreu (crash silencioso).

## Decisões (do brainstorming)

- **Entrega do catálogo:** os dois — **link web compartilhável** (padrão para mandar) **e
  PDF leve** (offline/imprimível).
- **Processamento:** **Web Worker** (thread separada) com **barra de progresso + botão
  cancelar**. A tela nunca trava nem parece crashada.
- **Foto no mobile:** **dois botões** — "Câmera" (atalho direto) e "Escolher da galeria".
- **Link público:** **snapshot congelado** (o que foi enviado não muda sozinho), com
  **validade de 30 dias** (produtos giram mais rápido que isso; link velho expira).

## Arquitetura

O app é SPA React + Vite + Supabase, deployado no Vercel. Hoje **todo** o app fica atrás
do login (`App.jsx` mostra `<Login>` sem sessão) e **não há router** — navegação por abas
em estado. O Vercel reescreve tudo para `/` (SPA). O cliente usa a **anon key**; acesso é
governado por RLS. O bucket `fotos-produtos` é privado (signed URLs).

Isso define duas restrições:
- A rota pública do link precisa renderizar **antes** do gate de login.
- O visitante anônimo não pode depender de RLS em `itens`/storage → o snapshot embute
  signed URLs de longa validade, e a página pública lê **um único registro**.

### Abordagem escolhida para o link: snapshot congelado

Ao gerar, o app monta o catálogo (itens, preços, títulos) + gera signed URLs de longa
validade das fotos representativas e salva tudo num registro `catalogos_publicos` com slug
aleatório. O link `/c/<slug>` lê só esse registro — o anônimo nunca toca em `itens` nem no
storage. Mais leve, mais seguro, e com a semântica certa de "portfólio enviado".

Alternativa rejeitada (página ao vivo): consultar `itens`/`fotos` em tempo real via anon +
RLS expõe a tabela inteira ao anônimo e exige RLS no storage — mais arriscado e pesado.

## Módulos

### Módulo 1 — Foto da galeria no mobile *(pequeno, independente, sem banco)*

Os 3 pontos de upload usam `capture="environment"`:
- `src/screens/FotoQrScreen.jsx:88`
- `src/screens/ItemDetail.jsx:728`
- `src/screens/ItemsScreen.jsx:352`

**Mudança:** manter o botão **Câmera** (input com `capture="environment"`) e adicionar um
segundo input **Escolher da galeria** (`accept="image/*"` **sem** `capture`, `multiple`).
Ambos disparam o mesmo handler de upload já existente (`subirFotos`/`enviarFoto`) — nenhuma
mudança no fluxo de storage ou banco.

Para não repetir markup, extrair um pequeno componente `FotoInputs` (ou par de botões +
refs) reutilizado nas 3 telas. Cada tela já tem seu `fileRef` e handler; o componente
recebe `onFiles` e renderiza os dois botões + os dois inputs ocultos.

**Interface:** `<FotoInputs onFiles={(fileList) => …} disabled={uploading} />`
**Depende de:** nada novo.

### Módulo 2 — Motor do catálogo em Web Worker *(leve + progresso + cancelar)*

**`src/lib/catalogoWorker.js`** (roda na thread separada, `type: "module"`):
recebe `{ urls: string[], maxLado, quality }`. Para cada URL: `fetch` → `createImageBitmap`
→ desenha em `OffscreenCanvas` redimensionado (lado maior ~1000px) → `convertToBlob`
(JPEG, quality ~0.72) → base64. Emite `postMessage({ tipo: "progresso", feitas, total })`
a cada foto e `{ tipo: "fim", fotos: { [sku]: dataURI } }` no final. Foto que falhar é
omitida (best-effort, igual ao `fotosComoDataURI` atual).

**`src/lib/catalogoImagens.js`** (main-thread, wrapper):
`prepararFotos(urlPorSku, { onProgress, signal })` → sobe o worker
(`new Worker(new URL("./catalogoWorker.js", import.meta.url), { type: "module" })`),
repassa progresso via `onProgress({ feitas, total })`, resolve com o mapa de dataURIs.
`cancelar()` = `worker.terminate()` + rejeita a promise. Os parâmetros de redimensionamento
(`maxLado`, `quality`) ficam em constantes exportadas para teste.

**`src/screens/PortfolioScreen.jsx`** — `gerar()` reescrito:
1. monta seções (puro, já existe: `dedupCatalogo` + `agruparCatalogo`);
2. se `comFoto`, roda `prepararFotos` com um **overlay de progresso** (modal: "preparando
   12/80 fotos…" + barra + botão **Cancelar**);
3. embute o base64 leve no HTML (`gerarCatalogoHTML`) e chama `imprimirPortfolio`.

Substitui o `fotosComoDataURI` (resolução cheia, main-thread) atual. `imprimirPortfolio`
ganha um guard de timeout que fecha o overlay e avisa se a impressão não retornar, em vez
de deixar a tela pendurada.

**Fallback:** se `OffscreenCanvas`/worker não existir no ambiente, cair no caminho antigo
(downscale no main-thread em canvas comum, processando em lotes com `await` para não travar).

**Depende de:** `catalogoCore` (seções), `catalogoTemplate` (HTML), `portfolio.imprimirPortfolio`.

### Módulo 3 — Link web compartilhável (snapshot)

**Migration** (requer aprovação de schema — Pedro/Bárbara):
tabela `catalogos_publicos`:
- `id uuid pk default gen_random_uuid()`
- `slug text unique not null` (aleatório, ~10 chars url-safe)
- `titulo text`, `edicao text`
- `payload jsonb not null` (seções + itens + signed URLs embutidas + opções de exibição)
- `criado_por uuid` (auth.uid()), `created_at timestamptz default now()`
- `expira_em timestamptz not null` (created_at + 30 dias)

RLS:
- `SELECT` anônimo permitido **apenas** quando `expira_em > now()`.
- `INSERT` apenas autenticado (`auth.role() = 'authenticated'`), com `criado_por = auth.uid()`.
- Sem `UPDATE`/`DELETE` público (regenerar cria registro novo).

**`src/lib/catalogoPublico.js`**:
- `publicarCatalogo(secoes, opcoes)`: gera signed URLs de longa validade (`createSignedUrl`,
  `expiresIn` = 30 dias em segundos) das fotos representativas, monta o `payload` (função
  **pura** `montarPayload(secoes, opcoes, fotosUrl)` — testável), gera slug, insere,
  retorna `{ url, expira_em }`. `url = ${location.origin}/c/${slug}`.
- `buscarCatalogoPublico(slug)`: `select` do registro (anon), retorna `payload` ou `null`
  (expirado/inexistente).

**Rota pública** — `src/App.jsx` bootstrap: se `location.pathname` começa com `/c/`,
renderizar `<CatalogoPublicoView slug>` **antes** de qualquer checagem de sessão. Componente
autônomo que busca o snapshot e renderiza a galeria (reaproveita o visual dos cards já
existente; sem preço se o snapshot mandou ocultar). Estados: carregando / expirado ou não
encontrado / conteúdo.

**`src/screens/PortfolioScreen.jsx`**: botão **Gerar link** ao lado do **Gerar PDF**.
Ao concluir: copia a URL para o clipboard e mostra numa faixa ("Link copiado — válido até
DD/MM"). Reaproveita a mesma montagem de seções do `gerar()`.

**Depende de:** migration aplicada; `catalogoCore` (seções); `supabase`.

## Fluxo de dados

```
PortfolioScreen (filtros) ──> listarItensCatalogo ──> itens
                                     │
                    dedupCatalogo + agruparCatalogo ──> seções (puro)
                                     │
        ┌────────────────────────────┴────────────────────────────┐
   [Gerar PDF]                                               [Gerar link]
        │                                                          │
 catalogoImagens.prepararFotos (Web Worker)              catalogoPublico.publicarCatalogo
   → base64 leve + progresso/cancelar                      → signed URLs 30d + payload
        │                                                          │
 gerarCatalogoHTML → imprimirPortfolio (iframe)          insert catalogos_publicos → /c/<slug>
                                                                   │
                                                     (visitante) App bootstrap detecta /c/
                                                                   │
                                                        buscarCatalogoPublico(slug)
                                                                   │
                                                          <CatalogoPublicoView>
```

## Tratamento de erros

- **Foto (M1):** upload já é try/catch com mensagem ("Falha ao enviar a foto"). Sem mudança.
- **Worker (M2):** foto que falha é omitida (best-effort). Erro fatal do worker → fecha
  overlay, mensagem "Falha ao preparar as fotos". Cancelar → aborta limpo. Timeout de
  impressão → avisa em vez de pendurar.
- **Link (M3):** falha ao gerar signed URL de uma foto → item entra sem foto (não aborta).
  Falha no insert → mensagem de erro, nada é publicado. Slug expirado/inexistente na
  página pública → tela "Catálogo indisponível ou expirado".

## Testes (padrão `scripts/test_*.mjs`, puros em Node)

- `montarPayload(secoes, opcoes, fotosUrl)` — estrutura correta, respeita ocultar preço,
  omite foto ausente.
- Constantes de redimensionamento (`maxLado`, `quality`) expostas e validadas.
- Montagem de seções já coberta por `test_catalogo.mjs` (reuso).
- Cálculo de `expira_em` (created_at + 30 dias).

*(A lógica de canvas/worker e o clipboard são de browser — cobertos por verificação manual,
não por teste Node.)*

## Fora de escopo (v1)

- Gerenciar/revogar/listar links antigos (expiram sozinhos em 30 dias).
- Derivadas de imagem comprimidas servidas no link (o link usa signed URLs das originais,
  carregadas sob demanda pelo navegador — a leveza do link vem de ser URL, não arquivo).
- Analytics de quem abriu o link.

## Ordem de implementação sugerida

1. **Módulo 1** (isolado, entrega valor imediato, sem banco).
2. **Módulo 2** (resolve o crash — maior dor operacional).
3. **Módulo 3** (depende de aprovação da migration).
