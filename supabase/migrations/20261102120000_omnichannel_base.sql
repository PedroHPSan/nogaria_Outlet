-- Omnichannel base (issue E0-1): canais, reservas, pedidos por canal, outbox de jobs, inbox de webhooks.
-- ⚠️ NÃO aplicar em produção sem OK de Pedro OU Bárbara (via MCP apply_migration, antes do deploy).
-- Idempotente. Rollback no fim do arquivo (comentado).

-- 1) Canais (substitui a lista livre CANAIS_VENDA; itens.canal_venda continua como texto de exibição).
create table if not exists public.canais (
  codigo text primary key,
  nome   text not null,
  ativo  boolean not null default true,
  config jsonb not null default '{}'::jsonb
);
insert into public.canais (codigo, nome) values
  ('whatsapp','Grupo WhatsApp'), ('instagram','Instagram'), ('amazon','Amazon'),
  ('mercadolivre','Mercado Livre'), ('tiktok','TikTok Shop'), ('hiper','Hiper'),
  ('parceiro','Parceiro'), ('direto','B2C / Venda direta')
on conflict (codigo) do nothing;
alter table public.canais enable row level security;
drop policy if exists canais_ler on public.canais;
create policy canais_ler on public.canais for select to authenticated using (true);
drop policy if exists canais_atualizar on public.canais;
create policy canais_atualizar on public.canais for update to authenticated using (true) with check (true);

alter table public.itens add column if not exists canal_codigo text references public.canais(codigo);
update public.itens i set canal_codigo = c.codigo
  from public.canais c
 where i.canal_codigo is null and i.canal_venda is not null and lower(i.canal_venda) = lower(c.nome);
-- Valores antigos fora do mapa (ex.: "WhatsApp") ficam com canal_codigo nulo para revisão manual.
update public.itens set canal_codigo = 'whatsapp'
 where canal_codigo is null and canal_venda ilike '%whatsapp%';

-- 2) Reservas: um SKU só pode ter UMA reserva ATIVA (garantido pelo banco).
create table if not exists public.reservas (
  id          uuid primary key default gen_random_uuid(),
  sku         text not null references public.itens(sku) on delete cascade,
  canal       text not null references public.canais(codigo),
  origem_tipo text not null check (origem_tipo in ('sacola','interesse','pedido_amazon','pedido_ml','carrinho_wa','ig_dm','manual')),
  origem_ref  text,
  status      text not null default 'ATIVA' check (status in ('ATIVA','CONFIRMADA','LIBERADA','EXPIRADA')),
  expira_em   timestamptz,
  criado_por  text,
  criado_em   timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists uq_reservas_sku_ativa on public.reservas (sku) where status = 'ATIVA';
create index if not exists idx_reservas_expira on public.reservas (expira_em) where status = 'ATIVA';
alter table public.reservas enable row level security;
drop policy if exists auth_full_reservas on public.reservas;
create policy auth_full_reservas on public.reservas for all to authenticated using (true) with check (true);

-- Projeção em itens.reservado_ate / reservado_por_orc (compatibilidade com as telas atuais).
create or replace function public.reservas_projetar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'ATIVA' or tg_op = 'UPDATE' and new.status = 'ATIVA' then
    update itens set reservado_ate = coalesce(new.expira_em, now() + interval '10 years'),
                     reservado_por_orc = case when new.origem_tipo = 'sacola' then new.origem_ref end
     where sku = new.sku;
  elsif tg_op = 'UPDATE' and old.status = 'ATIVA' then
    update itens set reservado_ate = null, reservado_por_orc = null where sku = new.sku;
  end if;
  new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists trg_reservas_projetar on public.reservas;
create trigger trg_reservas_projetar before insert or update on public.reservas
  for each row execute function public.reservas_projetar();

-- 3) listing_state ampliada (Amazon já usa; instagram/whatsapp/mercadolivre entram depois).
alter table public.listing_state add column if not exists quantidade_publicada integer;
alter table public.listing_state add column if not exists url_publica text;
alter table public.listing_state add column if not exists precisa_sync boolean not null default false;
alter table public.listing_state add column if not exists sync_em timestamptz;
alter table public.listing_state add column if not exists pausado_motivo text;

-- 4) Pedidos vindos dos canais (sem PII de comprador de marketplace).
create table if not exists public.pedidos_canal (
  id          uuid primary key default gen_random_uuid(),
  canal       text not null references public.canais(codigo),
  external_id text not null,
  status      text not null default 'RECEBIDO',
  comprador_ref text,
  valor       numeric(12,2),
  moeda       text not null default 'BRL',
  itens       jsonb not null default '[]'::jsonb,
  raw         jsonb,
  recebido_em timestamptz not null default now(),
  unique (canal, external_id)
);
alter table public.pedidos_canal enable row level security;
drop policy if exists auth_full_pedidos_canal on public.pedidos_canal;
create policy auth_full_pedidos_canal on public.pedidos_canal for all to authenticated using (true) with check (true);

-- 5) Outbox de jobs (worker sync-canais) e inbox de webhooks: só service_role (sem policy).
create table if not exists public.integracao_jobs (
  id          bigint generated always as identity primary key,
  tipo        text not null,
  payload     jsonb not null default '{}'::jsonb,
  idem_key    text not null unique,
  status      text not null default 'pendente' check (status in ('pendente','rodando','ok','erro','morto')),
  tentativas  integer not null default 0,
  proximo_em  timestamptz not null default now(),
  erro        text,
  criado_em   timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_jobs_pendentes on public.integracao_jobs (proximo_em) where status in ('pendente','erro');
alter table public.integracao_jobs enable row level security;

create table if not exists public.webhook_eventos (
  id           bigint generated always as identity primary key,
  canal        text not null,
  external_id  text not null,
  topico       text,
  payload      jsonb not null,
  recebido_em  timestamptz not null default now(),
  processado_em timestamptz,
  erro         text,
  unique (canal, external_id)
);
alter table public.webhook_eventos enable row level security;

-- 6) Visão unificada de pedidos (sacolas do WhatsApp + pedidos em € + pedidos de marketplace).
create or replace view public.vw_pedidos_unificados with (security_invoker = on) as
  select 'sacola:' || o.codigo as ref, 'whatsapp'::text as canal, o.status, o.total as valor,
         'BRL'::text as moeda, o.criado_em as em
    from public.orcamentos o where o.origem = 'whatsapp'
  union all
  select 'interesse:' || i.codigo, 'whatsapp', i.status, i.eur, 'EUR', i.criado_em
    from public.interesses i
  union all
  select 'pedido:' || p.canal || ':' || p.external_id, p.canal, p.status, p.valor, p.moeda, p.recebido_em
    from public.pedidos_canal p;

-- ROLLBACK (manual):
-- drop view if exists public.vw_pedidos_unificados;
-- drop table if exists public.webhook_eventos, public.integracao_jobs, public.pedidos_canal, public.reservas;
-- alter table public.itens drop column if exists canal_codigo;
-- drop table if exists public.canais;
-- drop function if exists public.reservas_projetar();
-- alter table public.listing_state drop column if exists quantidade_publicada, drop column if exists url_publica,
--   drop column if exists precisa_sync, drop column if exists sync_em, drop column if exists pausado_motivo;
