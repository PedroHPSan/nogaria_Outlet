#!/usr/bin/env bash
# Teste em Docker da RPC renovar_sacola (Postgres descartável). NÃO toca banco real. Porta 55698.
set -uo pipefail
cd "$(dirname "$0")/.."
NAME=nogaria_outlet_renovar_pg; PORT=55698; IMG=public.ecr.aws/supabase/postgres:17.6.1.104
PSQL="docker exec -i -e PGPASSWORD=postgres $NAME psql -h localhost -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q"
cleanup() { docker rm -f $NAME >/dev/null 2>&1; }
trap cleanup EXIT; cleanup
docker run -d --name $NAME -e POSTGRES_PASSWORD=postgres -p $PORT:5432 $IMG >/dev/null || exit 1
for i in $(seq 1 60); do docker exec -e PGPASSWORD=postgres $NAME pg_isready -h localhost -U supabase_admin >/dev/null 2>&1 && break; sleep 2; done
sleep 3
$PSQL < scripts/sql/base_minima.sql || exit 1
for M in 20260801130000_orcamentos 20261028120000_sacolas_whatsapp 20260625143345_publicar_amazon; do
  $PSQL < supabase/migrations/$M.sql || { echo "FALHA: pré-requisito $M"; exit 1; }
done
$PSQL -c "create table if not exists public.interesses (id uuid primary key default gen_random_uuid(), codigo text not null unique, status text not null default 'ABERTO', sku text, valido_ate timestamptz not null default now() + interval '1 day', eur numeric(12,2) not null default 0, criado_em timestamptz not null default now()); alter table itens add column if not exists taxa_venda numeric, add column if not exists frete_pago numeric;" || exit 1
for M in 20261102120000_omnichannel_base 20261102130000_omnichannel_rpcs STUB 20261103110000_renovar_sacola; do
  [ "$M" = STUB ] && { $PSQL -c "create or replace function public.canal_ativo(c text) returns boolean language sql as 'select true'" || exit 1; sed -n 16,51p supabase/migrations/20261102320000_n8_referral_hold_bot.sql | $PSQL || exit 1; continue; }
  $PSQL < supabase/migrations/$M.sql || { echo "FALHA: $M"; exit 1; }
done
OUT=$($PSQL -A -t -F' | ' < scripts/sql/test_renovar_sacola.sql 2>&1)
echo "$OUT"
echo "$OUT" | grep -q "^FAIL" && { echo "HÁ FALHAS"; exit 1; }
echo "$OUT" | grep -q "^PASS" || { echo "nenhum PASS"; exit 1; }
