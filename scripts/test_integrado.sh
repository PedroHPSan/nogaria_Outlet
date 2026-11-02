#!/usr/bin/env bash
# Teste INTEGRADO local do omnichannel: Postgres (imagem Supabase) + PostgREST + as Edge Functions rodando de verdade
# (Deno) + cenário ponta a ponta (WhatsApp, catálogo Meta, fila do Instagram, Mercado Livre).
# NÃO toca nenhum banco real nem a Meta/Instagram (tudo em dry-run). Faixa de porta 5568x. Uso: bash scripts/test_integrado.sh
set -uo pipefail
cd "$(dirname "$0")/.."
PG=nogaria_outlet_integ_pg; RT=nogaria_outlet_integ_rest
IMG=public.ecr.aws/supabase/postgres:17.6.1.104; IMG_RT=public.ecr.aws/supabase/postgrest:v14.5
PGP=55680; RTP=55681; PXP=55682; SYNC=55683; WA=55684; FEED=55685; ML=55686
SEGREDO="segredo-local-do-teste-integrado-0123456789"
PSQL="docker exec -i -e PGPASSWORD=postgres $PG psql -h localhost -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null; done; docker rm -f $PG $RT >/dev/null 2>&1; }
trap cleanup EXIT
cleanup
docker run -d --name $PG -e POSTGRES_PASSWORD=postgres -p $PGP:5432 $IMG >/dev/null || exit 1
echo "aguardando o Postgres…"
for i in $(seq 1 60); do docker exec -e PGPASSWORD=postgres $PG pg_isready -h localhost -U supabase_admin >/dev/null 2>&1 && break; sleep 2; done
sleep 3
$PSQL < scripts/sql/base_minima.sql || exit 1
$PSQL -c "create schema if not exists storage; create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]); create table if not exists storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text); alter table storage.objects enable row level security;" || exit 1
$PSQL -c "alter table itens add column if not exists taxa_venda numeric, add column if not exists frete_pago numeric; create table if not exists public.interesses (id uuid primary key default gen_random_uuid(), codigo text not null unique, status text not null default 'ABERTO', sku text, valido_ate timestamptz not null default now() + interval '1 day', eur numeric(12,2) not null default 0, criado_em timestamptz not null default now());" || exit 1
$PSQL -c "create table if not exists public.publicacoes (id bigint primary key, sku text references itens(sku) on update cascade, canal text, listing_id text, url text, status text default 'exportado', erro text, exportado_em timestamptz default now(), publicado_em timestamptz, updated_at timestamptz default now(), created_at timestamptz default now()); alter table public.publicacoes enable row level security;" || exit 1
for M in 20260801130000_orcamentos 20261028120000_sacolas_whatsapp 20260625143345_publicar_amazon \
         20261102120000_omnichannel_base 20261102130000_omnichannel_rpcs 20261102140000_omnichannel_worker \
         20261102150000_whatsapp_base 20261102160000_whatsapp_envio 20261102170000_catalogo_meta 20261102180000_fila_publicacao; do
  $PSQL < supabase/migrations/$M.sql >/dev/null 2>&1 || { echo "FALHA ao aplicar $M"; $PSQL < supabase/migrations/$M.sql 2>&1 | tail -3; exit 1; }
done
# equivalente aos privilégios padrão do Supabase para as tabelas (funções seguem os grants das migrations)
$PSQL -c "grant all on all tables in schema public to anon, authenticated, service_role; grant all on all sequences in schema public to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;" || exit 1

$PSQL -c "alter role authenticator with password 'postgres' login;" || exit 1
docker run -d --name $RT -p $RTP:3000 \
  -e PGRST_DB_URI="postgres://authenticator:postgres@host.docker.internal:$PGP/postgres" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SEGREDO" $IMG_RT >/dev/null || exit 1
for i in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$RTP/" && break; sleep 1; done

SERVICE=$(deno run -A scripts/integrado/jwt.ts "$SEGREDO" service_role)
export POSTGREST_URL="http://127.0.0.1:$RTP"
DENO_SERVE_ADDRESS="tcp:127.0.0.1:$PXP" deno run -A scripts/integrado/proxy.ts >/tmp/integ_proxy.log 2>&1 & PIDS+=($!)
ENVF="SUPABASE_URL=http://127.0.0.1:$PXP SUPABASE_SERVICE_ROLE_KEY=$SERVICE"
sub() { # porta, arquivo, env extra...
  local porta=$1 arq=$2; shift 2
  env $ENVF DENO_SERVE_ADDRESS="tcp:127.0.0.1:$porta" "$@" deno run -A --no-lock "$arq" >/tmp/integ_$porta.log 2>&1 & PIDS+=($!)
}
sub $SYNC supabase/functions/sync-canais/index.ts CRON_SECRET=local SYNC_DRY_RUN=1 IG_DRY_RUN=1
sub $WA supabase/functions/whatsapp-webhook/index.ts WHATSAPP_APP_SECRET=appsecret WHATSAPP_VERIFY_TOKEN=verif
sub $FEED supabase/functions/catalogo-meta-feed/index.ts CATALOGO_FEED_TOKEN=tokfeed PUBLIC_SITE_URL=https://outlet.exemplo
sub $ML supabase/functions/ml-notifications/index.ts ML_APP_ID=99 ML_USER_ID=77
for porta in $SYNC $WA $FEED $ML; do
  for i in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$porta/" && break; sleep 0.5; done
done

REST="http://127.0.0.1:$PXP" SEGREDO="$SEGREDO" SERVICE_JWT="$SERVICE" \
USER_JWT="$(deno run -A scripts/integrado/jwt.ts "$SEGREDO" authenticated pedro@exemplo.com)" \
SYNC_URL="http://127.0.0.1:$SYNC" WA_URL="http://127.0.0.1:$WA" FEED_URL="http://127.0.0.1:$FEED" ML_URL="http://127.0.0.1:$ML" \
  deno run -A --no-lock scripts/integrado/cenario.ts
RC=$?
[ $RC -ne 0 ] && { echo "--- logs ---"; docker logs --tail 15 $RT 2>&1; tail -n 8 /tmp/integ_$SYNC.log /tmp/integ_$WA.log /tmp/integ_proxy.log 2>/dev/null | grep -v Download; }
exit $RC
