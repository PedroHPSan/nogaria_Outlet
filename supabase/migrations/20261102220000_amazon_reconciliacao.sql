-- N3 (#86): reconciliação diária Amazon × banco. 07:00 em Brasília = 10:00 UTC.
-- ⚠️ Aprovação de schema (Pedro OU Bárbara) antes de aplicar em produção. Idempotente. Rollback no fim.
-- Chama amazon-listings {verificar:true}: o que está à venda na Amazon sem estoque vira job amazon.quantidade=0.
-- Reaproveita os segredos do Vault do worker (sync_canais_url/secret); a função aceita x-cron-secret.

create or replace function public.cron_reconciliar_amazon() returns void
language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'sync_canais_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'sync_canais_secret';
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(url := replace(v_url, '/sync-canais', '/amazon-listings'),
                        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_secret),
                        body := '{"verificar": true}'::jsonb, timeout_milliseconds := 120000);
end $$;
revoke all on function public.cron_reconciliar_amazon() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'omni-amazon-reconciliar';
  perform cron.schedule('omni-amazon-reconciliar', '0 10 * * *', 'select public.cron_reconciliar_amazon()');
exception when others then
  raise notice 'pg_cron/pg_net indisponíveis neste ambiente (%): agendamento não criado.', sqlerrm;
end $$;

-- ROLLBACK (manual):
-- select cron.unschedule(jobid) from cron.job where jobname = 'omni-amazon-reconciliar';
-- drop function if exists public.cron_reconciliar_amazon();
