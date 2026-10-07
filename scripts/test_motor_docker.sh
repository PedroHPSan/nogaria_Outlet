#!/usr/bin/env bash
# Teste em Docker da migration do motor de preço v2 (Postgres descartável com a imagem do Supabase).
# NÃO toca nenhum banco real. Faixa de porta do Outlet: 556xx. Uso: bash scripts/test_motor_docker.sh
set -uo pipefail
cd "$(dirname "$0")/.."
NAME=nogaria_outlet_motor_pg
PORT=55699
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
# lotes e colunas que o schema inicial (stub) não traz
$PSQL -c "create table lotes (lote integer primary key, lance_final numeric, custo_total numeric, referencia text); alter table lotes enable row level security; create policy auth_full_lotes on lotes for all to authenticated using (true) with check (true); alter table itens add column lote integer;" || exit 1
MIG=supabase/migrations/20261008120000_motor_preco_v2.sql
$PSQL < $MIG || { echo "FALHA ao aplicar a migration"; exit 1; }
$PSQL < $MIG || { echo "FALHA: migration não é idempotente (2ª aplicação)"; exit 1; }
# paridade (ANTES do teste SQL, que edita parâmetros): os seeds do banco devem reproduzir as constantes do motor (JS)
SEED=$(mktemp)
$PSQL -A -t -c "select json_build_object('params', (select json_agg(t) from (select chave, valor from pricing_v2_param) t), 'canais', (select json_agg(c) from (select codigo, nome, taxa, fixo_valor, fixo_abaixo_de, frete_pct from pricing_v2_canal) c))" > "$SEED"
node scripts/test_seed_paridade.mjs "$SEED" || { echo "FAIL | seeds divergem das constantes do motor"; exit 1; }
# o teste lê o backfill com \i (caminho relativo ao cwd do psql dentro do container)
docker cp scripts/sql $NAME:/tmp/sql >/dev/null
OUT=$(sed 's#scripts/sql/#/tmp/sql/#' scripts/sql/test_migration_motor_v2.sql | $PSQL -A -t -F' | ' 2>&1)
echo "$OUT"
# rollback: precisa remover tudo sem erro
ROLL=$(sed -n '/^-- ROLLBACK/,$p' $MIG | sed 's/^--   //; /^-- ROLLBACK/d' | grep -v '^$')
echo "$ROLL" | $PSQL >/dev/null 2>&1 && echo "PASS | rollback executa sem erro" || { echo "FAIL | rollback falhou"; exit 1; }
LEFT=$($PSQL -A -t -c "select count(*) from information_schema.tables where table_name in ('item_peso_rateio_log','item_custo_snapshot','pricing_v2_param','pricing_v2_canal')")
[ "$LEFT" = "0" ] && echo "PASS | rollback remove as 4 tabelas" || { echo "FAIL | rollback deixou $LEFT tabela(s)"; exit 1; }
echo "$OUT" | grep -q "^FAIL" && { echo "HÁ FALHAS"; exit 1; }
echo "$OUT" | grep -q "^PASS" || { echo "nenhum PASS (teste não executou)"; exit 1; }
echo "OK: migration do motor v2 validada em Docker"
