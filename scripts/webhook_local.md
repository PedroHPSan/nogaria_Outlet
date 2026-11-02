# Testar webhooks localmente (curl)

Pré-requisito: stack local (`supabase start`) e `npm run dev:functions` com `supabase/.env.local`:

```
ML_APP_ID=99
ML_USER_ID=77
CRON_SECRET=local
SYNC_DRY_RUN=1
```

Testes unitários (sem banco): `npm run test:webhook`.

## Mercado Livre (`ml-notifications`)

```bash
URL=http://127.0.0.1:55621/functions/v1/ml-notifications
EVT='{"topic":"orders_v2","resource":"/orders/1","user_id":77,"application_id":99,"sent":"2026-11-02T10:00:00Z"}'
curl -s -X POST $URL -d "$EVT"                       # {"received":true,"duplicado":false}
curl -s -X POST $URL -d "$EVT"                       # {"received":true,"duplicado":true}  (sem 2º job)
curl -s -X POST $URL -d "${EVT/77/1}" -w ' %{http_code}\n'   # 403, nada gravado
```

Conferir: `select canal, external_id, processado_em from webhook_eventos;` e `select tipo, status from integracao_jobs;`
(o worker marca `processado_em` no próximo ciclo; para forçar: `curl -X POST .../functions/v1/sync-canais -H "x-cron-secret: local"`).

## Meta (assinatura `X-Hub-Signature-256`)

```bash
BODY='{"entry":[]}'; SECRET=meu_app_secret
SIG="sha256=$(printf %s "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')"
curl -s -X POST $URL_DO_WEBHOOK_META -H "x-hub-signature-256: $SIG" -d "$BODY"   # 200
curl -s -X POST $URL_DO_WEBHOOK_META -H "x-hub-signature-256: sha256=00" -d "$BODY" -w ' %{http_code}\n'  # 403
```

As funções Meta (`whatsapp-webhook`, `instagram-webhook`) usam `verificarAssinaturaMeta`/`desafioMeta` de `_shared/webhook.ts` (issues E1-2, E2-2).
