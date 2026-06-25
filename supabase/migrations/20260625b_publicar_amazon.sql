-- Feature "Publicar na Amazon" (v1 modo oferta). Estado de publicação por item/canal
-- + credenciais OAuth LWA da Amazon.
-- ⚠️ NÃO aplicar sem OK de Pedro OU Bárbara (Supabase é a fonte de verdade).
-- Idempotente.

-- Estado da publicação por SKU x canal (Amazon agora; ML/Shopee depois).
create table if not exists public.listing_state (
  sku                 text not null references public.itens(sku) on delete cascade,
  canal               text not null,
  estado              text not null default 'nao_publicado',  -- nao_publicado|publicando|publicado|erro|pausado
  external_listing_id text,
  ultimo_erro         text,
  payload             jsonb,
  updated_at          timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  primary key (sku, canal)
);
alter table public.listing_state enable row level security;
drop policy if exists auth_full_listing_state on public.listing_state;
create policy auth_full_listing_state on public.listing_state
  for all to authenticated using (true) with check (true);

-- Credenciais OAuth da Amazon (LWA) — linha singleton id=1. Sem policy de RLS:
-- só o service_role (Edge Function) acessa; nem authenticated nem anon leem o token.
create table if not exists public.amazon_oauth (
  id            integer primary key default 1 check (id = 1),
  refresh_token text,
  access_token  text,
  expires_at    timestamptz,
  updated_at    timestamptz not null default now()
);
alter table public.amazon_oauth enable row level security;
