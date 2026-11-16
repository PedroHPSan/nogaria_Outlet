-- Terceiro reforço (revisão de segurança do PR #188): reservas.expira_em aceita NULL (reserva sem prazo). Com NULL,
-- as comparações da trava viravam NULL e o `if` não disparava (falha aberta): não-gestor podia expirar ou encurtar uma
-- reserva sem prazo. Agora: sem prazo = infinito, e qualquer resultado não-verdadeiro de "permitido" recusa (falha fechada).
-- ⚠️ Aprovação de schema (Pedro OU Bárbara) antes de aplicar em produção. Idempotente.

create or replace function public.reservas_guarda_liberacao() returns trigger
language plpgsql as $$
declare
  v_ok boolean := true;
  v_old_exp timestamptz;
  v_new_exp timestamptz;
begin
  if public.pode_gerir_venda() then return case when tg_op = 'DELETE' then old else new end; end if;
  v_old_exp := coalesce(old.expira_em, 'infinity');
  if tg_op = 'DELETE' then
    v_ok := false;
  else
    v_new_exp := coalesce(new.expira_em, 'infinity');
    v_ok := (new.sku = old.sku)
      and (new.status = old.status
           or (old.status = 'ATIVA' and (new.status = 'CONFIRMADA' or (new.status = 'EXPIRADA' and v_old_exp <= now()))))
      and (new.status <> 'ATIVA' or v_new_exp >= v_old_exp or v_new_exp >= now() + interval '20 hours')
      and ((new.origem_tipo = old.origem_tipo and new.origem_ref is not distinct from old.origem_ref)
           or (old.status = 'ATIVA' and old.origem_tipo in ('carrinho_wa', 'interesse') and new.origem_tipo = 'sacola'));
  end if;
  if v_ok is not true then
    raise exception '%: só Bárbara e Valentina podem cancelar a separação do item.', old.sku using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function public.orcamentos_guarda_cancelamento() returns trigger
language plpgsql as $$
declare v_old_val timestamptz; v_new_val timestamptz;
begin
  if public.pode_gerir_venda() then return case when tg_op = 'DELETE' then old else new end; end if;
  if not exists (select 1 from reservas r where r.status = 'ATIVA' and r.origem_ref = old.codigo) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' or new.codigo is distinct from old.codigo
     or (new.status is not distinct from 'CANCELADO' and old.status is distinct from 'CANCELADO') then
    raise exception '%: só Bárbara e Valentina podem cancelar a separação.', old.codigo using errcode = '42501';
  end if;
  v_old_val := coalesce(old.validade, 'infinity');
  v_new_val := coalesce(new.validade, 'infinity');
  if not (v_new_val >= v_old_val or v_new_val >= now() + interval '20 hours') then
    raise exception '%: só Bárbara e Valentina podem encurtar o prazo de uma separação.', old.codigo using errcode = '42501';
  end if;
  return new;
end $$;
