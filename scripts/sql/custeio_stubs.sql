-- Stubs do que a migration custos_lote_v2 espera (tabelas do motor de preço que não reaplicam do zero).
create table lotes (
  lote integer primary key, referencia text, qtd_oficial integer, custo_total numeric, lance_final numeric, valor_mercado numeric,
  local_retirada text, created_at timestamptz not null default now(), valor_pago_hisa numeric, comissao_leiloeiro numeric, taxa_hisa numeric,
  frete_retirada numeric, frete_transferencia numeric, outros_custos numeric, fechado_em timestamptz, custo_composto numeric
);
create table pricing_lote_custo (lote integer primary key, custo_total numeric);
alter table itens add column if not exists lote integer references lotes(lote), add column if not exists grupo text,
  add column if not exists preco_sugerido numeric, add column if not exists peso_kg numeric, add column if not exists peso_real_kg numeric;
alter table lotes enable row level security;
create policy auth_full_lotes on lotes for all to authenticated using (true) with check (true);
grant select, insert, update, delete on lotes, pricing_lote_custo to authenticated;
