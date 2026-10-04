-- Base MÍNIMA para testar as migrations 20260801* em um Postgres local descartável.
-- (As migrations antigas não são reaplicáveis do zero: schema_inicial é stub.)
-- Uso: ver scripts/sql/README.md
create table itens (
  sku text primary key, produto text, status text not null default 'A_CATALOGAR',
  preco_ideal numeric, classe text, estado text, upd_by text, valor_vendido numeric,
  pedido_ref text, comprador text, canal_venda text, vendido_em timestamptz
);
create table eventos (id bigserial primary key, sku text, acao text, usuario text, ts timestamptz not null default now());
create table catalogos_publicos (
  slug text primary key, titulo text, edicao text, payload jsonb not null,
  expira_em timestamptz not null default now() + interval '30 days', criado_por uuid
);
alter table itens enable row level security; alter table eventos enable row level security; alter table catalogos_publicos enable row level security;
create policy auth_full_itens on itens for all to authenticated using (true) with check (true);
create policy auth_full_eventos on eventos for all to authenticated using (true) with check (true);
create policy auth_all_cp on catalogos_publicos for all to authenticated using (true) with check (true);
create policy anon_cp on catalogos_publicos for select to anon using (expira_em > now());
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on catalogos_publicos to anon;
