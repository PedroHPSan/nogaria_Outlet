#!/usr/bin/env bash
# Teste em Docker da migration custos_lote_v2 (Postgres descartável com a imagem do Supabase). NÃO toca banco real.
# Faixa de porta do Outlet: 556xx. Uso: bash scripts/test_custeio_docker.sh
set -uo pipefail
cd "$(dirname "$0")/.."
NAME=nogaria_outlet_custeio_pg
PORT=55694
IMG=public.ecr.aws/supabase/postgres:17.6.1.104
PSQL="docker exec -i -e PGPASSWORD=postgres $NAME psql -h localhost -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q"
cleanup() { docker rm -f $NAME >/dev/null 2>&1; }
trap cleanup EXIT
cleanup
docker run -d --name $NAME -e POSTGRES_PASSWORD=postgres -p $PORT:5432 $IMG >/dev/null || exit 1
echo "aguardando o Postgres…"
for i in $(seq 1 60); do docker exec -e PGPASSWORD=postgres $NAME pg_isready -h localhost -U supabase_admin >/dev/null 2>&1 && break; sleep 2; done
sleep 3
$PSQL < scripts/sql/base_minima.sql || exit 1
$PSQL < scripts/sql/custeio_stubs.sql || { echo "FALHA: stubs"; exit 1; }
$PSQL < supabase/migrations/20261103100000_custeio_lote_produto.sql || { echo "FALHA: custeio_lote_produto"; exit 1; }
MIG=supabase/migrations/20261108100000_custos_lote_v2.sql
$PSQL < $MIG || { echo "FALHA ao aplicar a migration"; exit 1; }
$PSQL < $MIG || { echo "FALHA: migration não é idempotente (2ª aplicação)"; exit 1; }
OUT=$($PSQL -A -t -F' | ' < scripts/sql/test_custeio.sql 2>&1) || { echo "$OUT"; echo "FALHA: test_custeio.sql abortou"; exit 1; }
echo "$OUT"
echo "$OUT" | grep -q "^FAIL" && { echo "HÁ FALHAS"; exit 1; }
echo "$OUT" | grep -q "^PASS" || { echo "nenhum PASS (teste não executou)"; exit 1; }
echo "OK: migration dos custos validada em Docker"
