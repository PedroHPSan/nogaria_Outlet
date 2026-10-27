#!/usr/bin/env bash
# Teste em Docker da migration das sacolas (Postgres descartável com a imagem do Supabase).
# NÃO toca nenhum banco real. Faixa de porta do Outlet: 556xx. Uso: bash scripts/test_sacolas_docker.sh
set -uo pipefail
cd "$(dirname "$0")/.."
NAME=nogaria_outlet_sacolas_pg
PORT=55698
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
$PSQL < supabase/migrations/20260801130000_orcamentos.sql || { echo "FALHA: migration dos orçamentos"; exit 1; }
MIG=supabase/migrations/20261028120000_sacolas_whatsapp.sql
$PSQL < $MIG || { echo "FALHA ao aplicar a migration"; exit 1; }
$PSQL < $MIG || { echo "FALHA: migration não é idempotente (2ª aplicação)"; exit 1; }
OUT=$($PSQL -A -t -F' | ' < scripts/sql/test_sacolas.sql 2>&1)
echo "$OUT"
echo "$OUT" | grep -q "^FAIL" && { echo "HÁ FALHAS"; exit 1; }
echo "$OUT" | grep -q "^PASS" || { echo "nenhum PASS (teste não executou)"; exit 1; }
echo "OK: migration das sacolas validada em Docker"
