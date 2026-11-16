-- Reforço do permissionamento de vendas (20261116100000_gestores_venda), achados da revisão de segurança:
-- 1) sacolas_expirar (cron, sem JWT) libera as reservas de sacola ABERTA com validade vencida. Um não-gestor podia
--    vencer a validade pela API e o cron cancelava a separação por ele. Agora, com reserva ATIVA, não-gestor só
--    encurta a validade se ela continuar >= agora + 20 h (o menor prazo legítimo do app é 1 dia: renovar 1 dia).
-- 2) Apagar e recriar o item contornava a trava de preço (o primeiro preço é livre). O app não apaga itens:
--    DELETE em itens passa a ser só de gestor (service_role/migrations passam).
-- ⚠️ Aprovação de schema (Pedro OU Bárbara) antes de aplicar em produção. Idempotente. Rollback no fim (comentado).

create or replace function public.orcamentos_guarda_cancelamento() returns trigger
language plpgsql as $$
declare v_reservado boolean;
begin
  if public.pode_gerir_venda() then return new; end if;
  v_reservado := exists (select 1 from reservas r where r.status = 'ATIVA' and r.origem_ref = old.codigo);
  if not v_reservado then return new; end if;
  if new.status = 'CANCELADO' and old.status is distinct from 'CANCELADO' then
    raise exception '%: só Bárbara e Valentina podem cancelar a separação.', old.codigo using errcode = '42501';
  end if;
  if new.validade is distinct from old.validade
     and (new.validade is null or (new.validade < coalesce(old.validade, 'infinity') and new.validade < now() + interval '20 hours')) then
    raise exception '%: só Bárbara e Valentina podem encurtar o prazo de uma separação.', old.codigo using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_orcamentos_guarda_cancelamento on public.orcamentos;
create trigger trg_orcamentos_guarda_cancelamento before update of status, validade on public.orcamentos
  for each row execute function public.orcamentos_guarda_cancelamento();

create or replace function public.itens_guarda_exclusao() returns trigger
language plpgsql as $$
begin
  if not public.pode_gerir_venda() then
    raise exception '%: só Bárbara e Valentina podem excluir um item.', old.sku using errcode = '42501';
  end if;
  return old;
end $$;
drop trigger if exists trg_itens_guarda_exclusao on public.itens;
create trigger trg_itens_guarda_exclusao before delete on public.itens
  for each row execute function public.itens_guarda_exclusao();

-- ROLLBACK (manual):
-- drop trigger if exists trg_itens_guarda_exclusao on public.itens;
-- drop function if exists public.itens_guarda_exclusao();
-- (e recriar orcamentos_guarda_cancelamento + trigger "before update of status" como em 20261116100000)
