-- Custeio por lote OU por produto + custos adicionais lançáveis.
--  * lotes.modo_custeio: 'rateio' (valor do lote fixo, rateado entre os itens) | 'soma' (custo do lote = soma dos itens).
--  * lotes.custo_origem: NULL = legado (custo_total como está); 'composto' = custo_total é mantido por trigger
--    (base + custos adicionais) e espelhado em pricing_lote_custo, de onde vw_lote_resultado/vw_precificacao leem.
--  * itens.custo_direto: custo próprio do item (null = sem custo direto; entra no rateio).
--  * lote_custos_extra: frete, separador, embalagem etc. Com `sku` = custo só daquele item; sem `sku` = do lote (rateado).
-- Aditiva: nada é movido nem apagado; lotes existentes continuam como estão até alguém salvar o custo na tela.

alter table lotes add column if not exists modo_custeio text not null default 'rateio'
  check (modo_custeio in ('rateio', 'soma'));
alter table lotes add column if not exists custo_origem text
  check (custo_origem in ('composto'));
alter table itens add column if not exists custo_direto numeric check (custo_direto is null or custo_direto >= 0);

create table if not exists lote_custos_extra (
  id          bigserial primary key,
  lote        integer not null references lotes(lote) on update cascade on delete cascade,
  sku         text references itens(sku) on update cascade on delete cascade,
  tipo        text not null default 'outros',
  descricao   text,
  valor       numeric not null check (valor >= 0),
  data        date not null default current_date,
  criado_por  text,
  criado_em   timestamptz not null default now()
);
create index if not exists lote_custos_extra_lote_idx on lote_custos_extra (lote);
create index if not exists lote_custos_extra_sku_idx  on lote_custos_extra (sku) where sku is not null;

alter table lote_custos_extra enable row level security;
drop policy if exists auth_full_lote_custos_extra on lote_custos_extra;
create policy auth_full_lote_custos_extra on lote_custos_extra for all to authenticated using (true) with check (true);
grant select, insert, update, delete on lote_custos_extra to authenticated;
grant all on lote_custos_extra to service_role;
grant usage, select on sequence lote_custos_extra_id_seq to authenticated, service_role;

-- Custo total de um lote 'composto'. Retorna NULL para lote legado.
create or replace function custo_total_composto(p_lote integer) returns numeric
language sql stable as $$
  select case when l.custo_origem is distinct from 'composto' then null else
    case l.modo_custeio
      when 'soma' then coalesce((select sum(i.custo_direto) from itens i where i.lote = l.lote), 0)
      else coalesce(l.lance_final, 0) + coalesce(l.comissao_leiloeiro, 0) + coalesce(l.taxa_hisa, 0)
    end
    + coalesce((select sum(e.valor) from lote_custos_extra e where e.lote = l.lote), 0)
  end
  from lotes l where l.lote = p_lote
$$;

-- Mantém lotes.custo_total e pricing_lote_custo em dia (só lotes 'composto').
create or replace function sync_custo_lote(p_lote integer) returns void
language plpgsql as $$
declare v numeric;
begin
  v := custo_total_composto(p_lote);
  if v is null then return; end if;
  update lotes set custo_total = v where lote = p_lote and custo_total is distinct from v;
  insert into pricing_lote_custo (lote, custo_total) values (p_lote, v)
    on conflict (lote) do update set custo_total = excluded.custo_total;
end $$;

-- Mudou o lote (modo, valores, origem): recalcula. Roda DEPOIS do update (a função relê a linha).
create or replace function trg_lotes_sync_custo() returns trigger language plpgsql as $$
begin
  if new.custo_origem = 'composto' then perform sync_custo_lote(new.lote); end if;
  return null;
end $$;
drop trigger if exists lotes_sync_custo on lotes;
create trigger lotes_sync_custo after insert or update of modo_custeio, custo_origem, lance_final, comissao_leiloeiro, taxa_hisa
  on lotes for each row when (pg_trigger_depth() < 1) execute function trg_lotes_sync_custo();

create or replace function trg_extra_sync_custo() returns trigger language plpgsql as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform sync_custo_lote(old.lote); end if;
  if tg_op in ('INSERT', 'UPDATE') then perform sync_custo_lote(new.lote); end if;
  return null;
end $$;
drop trigger if exists extra_sync_custo on lote_custos_extra;
create trigger extra_sync_custo after insert or update or delete on lote_custos_extra
  for each row execute function trg_extra_sync_custo();

-- Custo direto de item muda: só importa para lotes em modo 'soma'.
create or replace function trg_item_custo_direto() returns trigger language plpgsql as $$
begin
  if new.lote is not null then perform sync_custo_lote(new.lote); end if;
  if tg_op = 'UPDATE' and old.lote is distinct from new.lote and old.lote is not null then perform sync_custo_lote(old.lote); end if;
  return null;
end $$;
drop trigger if exists item_custo_direto_sync on itens;
create trigger item_custo_direto_sync after update of custo_direto, lote on itens
  for each row when (old.custo_direto is distinct from new.custo_direto or old.lote is distinct from new.lote)
  execute function trg_item_custo_direto();

-- Rollback:
--   drop trigger item_custo_direto_sync on itens; drop trigger extra_sync_custo on lote_custos_extra; drop trigger lotes_sync_custo on lotes;
--   drop function trg_item_custo_direto, trg_extra_sync_custo, trg_lotes_sync_custo, sync_custo_lote, custo_total_composto;
--   drop table lote_custos_extra; alter table itens drop column custo_direto; alter table lotes drop column custo_origem, drop column modo_custeio;
