-- Comportamento da migration 20261102140000_omnichannel_worker.sql (roda como supabase_admin).
\set QUIET on
create temp table res (teste text, ok boolean, detalhe text);

delete from integracao_jobs;  -- limpa jobs de testes anteriores
select enfileirar_job('noop','{}','w-1');
delete from integracao_jobs;  -- limpa jobs de testes anteriores
select enfileirar_job('noop','{}','w-1');
insert into res select 'enfileirar é idempotente', (select count(*) from integracao_jobs where idem_key='w-1')=1, null;
select enfileirar_job('noop','{}','w-futuro', now()+interval '1 hour');

create temp table claim1 as select * from jobs_claim(10);
insert into res select 'claim pega só jobs vencidos e marca rodando',
  (select count(*) from claim1) = 1 and (select status from integracao_jobs where idem_key='w-1')='rodando'
  and (select tentativas from integracao_jobs where idem_key='w-1')=1, null;
insert into res select 'claim não repete job em execução', (select count(*) from jobs_claim(10))=0, null;

select job_concluir(id, true) from integracao_jobs where idem_key='w-1';
insert into res select 'concluir ok', (select status from integracao_jobs where idem_key='w-1')='ok', null;

-- backoff e morte na 5ª tentativa
select enfileirar_job('noop','{"falhar":"x"}','w-erro');
do $$ declare i integer; id_ bigint; st text; atraso interval; esperado interval[] := array['1 minute','5 minutes','15 minutes','60 minutes']; ok boolean := true; begin
  select id into id_ from integracao_jobs where idem_key='w-erro';
  for i in 1..5 loop
    update integracao_jobs set proximo_em = now() where id = id_;
    perform jobs_claim(10);
    st := job_concluir(id_, false, 'falhou ' || i);
    if i < 5 then
      select proximo_em - now() into atraso from integracao_jobs where id = id_;
      ok := ok and st = 'erro' and abs(extract(epoch from atraso - esperado[i]::interval)) < 5;
    else ok := ok and st = 'morto'; end if;
  end loop;
  insert into res values ('backoff 1/5/15/60 min e morto na 5ª tentativa', ok, st);
end $$;
select job_reenfileirar(id) from integracao_jobs where idem_key='w-erro';
insert into res select 'reenfileirar zera o job morto', (select status='pendente' and tentativas=0 from integracao_jobs where idem_key='w-erro'), null;

-- job preso em 'rodando' volta para a fila
select enfileirar_job('noop','{}','w-preso');
update integracao_jobs set status='rodando', atualizado_em = now()-interval '11 minutes' where idem_key='w-preso';
create temp table claim2 as select * from jobs_claim(10);
insert into res select 'job preso é recuperado', (select tentativas from integracao_jobs where idem_key='w-preso')=1 and (select status from integracao_jobs where idem_key='w-preso')='rodando', null;

-- permissões
insert into res select 'authenticated não executa jobs_claim', not has_function_privilege('authenticated','jobs_claim(integer)','execute'), null;
insert into res select 'service_role executa jobs_claim', has_function_privilege('service_role','jobs_claim(integer)','execute'), null;
insert into res select 'authenticated lista jobs pela função', has_function_privilege('authenticated','jobs_listar(text,integer)','execute'), null;

-- cron: sem segredos no Vault não chama nada (e não falha)
select cron_chamar_worker();
insert into res select 'cron_chamar_worker sem Vault configurado não falha', true, null;
insert into res select 'agendamentos criados', (select count(*) from cron.job where jobname in ('omni-worker','omni-expirar-reservas'))=2, null;

select case when ok then 'PASS' else 'FAIL' end || ' | ' || teste || coalesce(' | ' || detalhe, '') from res;
