# Teste local das migrations do catálogo (20260801*)

Postgres descartável com a imagem do Supabase (não toca nenhum banco real):

```sh
docker run -d --name nogaria_outlet_test_pg -e POSTGRES_PASSWORD=postgres -p 55999:5432 public.ecr.aws/supabase/postgres:17.6.1.104
PSQL="docker exec -i -e PGPASSWORD=postgres nogaria_outlet_test_pg psql -h localhost -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q"
$PSQL < scripts/sql/base_minima.sql
for f in supabase/migrations/20260801*.sql; do $PSQL < "$f"; done
$PSQL < scripts/sql/test_migrations_catalogo.sql   # tudo deve sair PASS
docker rm -f nogaria_outlet_test_pg
```

A base mínima existe porque o histórico em `supabase/migrations` não é reaplicável do
zero (o schema inicial foi criado pelo painel e está como stub).
