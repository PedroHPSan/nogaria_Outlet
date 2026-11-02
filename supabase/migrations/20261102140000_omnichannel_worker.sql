-- Omnichannel (issue E0-3): RPCs da outbox de jobs + agendamento (pg_cron/pg_net) do worker sync-canais.
-- Depende de 20261102120000_omnichannel_base.sql.
-- ⚠️ NÃO aplicar em produção sem OK de Pedro OU Bárbara (via MCP apply_migration, antes do deploy).
-- Idempotente. Rollback no fim (comentado).

-- Enfileira (idempotente por idem_key).
create or replace function public.enfileirar_job(
  p_tipo text, p_payload jsonb, p_idem_key text, p_proximo_em timestamptz default now()
) returns bigint language sql security definer set search_path = public as $$
  insert into integracao_jobs (tipo, payload, idem_key, proximo_em)
  values (p_tipo, coalesce(p_payload, '{}'::jsonb), p_idem_key, coalesce(p_proximo_em, now()))
  on conflict (idem_key) do nothing
  returning id;
$$;

-- Claim atômico: pega até p_limite jobs vencidos (pendente|erro) e marca como rodando.
-- Jobs presos em 'rodando' há mais de 10 min (worker morreu) voltam para a fila.
create or replace function public.jobs_claim(p_limite integer default 10)
returns setof integracao_jobs language plpgsql security definer set search_path = public as $$
begin
  update integracao_jobs set status = 'erro', erro = coalesce(erro, 'worker interrompido'), atualizado_em = now()
   where status = 'rodando' and atualizado_em < now() - interval '10 minutes';
  return query
    with pegos as (
      select id from integracao_jobs
       where status in ('pendente','erro') and proximo_em <= now()
       order by proximo_em, id
       limit greatest(p_limite, 0)
       for update skip locked
    )
    update integracao_jobs j set status = 'rodando', tentativas = j.tentativas + 1, atualizado_em = now()
      from pegos where j.id = pegos.id
    returning j.*;
end $$;

-- Conclui um job: ok → 'ok'; falha → backoff 1/5/15/60 min; a 5ª tentativa vira 'morto'.
create or replace function public.job_concluir(p_id bigint, p_ok boolean, p_erro text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_tent integer; v_status text;
begin
  select tentativas into v_tent from integracao_jobs where id = p_id for update;
  if not found then return null; end if;
  if p_ok then
    v_status := 'ok';
    update integracao_jobs set status = 'ok', erro = null, atualizado_em = now() where id = p_id;
  elsif v_tent >= 5 then
    v_status := 'morto';
    update integracao_jobs set status = 'morto', erro = left(p_erro, 1000), atualizado_em = now() where id = p_id;
  else
    v_status := 'erro';
    update integracao_jobs set status = 'erro', erro = left(p_erro, 1000), atualizado_em = now(),
           proximo_em = now() + (case v_tent when 1 then interval '1 minute' when 2 then interval '5 minutes'
                                 when 3 then interval '15 minutes' else interval '60 minutes' end)
     where id = p_id;
  end if;
  return v_status;
end $$;

-- "Tentar de novo" (tela de canais): reenfileira um job erro/morto.
create or replace function public.job_reenfileirar(p_id bigint) returns void
language sql security definer set search_path = public as $$
  update integracao_jobs set status = 'pendente', tentativas = 0, erro = null, proximo_em = now(), atualizado_em = now()
   where id = p_id and status in ('erro','morto');
$$;

revoke all on function public.enfileirar_job(text, jsonb, text, timestamptz) from public, anon;
revoke all on function public.jobs_claim(integer) from public, anon, authenticated;
revoke all on function public.job_concluir(bigint, boolean, text) from public, anon, authenticated;
revoke all on function public.job_reenfileirar(bigint) from public, anon;
grant execute on function public.enfileirar_job(text, jsonb, text, timestamptz) to authenticated, service_role;
grant execute on function public.jobs_claim(integer) to service_role;
grant execute on function public.job_concluir(bigint, boolean, text) to service_role;
grant execute on function public.job_reenfileirar(bigint) to authenticated, service_role;

-- Visão de jobs para a tela de canais (E5-1): o app não lê a tabela (sem policy), só esta função.
create or replace function public.jobs_listar(p_status text default null, p_limite integer default 100)
returns table (id bigint, tipo text, status text, tentativas integer, erro text, proximo_em timestamptz, atualizado_em timestamptz)
language sql security definer set search_path = public as $$
  select id, tipo, status, tentativas, erro, proximo_em, atualizado_em from integracao_jobs
   where p_status is null or status = p_status order by atualizado_em desc limit least(greatest(p_limite, 1), 500);
$$;
revoke all on function public.jobs_listar(text, integer) from public, anon;
grant execute on function public.jobs_listar(text, integer) to authenticated, service_role;

-- Agendamento (pg_cron + pg_net); o cron roda a cada 2 min mas só chama a função se houver job. Segredos no Vault (criados à mão no painel, nunca em migration):
--   sync_canais_url    = https://<ref>.supabase.co/functions/v1/sync-canais
--   sync_canais_secret = mesmo valor do secret CRON_SECRET da Edge Function
create or replace function public.cron_chamar_worker() returns void
language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'sync_canais_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'sync_canais_secret';
  if v_url is null or v_secret is null then return; end if;  -- ainda não configurado: não faz nada
  -- Só invoca a Edge Function quando há trabalho (em dia parado, zero invocações).
  if not exists (select 1 from integracao_jobs
                  where (status in ('pendente','erro') and proximo_em <= now())
                     or (status = 'rodando' and atualizado_em < now() - interval '10 minutes')) then
    return;
  end if;
  perform net.http_post(url := v_url, headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_secret),
                        body := '{}'::jsonb, timeout_milliseconds := 20000);
end $$;
revoke all on function public.cron_chamar_worker() from public, anon, authenticated;

do $$ begin
  create extension if not exists pg_net;
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname in ('omni-worker', 'omni-expirar-reservas');
  perform cron.schedule('omni-worker', '*/2 * * * *', 'select public.cron_chamar_worker()');
  perform cron.schedule('omni-expirar-reservas', '*/2 * * * *', 'select public.reservas_expirar()');
exception when others then
  raise notice 'pg_cron/pg_net indisponíveis neste ambiente (%): agendamento não criado.', sqlerrm;
end $$;

-- ROLLBACK (manual):
-- select cron.unschedule(jobid) from cron.job where jobname in ('omni-worker','omni-expirar-reservas');
-- drop function if exists public.cron_chamar_worker();
-- drop function if exists public.jobs_listar(text, integer);
-- drop function if exists public.job_reenfileirar(bigint);
-- drop function if exists public.job_concluir(bigint, boolean, text);
-- drop function if exists public.jobs_claim(integer);
-- drop function if exists public.enfileirar_job(text, jsonb, text, timestamptz);
