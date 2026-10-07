-- Motor de preço v2 — schema ADITIVO (nada destrutivo, tudo `if not exists`, defaults seguros).
-- *** NÃO APLICADA — aguarda validação de Pedro e Bárbara. ***
-- O app tolera a ausência de tudo isto (usa estimativas e pesos padrão); aplicar só habilita:
--   • custo real do lote por componente (HISA)            • peso manual de rateio por item (+ log)
--   • congelar o rateio do lote (snapshot)                • parâmetros do motor editáveis
-- Rollback no fim do arquivo.

-- 1) Composição do custo do lote. `custo_total` permanece como está (as views atuais dependem dele);
--    `custo_composto` soma os componentes e só existe quando há valor pago. Frete NULL = sem dado
--    (o app usa a estimativa) — nunca gravar 0 como "não sei".
alter table lotes add column if not exists valor_pago_hisa numeric;
alter table lotes add column if not exists comissao_leiloeiro numeric;
alter table lotes add column if not exists taxa_hisa numeric;
alter table lotes add column if not exists frete_retirada numeric;
alter table lotes add column if not exists frete_transferencia numeric;
alter table lotes add column if not exists outros_custos numeric;
alter table lotes add column if not exists fechado_em timestamptz;
alter table lotes add column if not exists custo_composto numeric generated always as (
  case when lance_final is null then null else
    lance_final + coalesce(comissao_leiloeiro, 0) + coalesce(taxa_hisa, 0)
    + coalesce(frete_retirada, 0) + coalesce(frete_transferencia, 0) + coalesce(outros_custos, 0) end
) stored;

-- 2) Peso manual do rateio por item (0,25–4, padrão 1) + trilha de auditoria.
alter table itens add column if not exists peso_rateio numeric not null default 1
  check (peso_rateio between 0.25 and 4);
alter table itens add column if not exists peso_rateio_motivo text;
create table if not exists item_peso_rateio_log (
  id bigserial primary key,
  sku text not null,
  valor_antes numeric,
  valor_depois numeric not null,
  motivo text not null,
  usuario text,
  em timestamptz not null default now()
);
create index if not exists item_peso_rateio_log_sku on item_peso_rateio_log (sku);

-- 3) Snapshot do rateio ao fechar o lote (contabilidade estável: vendido/descartado não distorce).
create table if not exists item_custo_snapshot (
  sku text primary key,
  lote integer not null,
  custo_alocado numeric not null,
  w numeric,
  peso_k numeric,
  calculado_por text,
  calculado_em timestamptz not null default now()
);
create index if not exists item_custo_snapshot_lote on item_custo_snapshot (lote);

-- 4) Parâmetros editáveis do motor (o app usa constantes enquanto vazio).
create table if not exists pricing_v2_param (
  chave text primary key,
  valor numeric not null,
  obs text,
  atualizado_em timestamptz not null default now()
);
create table if not exists pricing_v2_canal (
  codigo text primary key,
  nome text,
  taxa numeric not null,            -- % do preço (0,12 = 12%)
  fixo_valor numeric not null default 0,
  fixo_abaixo_de numeric,           -- tarifa fixa só abaixo deste preço (null = sempre)
  frete_pct numeric not null,       -- frete estimado, % do preço
  atualizado_em timestamptz not null default now()
);
insert into pricing_v2_param (chave, valor, obs) values
  ('imposto', 0.13, 'Nogaria, sobre receita bruta'),
  ('comissao_vendedor', 0.03, 'comissão de quem vende'),
  ('adm', 0.10, 'custo administrativo (triagem, embalagem, operação)'),
  ('reserva', 0.03, 'reserva de devolução/perda (sugerida)'),
  ('margem_min', 0.25, 'margem mínima oficial, única'),
  ('preco_min_ml', 29.90, 'preço mínimo de anúncio no ML'),
  ('preco_min_shopee', 19.90, 'preço mínimo de anúncio na Shopee'),
  ('limite_kit', 40, 'abaixo disto o item é candidato a kit')
on conflict (chave) do nothing;
insert into pricing_v2_canal (codigo, nome, taxa, fixo_valor, fixo_abaixo_de, frete_pct) values
  ('ML', 'Mercado Livre Clássico', 0.12, 6.50, 79, 0.10),
  ('SHOPEE', 'Shopee', 0.20, 4, null, 0.10),
  ('TIKTOK', 'TikTok Shop', 0.06, 2, null, 0.10),
  ('MAGALU', 'Magalu', 0.16, 0, null, 0.10),
  ('AMAZON', 'Amazon', 0.12, 2, null, 0.10),
  ('SITE', 'Site próprio', 0.05, 0, null, 0.10),
  ('B2B', 'B2B / atacado', 0.02, 0, null, 0.025),
  ('LOCAL', 'Venda local', 0, 0, null, 0)
on conflict (codigo) do nothing;

-- 5) RLS no padrão do projeto (auth_full_*): acesso total só para autenticados, nada para anon.
do $$
declare t text;
begin
  foreach t in array array['item_peso_rateio_log', 'item_custo_snapshot', 'pricing_v2_param', 'pricing_v2_canal'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists auth_full_%1$s on public.%1$I', t);
    execute format('create policy auth_full_%1$s on public.%1$I for all to authenticated using (true) with check (true)', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
-- Grants explícitos (não depender dos privilégios padrão do ambiente): o RLS acima é quem restringe linhas.
grant select, insert, update, delete on public.item_peso_rateio_log, public.item_custo_snapshot,
  public.pricing_v2_param, public.pricing_v2_canal to authenticated;
grant all on public.item_peso_rateio_log, public.item_custo_snapshot, public.pricing_v2_param, public.pricing_v2_canal to service_role;
grant usage, select on sequence item_peso_rateio_log_id_seq to authenticated, service_role;

-- ROLLBACK (se necessário):
--   drop table if exists item_peso_rateio_log, item_custo_snapshot, pricing_v2_param, pricing_v2_canal;
--   alter table itens drop column if exists peso_rateio, drop column if exists peso_rateio_motivo;
--   alter table lotes drop column if exists custo_composto, drop column if exists valor_pago_hisa,
--     drop column if exists comissao_leiloeiro, drop column if exists taxa_hisa, drop column if exists frete_retirada,
--     drop column if exists frete_transferencia, drop column if exists outros_custos, drop column if exists fechado_em;
