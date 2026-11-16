-- Segundo reforço do permissionamento de vendas (revisão de segurança do PR #187):
-- 1) sacolas_expirar (cron) passa a soltar só as reservas cujo PRÓPRIO prazo (reservas.expira_em) venceu, e não
--    mais todas as da sacola pelo `validade` dela. Fecha a família de atalhos "apagar/renomear a sacola e criar outra
--    com o mesmo código e validade vencida". No app os dois prazos são gravados juntos (separar/renovar).
-- 2) reservas: não-gestor não encurta expira_em para menos de agora + 20 h (antes só barrava <= agora; o menor prazo
--    legítimo gravado por usuário é 48 h no orçamento e 1 dia ao renovar sacola; o bot de 2 h é service_role).
-- 3) orcamentos: com reserva ATIVA, não-gestor não troca o código nem apaga a sacola/orçamento.
-- 4) itens: não-gestor não renomeia SKU de item já precificado (renomear + recriar contornava a trava de preço).
--    atribuirLote (conferência) renomeia; hoje nenhum item precificado está sem lote, então não afeta o uso.
-- ⚠️ Aprovação de schema (Pedro OU Bárbara) antes de aplicar em produção. Idempotente.

create or replace function public.sacolas_expirar() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select id, codigo from orcamentos where status = 'ABERTA' and validade <= now() for update skip locked loop
    update orcamentos set status = 'EXPIRADO', atualizado_em = now() where id = r.id;
    update reservas set status = 'LIBERADA'
     where status = 'ATIVA' and origem_tipo = 'sacola' and origem_ref = r.codigo and expira_em <= now();
    update itens i set reservado_ate = null, reservado_por_orc = null
     where i.reservado_por_orc = r.codigo
       and not exists (select 1 from reservas x where x.sku = i.sku and x.status = 'ATIVA');
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.reservas_guarda_liberacao() returns trigger
language plpgsql as $$
declare v_ok boolean := true;
begin
  if public.pode_gerir_venda() then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'DELETE' then
    v_ok := false;
  else
    if new.sku is distinct from old.sku then v_ok := false; end if;
    if new.status is distinct from old.status and not (
         old.status = 'ATIVA' and (new.status = 'CONFIRMADA' or (new.status = 'EXPIRADA' and old.expira_em <= now()))) then
      v_ok := false;
    end if;
    if new.status = 'ATIVA' and new.expira_em is distinct from old.expira_em
       and (new.expira_em is null or (new.expira_em < old.expira_em and new.expira_em < now() + interval '20 hours')) then
      v_ok := false;
    end if;
    if (new.origem_tipo, new.origem_ref) is distinct from (old.origem_tipo, old.origem_ref)
       and not (old.status = 'ATIVA' and old.origem_tipo in ('carrinho_wa', 'interesse') and new.origem_tipo = 'sacola') then
      v_ok := false;
    end if;
  end if;
  if not v_ok then
    raise exception '%: só Bárbara e Valentina podem cancelar a separação do item.', old.sku using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function public.orcamentos_guarda_cancelamento() returns trigger
language plpgsql as $$
begin
  if public.pode_gerir_venda() then return case when tg_op = 'DELETE' then old else new end; end if;
  if not exists (select 1 from reservas r where r.status = 'ATIVA' and r.origem_ref = old.codigo) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' or new.codigo is distinct from old.codigo
     or (new.status = 'CANCELADO' and old.status is distinct from 'CANCELADO') then
    raise exception '%: só Bárbara e Valentina podem cancelar a separação.', old.codigo using errcode = '42501';
  end if;
  if new.validade is distinct from old.validade
     and (new.validade is null or (new.validade < coalesce(old.validade, 'infinity') and new.validade < now() + interval '20 hours')) then
    raise exception '%: só Bárbara e Valentina podem encurtar o prazo de uma separação.', old.codigo using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_orcamentos_guarda_cancelamento on public.orcamentos;
create trigger trg_orcamentos_guarda_cancelamento before update of status, validade, codigo or delete on public.orcamentos
  for each row execute function public.orcamentos_guarda_cancelamento();

create or replace function public.itens_guarda_preco() returns trigger
language plpgsql as $$
begin
  if coalesce(old.preco_ideal, 0) > 0 and not public.pode_gerir_venda() then
    if new.preco_ideal is distinct from old.preco_ideal then
      raise exception '%: só Bárbara e Valentina podem alterar o preço de venda depois do cadastro.', old.sku using errcode = '42501';
    end if;
    if new.sku is distinct from old.sku then
      raise exception '%: só Bárbara e Valentina podem trocar o SKU de um item já precificado.', old.sku using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_itens_guarda_preco on public.itens;
create trigger trg_itens_guarda_preco before update of preco_ideal, sku on public.itens
  for each row execute function public.itens_guarda_preco();

-- ROLLBACK (manual): recriar sacolas_expirar com `perform liberar_reserva('sacola', r.codigo)` (20261102* omnichannel)
-- e as funções/triggers como em 20261116100000 + 20261116110000.
