#!/usr/bin/env bash
# Teste em Docker da migration de pagamentos da sacola (Postgres descartável). NÃO toca banco real. Porta 55699.
set -uo pipefail
cd "$(dirname "$0")/.."
NAME=nogaria_outlet_pagamentos_pg; PORT=55699; IMG=public.ecr.aws/supabase/postgres:17.6.1.104
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
for M in 20261102120000_omnichannel_base 20261102130000_omnichannel_rpcs 20261116100000_gestores_venda 20261116110000_gestores_venda_reforco 20261116120000_gestores_venda_reforco2 20261116130000_gestores_venda_null_safe; do
  $PSQL < supabase/migrations/$M.sql || { echo "FALHA: pré-requisito $M"; exit 1; }
done
$PSQL -c "create table if not exists public.campanhas (id uuid primary key default gen_random_uuid(), status text, inicio_em timestamptz, fim_em timestamptz); create table if not exists public.campanha_itens (campanha_id uuid, sku text, canal text, preco_cheio numeric, desconto_pct numeric, regra_tipo text); create table if not exists public.campanha_regras (id uuid primary key default gen_random_uuid(), campanha_id uuid, desconto_pct numeric); grant select, insert, update, delete on public.campanhas, public.campanha_itens, public.campanha_regras to authenticated;" || exit 1
MIG=supabase/migrations/20261124120000_pagamentos_sacola.sql
docker cp $MIG $NAME:/tmp/pagamentos_sacola.sql
$PSQL < $MIG || { echo "FALHA ao aplicar a migration"; exit 1; }
MIG2=supabase/migrations/20261124130000_pagamentos_endurecimento.sql
$PSQL < $MIG2 || { echo "FALHA ao aplicar o reforço"; exit 1; }
$PSQL < $MIG2 || { echo "FALHA: reforço não é idempotente"; exit 1; }
MIG3=supabase/migrations/20261124150000_acesso_operador.sql
$PSQL < $MIG3 || { echo "FALHA ao aplicar o acesso de operador"; exit 1; }
$PSQL < $MIG3 || { echo "FALHA: acesso de operador não é idempotente"; exit 1; }
OUT=$($PSQL -A -t -F' | ' < scripts/sql/test_pagamentos_sacola.sql 2>&1)
$PSQL < $MIG2 || { echo "FALHA ao reaplicar o reforço"; exit 1; }   # o teste 1 reaplica a migration original (idempotência); o reforço vem depois
$PSQL < $MIG3 || { echo "FALHA ao reaplicar o acesso de operador"; exit 1; }
OUT="$OUT
$($PSQL -A -t -F' | ' < scripts/sql/test_pagamentos_endurecimento.sql 2>&1)
$($PSQL -A -t -F' | ' < scripts/sql/test_acesso_operador.sql 2>&1)"
echo "$OUT"
echo "$OUT" | grep -qE "^FAIL|ERROR" && { echo "HÁ FALHAS"; exit 1; }
echo "$OUT" | grep -q "^PASS" || { echo "nenhum PASS (teste não executou)"; exit 1; }
echo "OK: migration de pagamentos validada em Docker"
