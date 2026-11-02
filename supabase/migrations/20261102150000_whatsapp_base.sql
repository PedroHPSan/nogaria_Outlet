-- WhatsApp Cloud API (issue E1-2): contatos com opt-in e log de mensagens (com custo real por mensagem).
-- Depende de 20261102120000_omnichannel_base.sql.
-- ⚠️ NÃO aplicar em produção sem OK de Pedro OU Bárbara (via MCP apply_migration, antes do deploy).
-- Idempotente. Rollback no fim (comentado).

create table if not exists public.contatos_whatsapp (
  wa_id         text primary key,                 -- número internacional só dígitos, como a Meta envia
  nome          text,
  opt_in_em     timestamptz,                      -- consentimento explícito para marketing (ENTRAR)
  opt_out_em    timestamptz,                      -- SAIR bloqueia marketing
  falhas_codigo    integer not null default 0,      -- tentativas de código de pedido inválidas (limite 5/h)
  falhas_codigo_em timestamptz,
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

-- Código de pedido em € (interesses): o primeiro número que o reivindica fica com ele; outros são recusados.
alter table public.interesses add column if not exists wa_id text;

create or replace function public.whatsapp_reivindicar_codigo(p_wa_id text, p_codigo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c contatos_whatsapp%rowtype; i interesses%rowtype; v_nova boolean;
begin
  select * into c from contatos_whatsapp where wa_id = p_wa_id for update;
  if not found then raise exception 'contato inexistente'; end if;
  if c.falhas_codigo >= 5 and c.falhas_codigo_em > now() - interval '1 hour' then
    return jsonb_build_object('status', 'bloqueado');
  end if;
  select * into i from interesses where codigo = upper(p_codigo) and status = 'ABERTO' and valido_ate > now() for update;
  if not found or (i.wa_id is not null and i.wa_id <> p_wa_id) then
    update contatos_whatsapp
       set falhas_codigo = case when falhas_codigo_em > now() - interval '1 hour' then falhas_codigo + 1 else 1 end,
           falhas_codigo_em = now()
     where wa_id = p_wa_id;
    return jsonb_build_object('status', case when found then 'ja_usado' else 'invalido' end);
  end if;
  v_nova := i.wa_id is null;
  if v_nova then update interesses set wa_id = p_wa_id where id = i.id; end if;
  return jsonb_build_object('status', 'ok', 'sku', i.sku, 'valido_ate', i.valido_ate, 'nova', v_nova);
end $$;
revoke all on function public.whatsapp_reivindicar_codigo(text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_reivindicar_codigo(text, text) to service_role;

-- ROLLBACK (manual):
-- drop function if exists public.whatsapp_reivindicar_codigo(text, text);
-- alter table public.interesses drop column if exists wa_id;
-- drop table if exists public.mensagens_whatsapp, public.contatos_whatsapp;
