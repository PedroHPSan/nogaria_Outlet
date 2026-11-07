#!/usr/bin/env bash
# Teste em Docker da migration das campanhas (Postgres descartável com a imagem do Supabase).
# NÃO toca nenhum banco real. Faixa de porta do Outlet: 556xx. Uso: bash scripts/test_campanhas_docker.sh
set -uo pipefail
cd "$(dirname "$0")/.."
NAME=nogaria_outlet_campanhas_pg
PORT=55696
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
$PSQL < supabase/migrations/20260801130000_orcamentos.sql || { echo "FALHA: orçamentos"; exit 1; }
$PSQL < scripts/sql/campanhas_stubs.sql || { echo "FALHA: stubs"; exit 1; }
MIG=supabase/migrations/20261107150000_campanhas.sql
$PSQL < $MIG || { echo "FALHA ao aplicar a migration"; exit 1; }
$PSQL < $MIG || { echo "FALHA: migration não é idempotente (2ª aplicação)"; exit 1; }
# F4 precisa do que existia antes: pedidos em € (tabelas + RPC com 25%), feed e /i (recriados pela migration)
$PSQL < supabase/migrations/20261031130000_interesses_oferta.sql || { echo "FALHA: interesses"; exit 1; }
$PSQL < supabase/migrations/20261104100000_acrescimo_euro_25.sql || { echo "FALHA: acréscimo €"; exit 1; }
MIG4=supabase/migrations/20261107170000_campanha_superficies.sql
MIG6=supabase/migrations/20261107190000_campanha_resultado.sql
MIG5=supabase/migrations/20261107180000_campanha_sacola.sql
MIG3=supabase/migrations/20261107160000_campanha_publica.sql
$PSQL < $MIG3 || { echo "FALHA ao aplicar a migration da página pública"; exit 1; }
$PSQL < $MIG3 || { echo "FALHA: migration da página pública não é idempotente"; exit 1; }
$PSQL < $MIG4 || { echo "FALHA ao aplicar a migration das superfícies"; exit 1; }
$PSQL < $MIG4 || { echo "FALHA: migration das superfícies não é idempotente"; exit 1; }
$PSQL < $MIG5 || { echo "FALHA ao aplicar a migration da sacola"; exit 1; }
$PSQL < $MIG5 || { echo "FALHA: migration da sacola não é idempotente"; exit 1; }
$PSQL < $MIG6 || { echo "FALHA ao aplicar a migration do resultado"; exit 1; }
$PSQL < $MIG6 || { echo "FALHA: migration do resultado não é idempotente"; exit 1; }
OUT=$($PSQL -A -t -F' | ' < scripts/sql/test_campanhas.sql 2>&1) || { echo "$OUT"; echo "FALHA: test_campanhas.sql abortou"; exit 1; }
OUT2=$($PSQL -A -t -F' | ' < scripts/sql/test_campanha_publica.sql 2>&1) || { echo "$OUT2"; echo "FALHA: test_campanha_publica.sql abortou"; exit 1; }
OUT3=$($PSQL -A -t -F' | ' < scripts/sql/test_campanha_superficies.sql 2>&1) || { echo "$OUT3"; echo "FALHA: test_campanha_superficies.sql abortou"; exit 1; }
OUT4=$($PSQL -A -t -F' | ' < scripts/sql/test_campanha_sacola.sql 2>&1) || { echo "$OUT4"; echo "FALHA: test_campanha_sacola.sql abortou"; exit 1; }
OUT5=$($PSQL -A -t -F' | ' < scripts/sql/test_campanha_resultado.sql 2>&1) || { echo "$OUT5"; echo "FALHA: test_campanha_resultado.sql abortou"; exit 1; }
OUT="$OUT"$'\n'"$OUT2"$'\n'"$OUT3"$'\n'"$OUT4"$'\n'"$OUT5"
echo "$OUT"
echo "$OUT" | grep -q "^FAIL" && { echo "HÁ FALHAS"; exit 1; }
echo "$OUT" | grep -q "^PASS" || { echo "nenhum PASS (teste não executou)"; exit 1; }
echo "OK: migration das campanhas validada em Docker"
