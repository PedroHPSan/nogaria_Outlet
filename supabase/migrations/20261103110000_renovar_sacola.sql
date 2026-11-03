-- Reabrir/estender sacola de forma atômica (revisão de segurança do #135).
-- Trava a linha da sacola (o cron sacolas_expirar usa skip locked e a pula), lê os itens do banco,
-- recusa tomar reserva do bot de OUTRO cliente e só então reserva + atualiza status/validade, numa transação.
-- ⚠️ Aprovação de schema (Pedro OU Bárbara) antes de aplicar em produção. Idempotente. Rollback no fim.

create or replace function public.renovar_sacola(p_id uuid, p_dias integer, p_user text default null)
returns public.orcamentos language plpgsql security definer set search_path = public as $$
declare o orcamentos%rowtype; v_validade timestamptz; r record; v_wa text;
begin
  if p_dias not in (1, 3, 7, 15, 30) then raise exception 'Prazo inválido.' using errcode = 'P0001'; end if;
  select * into o from orcamentos where id = p_id for update;
  if not found then raise exception 'Sacola não encontrada.' using errcode = 'P0002'; end if;
  if o.status not in ('ABERTA', 'EXPIRADO') then
    raise exception 'Só sacola a pagar pode ser reaberta ou estendida.' using errcode = 'P0001';
  end if;
  v_wa := regexp_replace(coalesce(o.cliente_whatsapp, ''), '\D', '', 'g');
  -- reserva do bot só pode ser assumida se for do mesmo WhatsApp da sacola
  for r in select rs.sku, rs.criado_por from reservas rs
            where rs.status = 'ATIVA' and rs.origem_tipo in ('carrinho_wa', 'interesse')
              and rs.sku in (select x->>'sku' from jsonb_array_elements(o.itens) x) loop
    if v_wa = '' or r.criado_por is distinct from 'wa:' || v_wa then
      raise exception '%: já separado para outro cliente pelo bot.', r.sku using errcode = 'P0001';
    end if;
  end loop;
  v_validade := now() + make_interval(days => p_dias);
  perform reservar_itens(array(select x->>'sku' from jsonb_array_elements(o.itens) x),
                         'whatsapp', 'sacola', o.codigo, v_validade, p_user);
  update orcamentos set status = 'ABERTA', validade = v_validade, atualizado_em = now()
   where id = p_id returning * into o;
  return o;
end $$;
revoke all on function public.renovar_sacola(uuid, integer, text) from public, anon;
grant execute on function public.renovar_sacola(uuid, integer, text) to authenticated, service_role;

-- ROLLBACK (manual): drop function if exists public.renovar_sacola(uuid, integer, text);
