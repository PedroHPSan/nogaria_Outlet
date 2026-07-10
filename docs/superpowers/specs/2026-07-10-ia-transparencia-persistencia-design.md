# Transparência e persistência do preenchimento por IA

**Data:** 2026-07-10
**Contexto:** No "Completar com IA" (ficha do item), a IA hoje **sobrescreve** todos os
campos que retorna e o painel de sugestões vive **só em memória** — ao recarregar/reabrir
o item, some (perdem-se as dicas/diagnóstico, a lista do que foi preenchido e o rastro de
que veio da IA). Além disso, os campos que a IA não conseguiu inferir (`campos_faltantes`,
já retornados pela edge function) **não são exibidos**, dando a impressão de que "alguns
campos não são preenchidos" sem explicação.

## Objetivos

1. **Preenchimento não-destrutivo:** a IA preenche automaticamente **só os campos vazios**;
   onde já há valor humano, o dado vira **sugestão** (aplicação manual), nunca sobrescreve
   sem o usuário ver.
2. **Certeza do que mudou:** sinalização clara — card com o resumo do que a IA preencheu +
   marca "IA" ao lado de cada campo preenchido pela IA.
3. **Quadro durável (posterioridade):** persistir a última análise da IA por item, incluindo
   os valores sugeridos, o diagnóstico/dicas e o que a IA **não** conseguiu — reaparece ao
   reabrir o item, mesmo após recarregar.

Fora de escopo: histórico de múltiplas execuções (guardamos só a última); mudar a edge
function `enriquecer-produto` (o retorno já basta).

## Estado atual (relevante)

- `ItemDetail.jsx`:
  - `construirSugestoes(iaData, item)` (pura) monta `[{k, label, val, patch}]` a partir do
    retorno da IA.
  - `enriquecer(comFoto)` chama a edge function, `setIa(data)` (memória) e, ao retornar,
    aplica **tudo** via `patchTodasIA` → `set(patch)` (estado local `it`, dirty; persiste só
    no Salvar). Também deriva `preco_ideal` das novas referências.
  - `set = (patch) => { dirty.current = true; setIt(p => ({...p, ...patch})); }`.
  - `fechar()` salva automaticamente se `dirty`.
  - Card da IA renderiza `sugestoesIA` (de `ia`, memória) + `ia.observacoes` (Diagnóstico);
    `campos_faltantes` **não** é exibido.
  - Marcador durável já existente: `it.preco_ref_fonte === "IA:claude"` (selo/filtro).
- Edge function retorna: `titulo_anuncio, descricao_anuncio, marca, modelo, grupo, ncm,
  voltagem, cor, dimensoes_estimadas, preco_ref_novo/usado/confianca, pontos, palavras_chave,
  ficha_tecnica, campos_faltantes[], observacoes, usou_foto`.
- Padrão de testes: só módulos **puros** (sem importar `supabase.js`).

## 1. Schema (migration — aprovação Pedro/Bárbara)

Adicionar em `itens` (nullable, sem backfill):

| coluna | tipo | uso |
|---|---|---|
| `ia_analise` | `jsonb` | snapshot da última análise da IA |

Formato do `ia_analise`:
```json
{
  "em": "2026-07-10T12:00:00.000Z",
  "por": "email@dominio",
  "usou_foto": false,
  "confianca": "MEDIA",
  "observacoes": "texto do diagnóstico",
  "campos_faltantes": ["ncm", "num_serie"],
  "sugestoes": [{ "k": "titulo_anuncio", "label": "Título", "val": "…" }],
  "aplicados": ["titulo_anuncio", "descricao_anuncio", "preco"]
}
```
Arquivo: `supabase/migrations/<timestamp>_itens_ia_analise.sql`.

## 2. Lógica pura (`src/lib/iaAnalise.js`)

Move a lógica de sugestões do `ItemDetail` para um módulo puro (testável) e adiciona a
regra de "só vazios":

- `campoVazio(v)` — `null/undefined/""`/array vazio ⇒ vazio.
- `construirSugestoes(iaData, item)` — igual à atual (retorna `[{k, label, val, patch}]`).
- `ALVO` — mapa `k → [colunas do item que representam o campo]` (ex.: `dimensoes →
  [comprimento_cm, largura_cm, altura_cm, peso_real_kg]`, `preco → [preco_ref_novo,
  preco_ref_usado]`, `preco_ideal → [preco_ideal]`, demais `k → [k]`).
- `sugestaoVazia(sug, item)` — verdadeiro se **todas** as colunas de `ALVO[sug.k]` estão
  vazias no item.
- `separarSugestoes(sugestoes, item)` → `{ vazias, preenchidas }` (vazias = auto-aplicáveis;
  preenchidas = já têm valor humano ⇒ viram sugestão manual).
- `patchVazios(vazias)` — mescla os `patch` das sugestões vazias num único patch.
- `montarAnalise(iaData, sugestoes, aplicados, { em, por })` — monta o objeto `ia_analise`
  (usa `iaData.observacoes`, `iaData.campos_faltantes`, `iaData.preco_ref_confianca`,
  `iaData.usou_foto`; `sugestoes` reduzidas a `{k,label,val}`).

