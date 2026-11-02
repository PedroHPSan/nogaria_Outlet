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

-- Reserva pelo WhatsApp: teto por número e (opcional) exigência de item publicado, na MESMA transação,
-- com lock por número (duas mensagens simultâneas não furam o teto). SKUs que o número já reservou não renovam prazo.
-- Publicado = em oferta/catálogo público vigente OU listing_state('whatsapp') = publicado (catálogo Meta, E1-4).
-- Devolve quantos SKUs novos foram reservados (0 = já estavam reservados para o número).
create or replace function public.whatsapp_reservar(
  p_wa_id text, p_skus text[], p_origem_tipo text, p_origem_ref text, p_expira_em timestamptz,
  p_max integer default 3, p_exigir_publicado boolean default true
) returns integer language plpgsql security definer set search_path = public as $$
declare v_user text := 'wa:' || p_wa_id; v_ja text[]; v_novos text[]; s text;
begin
  perform pg_advisory_xact_lock(hashtext('wa:' || p_wa_id));
  perform reservas_expirar();
  select coalesce(array_agg(sku), '{}') into v_ja from reservas where status = 'ATIVA' and criado_por = v_user;
  select coalesce(array_agg(distinct x), '{}') into v_novos from unnest(p_skus) x where x <> all (v_ja);
  if cardinality(v_novos) = 0 then return 0; end if;
  if cardinality(v_ja) + cardinality(v_novos) > p_max then
    raise exception 'LIMITE_RESERVAS' using errcode = 'P0001';
  end if;
  if p_exigir_publicado then
    foreach s in array v_novos loop
      if not exists (select 1 from catalogos_publicos c where c.expira_em > now()
                      and c.payload->'itens' @> jsonb_build_array(jsonb_build_object('sku', s)))
         and not exists (select 1 from listing_state l where l.sku = s and l.canal = 'whatsapp' and l.estado = 'publicado') then
        raise exception 'NAO_PUBLICADO: %', s using errcode = 'P0001';
      end if;
    end loop;
  end if;
  return reservar_itens(v_novos, 'whatsapp', p_origem_tipo, p_origem_ref, p_expira_em, v_user);
end $$;
revoke all on function public.whatsapp_reservar(text, text[], text, text, timestamptz, integer, boolean) from public, anon, authenticated;
grant execute on function public.whatsapp_reservar(text, text[], text, text, timestamptz, integer, boolean) to service_role;

-- ROLLBACK (manual):
-- drop function if exists public.whatsapp_reservar(text, text[], text, text, timestamptz, integer, boolean);
-- drop function if exists public.whatsapp_reivindicar_codigo(text, text);
-- alter table public.interesses drop column if exists wa_id;
-- drop table if exists public.mensagens_whatsapp, public.contatos_whatsapp;
