-- WhatsApp (issue E1-3): envio transacional por template. Depende das migrations omnichannel + whatsapp_base.
-- ⚠️ NÃO aplicar em produção sem OK de Pedro OU Bárbara (via MCP apply_migration, antes do deploy).
-- Idempotente. Rollback no fim (comentado).

alter table public.mensagens_whatsapp add column if not exists ref_tipo text;   -- 'sacola'
alter table public.mensagens_whatsapp add column if not exists ref text;        -- código da sacola
alter table public.mensagens_whatsapp add column if not exists evento text;     -- cobranca|pago|entrega
alter table public.mensagens_whatsapp add column if not exists template text;
alter table public.mensagens_whatsapp add column if not exists erro text;
create index if not exists idx_msgs_wa_ref on public.mensagens_whatsapp (ref_tipo, ref, evento);

-- O app não enfileira jobs arbitrários: só pelas RPCs específicas (o worker confia no payload).
revoke execute on function public.enfileirar_job(text, jsonb, text, timestamptz) from authenticated;

-- Pede o envio de um evento da sacola. Idempotente por (sacola, evento): reenvio não duplica.
create or replace function public.whatsapp_enviar(p_ref_tipo text, p_ref text, p_evento text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_fone text;
begin
  if p_ref_tipo <> 'sacola' or p_evento not in ('cobranca','pago','entrega') then
    raise exception 'evento inválido'; end if;
  select cliente_whatsapp into v_fone from orcamentos where codigo = p_ref and origem = 'whatsapp';
  if not found then raise exception 'sacola não encontrada'; end if;
  if coalesce(v_fone, '') = '' then raise exception 'sacola sem WhatsApp do cliente'; end if;
  return enfileirar_job('wa.template',
    jsonb_build_object('ref_tipo', p_ref_tipo, 'ref', p_ref, 'evento', p_evento),
    'wa:' || p_ref_tipo || ':' || p_ref || ':' || p_evento);
end $$;
revoke all on function public.whatsapp_enviar(text, text, text) from public, anon;
grant execute on function public.whatsapp_enviar(text, text, text) to authenticated, service_role;

-- Situação dos envios de uma sacola: job (pendente|rodando|erro|morto|ok) + status da mensagem (sent|delivered|read|failed).
create or replace function public.whatsapp_envios(p_ref_tipo text, p_ref text)
returns table (evento text, job_status text, erro text, msg_status text, atualizado_em timestamptz)
language sql security definer set search_path = public as $$
  select j.payload->>'evento', j.status, j.erro, m.status, greatest(j.atualizado_em, coalesce(m.criado_em, j.atualizado_em))
    from integracao_jobs j
    left join lateral (select status, criado_em from mensagens_whatsapp m
                        where m.ref_tipo = p_ref_tipo and m.ref = p_ref and m.evento = j.payload->>'evento' and m.direcao = 'out'
                        order by m.criado_em desc limit 1) m on true
   where j.tipo = 'wa.template' and j.payload->>'ref_tipo' = p_ref_tipo and j.payload->>'ref' = p_ref;
$$;
revoke all on function public.whatsapp_envios(text, text) from public, anon;
grant execute on function public.whatsapp_envios(text, text) to authenticated, service_role;

-- ROLLBACK (manual):
-- drop function if exists public.whatsapp_envios(text, text);
-- drop function if exists public.whatsapp_enviar(text, text, text);
-- grant execute on function public.enfileirar_job(text, jsonb, text, timestamptz) to authenticated;
-- alter table public.mensagens_whatsapp drop column if exists ref_tipo, drop column if exists ref,
--   drop column if exists evento, drop column if exists template, drop column if exists erro;
