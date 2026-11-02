-- N5 (#88): sacola ABERTA com validade vencida vira EXPIRADO no banco (antes só a leitura derivava).
-- ⚠️ Aprovação de schema (Pedro OU Bárbara) antes de aplicar em produção. Idempotente. Rollback no fim.
-- Roda no mesmo ritmo do cron que expira reservas (2 min); libera as reservas da sacola junto.

create or replace function public.sacolas_expirar() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select id, codigo from orcamentos where status = 'ABERTA' and validade <= now() for update skip locked loop
    update orcamentos set status = 'EXPIRADO', atualizado_em = now() where id = r.id;
    perform liberar_reserva('sacola', r.codigo);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.sacolas_expirar() from public, anon, authenticated;
grant execute on function public.sacolas_expirar() to service_role;

do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'omni-sacolas-expirar';
  perform cron.schedule('omni-sacolas-expirar', '*/2 * * * *', 'select public.sacolas_expirar()');
exception when others then
  raise notice 'pg_cron indisponível neste ambiente (%): agendamento não criado.', sqlerrm;
end $$;

-- ROLLBACK (manual):
-- select cron.unschedule(jobid) from cron.job where jobname = 'omni-sacolas-expirar';
-- drop function if exists public.sacolas_expirar();
