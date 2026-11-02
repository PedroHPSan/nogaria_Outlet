-- WhatsApp: conexão do número oficial (coexistência via Cadastro Incorporado). Guarda waba/número e o token da empresa
-- (60 dias) num singleton só do service_role (mesmo padrão de instagram_oauth/amazon_oauth); o app só lê o status sem token.
-- ⚠️ Aprovação de schema (Pedro OU Bárbara) antes de aplicar em produção. Idempotente. Rollback no fim.
create table if not exists public.whatsapp_oauth (
  id              integer primary key default 1 check (id = 1),
  waba_id         text,
  phone_number_id text,
  display_phone   text,
  verified_name   text,
  access_token    text,
  expires_at      timestamptz,
  sync_contatos   text,   -- resultado do pedido de sincronização (ok | erro: ...)
  sync_historico  text,
  updated_at      timestamptz not null default now()
);
alter table public.whatsapp_oauth enable row level security;  -- sem policy: só service_role

create or replace function public.whatsapp_conexao()
returns table (waba_id text, phone_number_id text, display_phone text, verified_name text, expires_em timestamptz, sync_contatos text, sync_historico text, atualizado_em timestamptz)
language sql stable security definer set search_path = public as $$
  select waba_id, phone_number_id, display_phone, verified_name, expires_at, sync_contatos, sync_historico, updated_at from whatsapp_oauth where id = 1
$$;
revoke all on function public.whatsapp_conexao() from public, anon;
grant execute on function public.whatsapp_conexao() to authenticated, service_role;

-- ROLLBACK (manual): drop function if exists public.whatsapp_conexao(); drop table if exists public.whatsapp_oauth;
