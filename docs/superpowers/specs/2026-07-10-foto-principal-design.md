# Escolher a foto principal do item

Data: 2026-07-10
Status: aprovado

## Problema

No cadastro/detalhe do item o usuário precisa poder escolher qual foto é a
"principal" — a melhor imagem do produto, usada principalmente como capa no
catálogo (e também na miniatura das listas e como 1ª foto do anúncio).

## Contexto

Hoje "foto principal" **não** é um conceito explícito: em todo o código a capa é
sempre a foto de **menor `ordem`**. Consumidores que já dependem disso:
- `src/lib/fotos.js` `primeirasFotos()` → miniatura em Itens, Conferência, Portfólio.
- `src/lib/anuncio.js` `fotosDoItem()` → `principal = ordenadas[0]`.
- Portfólio/catálogo (PDF) usam `primeirasFotos()`.

A tabela `fotos` tem `id, sku, storage_path, ordem`. Não há coluna `principal`.
Ao apagar não há reindexação (podem existir buracos/valores não contíguos em
`ordem`) — o que é irrelevante para esta feature, pois só importa o mínimo.

## Decisão

Reusar `ordem` (nada de coluna/migração). "Marcar como principal" dá à foto
escolhida a menor `ordem` do SKU, então ela passa a ser a capa em **todos** os
consumidores automaticamente, sem alterá-los. Evita migração (que exigiria
aprovação de schema) e mantém a convenção existente.

Escopo: apenas escolher a principal (sem reordenação completa da galeria).
Somente na tela de detalhe do item — não em `FotoQrScreen`.

## Mudanças

### 1. Lib — `src/lib/fotos.js`
- `novaOrdemPrincipal(fotos)` (núcleo puro, testável): recebe a lista de fotos
  do SKU e retorna `min(ordem) - 1`. Se a lista for vazia, retorna `0`.
- `definirFotoPrincipal(sku, fotoId)`: lê a menor `ordem` do SKU
  (`select ordem ... order(ordem) limit 1`), calcula a nova ordem e faz
  `update fotos set ordem = <nova> where id = fotoId`. Idempotente: marcar uma
  foto já principal apenas a empurra mais para baixo (segue sendo o mínimo).

### 2. UI — `src/screens/ItemDetail.jsx` (galeria ~702–740)
- Cada miniatura ganha, além do "X" de apagar, um botão **estrela** "Definir
  como principal".
- A foto principal (`fotos[0]`, já exibida em destaque no topo) mostra uma
  estrela preenchida / selo "Principal".
- Handler `tornarPrincipal(foto)`: chama `definirFotoPrincipal(it.sku, foto.id)`,
  depois `carregarFotos()` (que ordena por `ordem`) — a escolhida sobe para o
  topo. Sucesso sem alerta; erro usa `alert(...)` no padrão da tela.

### 3. Sem mudanças em consumidores
Catálogo, portfólio, anúncio e miniaturas continuam pegando a menor `ordem`.

## Testes

`scripts/test_fotoprincipal.mjs` (ligado ao `npm test`) valida `novaOrdemPrincipal`:
- `[{ordem:0},{ordem:1},{ordem:2}]` → `-1`.
- Foto única `[{ordem:0}]` → `-1`.
- Ordens com buracos/negativas `[{ordem:-2},{ordem:3}]` → `-3`.
- Lista vazia `[]` → `0`.

## Fora de escopo

- Reordenação completa da galeria (drag-and-drop).
- Coluna `principal`/`foto_principal_id` e qualquer migração.
- Reindexação global de `ordem`.
- Estrela na tela `FotoQrScreen`.
