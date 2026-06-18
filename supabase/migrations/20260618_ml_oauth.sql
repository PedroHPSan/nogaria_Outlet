-- Tabela de credenciais OAuth do Mercado Livre (1 linha). O refresh_token do ML
-- ROTACIONA a cada refresh, por isso guardamos no banco (não em secret estático).
-- Acesso só via service_role (a Edge Function). RLS ligada, sem policies públicas.
create table if not exists ml_oauth (
  id            smallint primary key default 1,
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  updated_at    timestamptz default now(),
  constraint ml_oauth_singleton check (id = 1)
);
alter table ml_oauth enable row level security;
-- (sem policies = ninguém com anon/auth lê; service_role ignora RLS)
 
