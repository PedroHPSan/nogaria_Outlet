# publicar-amazon (Edge) — guia de dev

Publica um item na Amazon via **SP-API Listings Items** (modo **oferta**), após
revisão humana no cliente (`PublishPanel`). O **servidor é a autoridade**: re-valida o
pre-flight (preço / banda / GTIN) antes de chamar a Amazon. Idempotência via
`listing_state (sku, canal)`.

## Estado desta entrega (v1)
- **Dry-run apenas.** Com `AMZ_DRY_RUN=1`, a função devolve o payload **sem** chamar a Amazon.
- Migration `supabase/migrations/20260625b_publicar_amazon.sql` (`listing_state` + `amazon_oauth`)
  está **criada e NÃO aplicada** (pendente de OK de Pedro/Bárbara).
- Nada deployado; nenhum secret de produção setado; `amazon_oauth` vazio.

## Validação da lógica (sem rede)
A montagem do payload e o gate são puros e testados:
```
npm run test:preflight   # 32 asserções: preco_ideal no payload, condição, EAN/ASIN, gate
```
`supabase/functions/publicar-amazon/index.ts` espelha `src/lib/marketplace/preflight.js`
e `src/lib/marketplace/amazonPayload.js` (estes são a fonte testada).

## Dry-run ao vivo (opcional, precisa Docker)
```
printf "AMZ_DRY_RUN=1\n" > supabase/.env.local
supabase start
supabase functions serve publicar-amazon --no-verify-jwt --env-file supabase/.env.local
# seed no banco LOCAL: um item com preco_ideal + GTIN(13) e um usuário (auth);
# pegue um JWT de usuário local e:
node scripts/publicar_amazon_local.mjs <SKU> <JWT>
```
Esperado: `{ ok:true, dry_run:true, estado:"publicando", payload }` com
`purchasable_offer ... value_with_tax = preco_ideal`. SKU sem `preco_ideal` ⇒
`{ ok:false, estado:"erro", erros:[{ bucket:"PREFLIGHT", ... }] }`.

## Pendências para produção (NÃO nesta tarefa)
1. Aplicar a migration (OK Pedro/Bárbara).
2. Cadastrar o app na SP-API + LWA; setar secrets `LWA_CLIENT_ID`, `LWA_CLIENT_SECRET`,
   `AMZ_SELLER_ID` (e remover `AMZ_DRY_RUN`).
3. Popular `amazon_oauth` (id=1) com o `refresh_token`.
4. `supabase functions deploy publicar-amazon` (`verify_jwt` off — auth na função).

## Constantes
`MARKETPLACE_ID=A2Q3Y263D00KWC` (BR) · `SPAPI_BASE=https://sellingpartnerapi-na.amazon.com`
(região NA) · LWA `https://api.amazon.com/auth/o2/token`.