`preco_ideal` entra como uma sugestão sintética (k=`preco_ideal`) somente quando derivável
(`recomendado > 0`); segue a regra de "só vazio".

## 3. Persistência (`src/lib/ia.js`)

- `salvarAnaliseIA(sku, patch, iaAnalise, user)` — uma única escrita:
  `update itens set { ...patch, ia_analise: iaAnalise, upd_by } where sku`; retorna a linha.
  Registra evento `ia:enriquecido` (best-effort) com detalhe = resumo (`nº aplicados` +
  confiança).

## 4. `ItemDetail.jsx`

- Importar de `iaAnalise.js`/`ia.js`; remover `construirSugestoes`/`patchTodasIA` locais.
- **`enriquecer(comFoto)`** ao retornar:
  1. `sugestoes = construirSugestoes(data, it)` (+ sugestão sintética de `preco_ideal`
     derivada com `derivarPreco`, quando `recomendado > 0`).
  2. `{ vazias, preenchidas } = separarSugestoes(sugestoes, it)`.
  3. `patch = patchVazios(vazias)` (inclui `preco_ideal` se estava vazio).
  4. `aplicados = vazias.map(s => s.k)`.
  5. `iaAnalise = montarAnalise(data, sugestoes, aplicados, { em: agora, por: user.email })`.
  6. `linha = await salvarAnaliseIA(it.sku, patch, iaAnalise, user)` — **persiste na hora**
     (backfill dos vazios + o quadro durável). `setIt(linha)`, `dirty=false`, `onSaved(linha)`.
  - Não-destrutivo: campos já preenchidos não entram no `patch`; ficam como sugestões.
- **Card "Análise da IA"** (durável) — renderiza de `it.ia_analise` (sobrevive a reload):
  - Cabeçalho: "Análise da IA · <data> · <por>" + confiança + "(com foto)".
  - **Preenchidos pela IA**: `sugestoes` com `k ∈ aplicados` (label + valor).
  - **Sugestões (revisar)**: `sugestoes` com `k ∉ aplicados` cujo campo do item ainda está
    preenchido por valor humano — cada uma com botão **Aplicar** (`set(patch)`; ao aplicar,
    adiciona `k` a `aplicados` localmente para persistir no próximo Salvar).
  - **A IA não conseguiu**: `campos_faltantes` (rotulados).
  - **Diagnóstico/dica**: `observacoes`.
  - Botão **Refazer com IA** (mantém o comportamento atual de reexecutar).
- **Marca "IA" por campo**: helper `iaFez(it, k)` = `it.ia_analise?.aplicados?.includes(k)`;
  componente `IaTag` (chip violeta "IA" + `title` com a data) ao lado dos rótulos dos campos
  cobertos: Título, Descrição, Marca, Modelo, Categoria, NCM, Voltagem, Cor, Dimensões,
  Preço ref., Preço ideal.
- `salvar()` inclui `ia_analise: it.ia_analise` no patch (persiste `aplicados` atualizado por
  aplicações manuais).

## 5. Testes (`scripts/test_iaanalise.mjs`)

Cobre `iaAnalise.js` (puro):
- `construirSugestoes` filtra nulos/vazios.
- `separarSugestoes`: campo vazio → `vazias`; campo com valor humano → `preenchidas`
  (não-destrutivo). Inclui caso de `dimensoes` (todas vazias vs alguma preenchida).
- `patchVazios` mescla só os patches das vazias.
- `montarAnalise` produz `{ em, por, confianca, observacoes, campos_faltantes, sugestoes,
  aplicados }` com `sugestoes` reduzidas a `{k,label,val}`.

Registrado em `package.json` (`test:iaanalise`) e no `test`.

## Arquivos

- Create: `supabase/migrations/<timestamp>_itens_ia_analise.sql`
- Create: `src/lib/iaAnalise.js` (puro)
- Create: `src/lib/ia.js` (persistência)
- Modify: `src/screens/ItemDetail.jsx`
- Create: `scripts/test_iaanalise.mjs`
- Modify: `package.json`

## Fluxo de uso

1. Abrir a ficha → **Completar com IA**.
2. Campos **vazios** são preenchidos e **salvos na hora**; um card "Análise da IA" aparece
   com o que foi preenchido, o que a IA não conseguiu e a dica.
3. Onde você já tinha dados, a sugestão da IA fica no card com **Aplicar** (você decide).
4. Reabrindo o item depois, o card e as marcas "IA" continuam lá (persistidos).

## Riscos / decisões

- Persistência imediata dos vazios é segura (não sobrescreve dado humano) e garante que as
  dicas não se percam mesmo sem "Salvar".
- `ia_analise.aplicados` reflete o que a IA preencheu; edições humanas posteriores podem
  tornar a marca "IA" desatualizada num campo — aceitável (marca "preenchido pela IA nesta
  análise", com data).
- Uma migration (coluna nullable) — nenhuma função existente muda de assinatura; o resto é
  adição/refactor interno do `ItemDetail`.
