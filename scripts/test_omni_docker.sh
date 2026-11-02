#!/usr/bin/env bash
# Teste em Docker da migration omnichannel_base (Postgres descartável com a imagem do Supabase).
# NÃO toca nenhum banco real. Faixa de porta do Outlet: 556xx. Uso: bash scripts/test_omni_docker.sh
set -uo pipefail
cd "$(dirname "$0")/.."
NAME=nogaria_outlet_omni_pg
PORT=55697
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
for M in 20260801130000_orcamentos 20261028120000_sacolas_whatsapp 20260625143345_publicar_amazon; do
  $PSQL < supabase/migrations/$M.sql || { echo "FALHA: pré-requisito $M"; exit 1; }
done
# `interesses` real exige a RPC/cotações; aqui só o necessário para a view.
$PSQL -c "create table if not exists public.interesses (id uuid primary key default gen_random_uuid(), codigo text not null unique, status text not null default 'ABERTO', sku text, valido_ate timestamptz not null default now() + interval '1 day', eur numeric(12,2) not null default 0, criado_em timestamptz not null default now());" || exit 1
MIG=supabase/migrations/20261102120000_omnichannel_base.sql
$PSQL < $MIG || { echo "FALHA ao aplicar a migration"; exit 1; }
$PSQL < $MIG || { echo "FALHA: migration não é idempotente (2ª aplicação)"; exit 1; }
OUT=$($PSQL -A -t -F' | ' < scripts/sql/test_omnichannel.sql 2>&1)
echo "$OUT"
echo "$OUT" | grep -q "^FAIL" && { echo "HÁ FALHAS"; exit 1; }
echo "$OUT" | grep -q "^PASS" || { echo "nenhum PASS (teste não executou)"; exit 1; }
# E0-2: RPCs
$PSQL -c "alter table itens add column if not exists taxa_venda numeric, add column if not exists frete_pago numeric;" || exit 1
MIG2=supabase/migrations/20261102130000_omnichannel_rpcs.sql
$PSQL < $MIG2 || { echo "FALHA ao aplicar a migration das RPCs"; exit 1; }
$PSQL < $MIG2 || { echo "FALHA: migration das RPCs não é idempotente"; exit 1; }
OUT2=$($PSQL -A -t -F' | ' < scripts/sql/test_omni_rpcs.sql 2>&1)
echo "$OUT2"
echo "$OUT2" | grep -q "^FAIL" && { echo "HÁ FALHAS (RPCs)"; exit 1; }
echo "$OUT2" | grep -q "^PASS" || { echo "nenhum PASS nas RPCs"; exit 1; }
# E0-3: worker
MIG3=supabase/migrations/20261102140000_omnichannel_worker.sql
$PSQL < $MIG3 || { echo "FALHA ao aplicar a migration do worker"; exit 1; }
$PSQL < $MIG3 || { echo "FALHA: migration do worker não é idempotente"; exit 1; }
OUT3=$($PSQL -A -t -F' | ' < scripts/sql/test_omni_worker.sql 2>&1)
echo "$OUT3"
echo "$OUT3" | grep -q "^FAIL" && { echo "HÁ FALHAS (worker)"; exit 1; }
echo "$OUT3" | grep -q "^PASS" || { echo "nenhum PASS no worker"; exit 1; }
# E1-2: WhatsApp
MIG4=supabase/migrations/20261102150000_whatsapp_base.sql
$PSQL < $MIG4 || { echo "FALHA ao aplicar a migration do WhatsApp"; exit 1; }
$PSQL < $MIG4 || { echo "FALHA: migration do WhatsApp não é idempotente"; exit 1; }
OUT4=$($PSQL -A -t -F' | ' < scripts/sql/test_whatsapp.sql 2>&1)
echo "$OUT4"
echo "$OUT4" | grep -q "^FAIL" && { echo "HÁ FALHAS (WhatsApp)"; exit 1; }
echo "$OUT4" | grep -q "^PASS" || { echo "nenhum PASS no WhatsApp"; exit 1; }
# E1-3: envio transacional
MIG5=supabase/migrations/20261102160000_whatsapp_envio.sql
$PSQL < $MIG5 || { echo "FALHA ao aplicar a migration de envio"; exit 1; }
$PSQL < $MIG5 || { echo "FALHA: migration de envio não é idempotente"; exit 1; }
OUT5=$($PSQL -A -t -F' | ' < scripts/sql/test_whatsapp_envio.sql 2>&1)
echo "$OUT5"
echo "$OUT5" | grep -q "^FAIL" && { echo "HÁ FALHAS (envio)"; exit 1; }
echo "$OUT5" | grep -q "^PASS" || { echo "nenhum PASS no envio"; exit 1; }
# Teto por número sob concorrência: 6 sessões do mesmo número reservam SKUs diferentes → no máximo 3.
$PSQL -c "insert into itens (sku, produto, status) select 'TT'||g, 'T', 'PRONTO' from generate_series(1,6) g; insert into contatos_whatsapp (wa_id) values ('5599'); insert into listing_state (sku, canal, estado) select 'TT'||g, 'whatsapp', 'publicado' from generate_series(1,6) g;" || exit 1
for i in $(seq 1 6); do
  docker exec -e PGPASSWORD=postgres $NAME psql -h localhost -U supabase_admin -d postgres -q -t -A \
    -c "select whatsapp_reservar('5599', array['TT$i'], 'carrinho_wa', '5599', now()+interval '1 day')" >/dev/null 2>&1 &
done
wait
TETO=$($PSQL -A -t -c "select count(*) from reservas where criado_por='wa:5599' and status='ATIVA'" | tr -d ' ')
[ "$TETO" = "3" ] || { echo "FALHA: teto sob concorrência — $TETO reservas (esperado 3)"; exit 1; }
echo "PASS | 6 reservas simultâneas do mesmo número → teto de 3 respeitado"
# Concorrência: 8 sessões reservam o mesmo SKU ao mesmo tempo → exatamente 1 vence.
$PSQL -c "insert into itens (sku, produto, status) values ('CC1','Conc','PRONTO');" || exit 1
for i in $(seq 1 8); do
  docker exec -e PGPASSWORD=postgres $NAME psql -h localhost -U supabase_admin -d postgres -q -t -A \
    -c "select reservar_item('CC1','whatsapp','sacola','ORC-$i')" >/tmp/omni_cc_$i.out 2>&1 &
done
wait
OKS=$(grep -l '"reserva_id"' /tmp/omni_cc_*.out 2>/dev/null | wc -l | tr -d ' ')
rm -f /tmp/omni_cc_*.out
[ "$OKS" = "1" ] || { echo "FALHA: concorrência — $OKS vencedores (esperado 1)"; exit 1; }
echo "PASS | 8 reservas simultâneas no mesmo SKU → 1 vencedor"
echo "OK: migrations omnichannel validadas em Docker"
