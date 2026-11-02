-- WhatsApp Cloud API (issue E1-2): contatos com opt-in e log de mensagens (com custo real por mensagem).
-- Depende de 20261102120000_omnichannel_base.sql.
-- ⚠️ NÃO aplicar em produção sem OK de Pedro OU Bárbara (via MCP apply_migration, antes do deploy).
-- Idempotente. Rollback no fim (comentado).

create table if not exists public.contatos_whatsapp (
  wa_id         text primary key,                 -- número internacional só dígitos, como a Meta envia
  nome          text,
  opt_in_em     timestamptz,                      -- consentimento explícito para marketing (ENTRAR)
  opt_out_em    timestamptz,                      -- SAIR bloqueia marketing
  janela_ate    timestamptz,                      -- fim da janela de atendimento de 24 h (última msg recebida + 24 h)
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.contatos_whatsapp enable row level security;
drop policy if exists contatos_wa_ler on public.contatos_whatsapp;
create policy contatos_wa_ler on public.contatos_whatsapp for select to authenticated using (true);
-- escrita só pelo service_role (Edge Function)

create table if not exists public.mensagens_whatsapp (
  id            bigint generated always as identity primary key,
  wa_message_id text unique,                       -- wamid.* (entrada ou saída)
  wa_id         text not null,
  direcao       text not null check (direcao in ('in','out')),
  tipo          text not null default 'text',
  texto         text,
  status        text,                              -- sent|delivered|read|failed (saída)
  categoria     text,                              -- marketing|utility|authentication|service (pricing.category)
  billable      boolean,
  pricing_model text,
  payload       jsonb,
  criado_em     timestamptz not null default now()
);
create index if not exists idx_msgs_wa_conversa on public.mensagens_whatsapp (wa_id, criado_em desc);
alter table public.mensagens_whatsapp enable row level security;
drop policy if exists msgs_wa_ler on public.mensagens_whatsapp;
create policy msgs_wa_ler on public.mensagens_whatsapp for select to authenticated using (true);

-- ROLLBACK (manual):
-- drop table if exists public.mensagens_whatsapp, public.contatos_whatsapp;
