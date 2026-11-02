-- N7 (#90): alertas operacionais por e-mail (Resend) + painel no app. Independe do worker: roda no próprio banco (pg_cron + pg_net),
-- porque "worker parado" é justamente a falha que o worker não consegue avisar.
-- ⚠️ Aprovação de schema (Pedro OU Bárbara) antes de aplicar em produção. Idempotente. Rollback no fim.
--
-- Condições (a cada 5 min): worker parado (job vencido há > 15 min ou 'rodando' preso), job morto (últimos 7 dias),
-- cron sem segredos no Vault, peça vendida ainda publicada na Amazon. Cada condição vira 1 linha em alertas_operacionais
-- (badge no app) e, com credenciais no Vault, 1 e-mail agregado — reenviado no máx. a cada 6 h enquanto persistir.
-- Vault (criado pelo script scripts/deploy/alerta_email.sh, nunca em migration): alerta_resend_key, alerta_email_para.

create table if not exists public.alertas_operacionais (
  chave           text primary key,        -- worker_parado | job_morto | cron_sem_segredos | divergencia_amazon
  detalhe         text not null,
  aberto_em       timestamptz not null default now(),
  ultimo_envio_em timestamptz,
  resolvido_em    timestamptz,
  atualizado_em   timestamptz not null default now()
);
alter table public.alertas_operacionais enable row level security;
drop policy if exists alertas_ler on public.alertas_operacionais;
create policy alertas_ler on public.alertas_operacionais for select to authenticated using (true);
-- escrita só pela função (security definer)

create or replace function public.alertas_abertos()
returns table (chave text, detalhe text, aberto_em timestamptz)
language sql stable security definer set search_path = public as $$
  select chave, detalhe, aberto_em from alertas_operacionais where resolvido_em is null order by aberto_em
$$;
revoke all on function public.alertas_abertos() from public, anon;
grant execute on function public.alertas_abertos() to authenticated, service_role;

create or replace function public.alertas_checar() returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record; v_n integer; v_min timestamptz; v_chaves text[] := '{}'; v_key text; v_to text;
  v_corpo text := ''; v_enviar boolean := false; v_enviados integer := 0;
begin
  for r in
    select * from (
      select 'worker_parado'::text as chave,
             (select format('%s job(s) vencido(s) sem execução há mais de 15 min (o mais antigo: %s). Cobranças, posts, retiradas de canal e o bot do WhatsApp estão parados.',
                            count(*), to_char(min(proximo_em) at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'))
                from integracao_jobs
               where (status in ('pendente','erro') and proximo_em < now() - interval '15 minutes')
                  or (status = 'rodando' and atualizado_em < now() - interval '15 minutes')
              having count(*) > 0) as detalhe
      union all
      select 'job_morto',
             (select format('%s job(s) esgotaram as tentativas (tipos: %s). Veja o Painel do catálogo → Integrações com problema.',
                            count(*), string_agg(distinct tipo, ', '))
                from integracao_jobs where status = 'morto' and atualizado_em > now() - interval '7 days' having count(*) > 0)
      union all
      select 'cron_sem_segredos',
             case when (select count(*) from vault.decrypted_secrets where name in ('sync_canais_url','sync_canais_secret')) < 2
                  then 'O cron não consegue chamar o worker: faltam sync_canais_url/sync_canais_secret no Vault.' end
      union all
      select 'divergencia_amazon',
             (select format('%s peça(s) vendida(s)/descartada(s) ainda publicadas na Amazon (%s). A reconciliação das 07:00 pausa; confira antes.',
                            count(*), string_agg(l.sku, ', ' order by l.sku))
                from listing_state l join itens i using (sku)
               where l.canal = 'amazon' and l.estado = 'publicado' and i.status::text in ('VENDIDO','ENTREGUE','DESCARTE')
                 and l.updated_at < now() - interval '30 minutes' having count(*) > 0)
    ) x where detalhe is not null
  loop
    v_chaves := v_chaves || r.chave;
    insert into alertas_operacionais as a (chave, detalhe) values (r.chave, r.detalhe)
    on conflict (chave) do update
      set detalhe = excluded.detalhe, atualizado_em = now(),
          aberto_em = case when a.resolvido_em is not null then now() else a.aberto_em end,
          ultimo_envio_em = case when a.resolvido_em is not null then null else a.ultimo_envio_em end,
          resolvido_em = null;
  end loop;
  update alertas_operacionais set resolvido_em = now(), atualizado_em = now() where resolvido_em is null and not (chave = any (v_chaves));

  -- e-mail agregado (só com credenciais no Vault; sem elas o alerta fica só no app)
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'alerta_resend_key';
  select decrypted_secret into v_to from vault.decrypted_secrets where name = 'alerta_email_para';
  if v_key is null or v_to is null then return 0; end if;
  for r in select chave, detalhe from alertas_operacionais
            where resolvido_em is null and (ultimo_envio_em is null or ultimo_envio_em < now() - interval '6 hours') order by aberto_em loop
    v_corpo := v_corpo || '• ' || r.detalhe || E'\n\n'; v_enviar := true;
  end loop;
  if not v_enviar then return 0; end if;
  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object('from', 'Nogária Outlet <onboarding@resend.dev>', 'to', jsonb_build_array(v_to),
              'subject', '[Outlet] Alerta operacional', 'text', v_corpo || 'Painel: https://www.phps.app (Vendas → Painel do catálogo).'),
    timeout_milliseconds := 10000);
  update alertas_operacionais set ultimo_envio_em = now()
   where resolvido_em is null and (ultimo_envio_em is null or ultimo_envio_em < now() - interval '6 hours');
  get diagnostics v_enviados = row_count;
  return v_enviados;
end $$;
revoke all on function public.alertas_checar() from public, anon, authenticated;
grant execute on function public.alertas_checar() to service_role;

do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'omni-alertas';
  perform cron.schedule('omni-alertas', '*/5 * * * *', 'select public.alertas_checar()');
exception when others then
  raise notice 'pg_cron indisponível neste ambiente (%): agendamento não criado.', sqlerrm;
end $$;

-- ROLLBACK (manual):
-- select cron.unschedule(jobid) from cron.job where jobname = 'omni-alertas';
-- drop function if exists public.alertas_checar(); drop function if exists public.alertas_abertos(); drop table if exists public.alertas_operacionais;
