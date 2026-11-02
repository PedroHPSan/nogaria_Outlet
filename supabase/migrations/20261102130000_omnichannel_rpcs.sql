-- Omnichannel (issue E0-2): RPCs atômicas de reserva e baixa de venda.
-- Depende de 20261102120000_omnichannel_base.sql.
-- ⚠️ NÃO aplicar em produção sem OK de Pedro OU Bárbara (via MCP apply_migration, antes do deploy).
-- Idempotente. Rollback no fim (comentado).

-- Reservas já existentes (gravadas direto em itens pelo código antigo) viram linhas ATIVAS.
insert into public.reservas (sku, canal, origem_tipo, origem_ref, expira_em, criado_por)
select i.sku,
       case when o.origem = 'whatsapp' then 'whatsapp' else 'direto' end,
       'sacola', i.reservado_por_orc, i.reservado_ate, 'backfill'
  from public.itens i
  left join public.orcamentos o on o.codigo = i.reservado_por_orc
 where i.reservado_ate > now() and i.reservado_por_orc is not null
   and i.status not in ('VENDIDO','ENTREGUE','DESCARTE')
   and not exists (select 1 from public.reservas r where r.sku = i.sku and r.status = 'ATIVA');

-- Reservas vencidas deixam de bloquear: marca EXPIRADA (o trigger limpa a projeção em itens).
create or replace function public.reservas_expirar(p_sku text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update reservas set status = 'EXPIRADA'
   where status = 'ATIVA' and expira_em is not null and expira_em <= now()
     and (p_sku is null or sku = p_sku);
  get diagnostics n = row_count;
  return n;
end $$;

-- Reserva 1 SKU. Mesma origem renova o prazo; origem diferente com reserva ativa → erro legível.
create or replace function public.reservar_item(
  p_sku text, p_canal text, p_origem_tipo text, p_origem_ref text,
  p_expira_em timestamptz default null, p_user text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text; v_r reservas%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('item:' || p_sku));
  select status into v_status from itens where sku = p_sku;
  if not found then raise exception '%: item não encontrado.', p_sku using errcode = 'P0002'; end if;
  if v_status in ('VENDIDO','ENTREGUE','DESCARTE') then
    raise exception '%: fora de estoque.', p_sku using errcode = 'P0001';
  end if;
  perform reservas_expirar(p_sku);
  select * into v_r from reservas where sku = p_sku and status = 'ATIVA';
  if found then
    if v_r.origem_tipo = p_origem_tipo and v_r.origem_ref is not distinct from p_origem_ref then
      update reservas set expira_em = p_expira_em where id = v_r.id;
      return jsonb_build_object('sku', p_sku, 'reserva_id', v_r.id, 'renovada', true);
    end if;
    raise exception '%: já separado em % (%).', p_sku, coalesce(v_r.origem_ref, v_r.origem_tipo), v_r.canal
      using errcode = 'P0001';
  end if;
  insert into reservas (sku, canal, origem_tipo, origem_ref, expira_em, criado_por)
    values (p_sku, p_canal, p_origem_tipo, p_origem_ref, p_expira_em, p_user) returning * into v_r;
  insert into eventos (sku, acao, usuario) values (p_sku, 'reserva:' || p_canal, p_user);
  return jsonb_build_object('sku', p_sku, 'reserva_id', v_r.id, 'renovada', false);
end $$;

-- Várias de uma vez: tudo ou nada (a exceção desfaz a transação inteira).
create or replace function public.reservar_itens(
  p_skus text[], p_canal text, p_origem_tipo text, p_origem_ref text,
  p_expira_em timestamptz default null, p_user text default null
) returns integer language plpgsql security definer set search_path = public as $$
declare s text; n integer := 0;
begin
  foreach s in array (select array_agg(x order by x) from unnest(p_skus) x) loop  -- ordem fixa evita deadlock
    perform reservar_item(s, p_canal, p_origem_tipo, p_origem_ref, p_expira_em, p_user);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Libera reservas ATIVAS de uma origem (p_sku nulo = todas as dessa origem).
create or replace function public.liberar_reserva(p_origem_tipo text, p_origem_ref text, p_sku text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update reservas set status = 'LIBERADA'
   where status = 'ATIVA' and origem_tipo = p_origem_tipo and origem_ref is not distinct from p_origem_ref
     and (p_sku is null or sku = p_sku);
  get diagnostics n = row_count;
  if p_origem_tipo = 'sacola' then  -- resíduo legado gravado direto em itens
    update itens set reservado_ate = null, reservado_por_orc = null
     where reservado_por_orc = p_origem_ref and (p_sku is null or sku = p_sku);
  end if;
  return n;
end $$;

-- Única porta para VENDIDO. Recusa item já vendido ou com reserva ATIVA de outra origem.
create or replace function public.baixar_venda(
  p_sku text, p_valor numeric, p_canal_venda text, p_pedido_ref text default null,
  p_comprador text default null, p_taxa numeric default null, p_frete numeric default null,
  p_user text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_r reservas%rowtype; v_canal text;
begin
  perform pg_advisory_xact_lock(hashtext('item:' || p_sku));
  select status into v_status from itens where sku = p_sku;
  if not found then raise exception '%: item não encontrado.', p_sku using errcode = 'P0002'; end if;
  if v_status in ('VENDIDO','ENTREGUE','DESCARTE') then
    raise exception '%: já vendido/fora de estoque.', p_sku using errcode = 'P0001';
  end if;
  perform reservas_expirar(p_sku);
  select * into v_r from reservas where sku = p_sku and status = 'ATIVA';
  if found and v_r.origem_ref is distinct from nullif(trim(p_pedido_ref), '') then
    raise exception '%: reservado por % (%).', p_sku, coalesce(v_r.origem_ref, v_r.origem_tipo), v_r.canal
      using errcode = 'P0001';
  end if;
  select codigo into v_canal from canais
   where lower(nome) = lower(coalesce(p_canal_venda, ''))
      or (p_canal_venda ilike '%whatsapp%' and codigo = 'whatsapp') limit 1;
  update reservas set status = 'CONFIRMADA' where sku = p_sku and status = 'ATIVA';
  update itens set valor_vendido = p_valor, canal_venda = nullif(p_canal_venda, ''), canal_codigo = v_canal,
         taxa_venda = p_taxa, frete_pago = p_frete, comprador = nullif(trim(p_comprador), ''),
         pedido_ref = nullif(trim(p_pedido_ref), ''), status = 'VENDIDO', vendido_em = now(), upd_by = p_user
   where sku = p_sku;
  insert into eventos (sku, acao, usuario) values (p_sku, 'status:VENDIDO', p_user);
end $$;

-- Lote (sacola/orçamento): tudo ou nada. p_itens = [{"sku": "...", "valor": 12.3}, ...]
create or replace function public.baixar_vendas(
  p_itens jsonb, p_canal_venda text, p_pedido_ref text, p_comprador text default null, p_user text default null
) returns integer language plpgsql security definer set search_path = public as $$
declare e jsonb; n integer := 0;
begin
  for e in select value from jsonb_array_elements(p_itens) order by value->>'sku' loop
    perform baixar_venda(e->>'sku', (e->>'valor')::numeric, p_canal_venda, p_pedido_ref, p_comprador, null, null, p_user);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.reservas_expirar(text) from public, anon;
revoke all on function public.reservar_item(text, text, text, text, timestamptz, text) from public, anon;
revoke all on function public.reservar_itens(text[], text, text, text, timestamptz, text) from public, anon;
revoke all on function public.liberar_reserva(text, text, text) from public, anon;
revoke all on function public.baixar_venda(text, numeric, text, text, text, numeric, numeric, text) from public, anon;
revoke all on function public.baixar_vendas(jsonb, text, text, text, text) from public, anon;
grant execute on function public.reservas_expirar(text) to authenticated, service_role;
grant execute on function public.reservar_item(text, text, text, text, timestamptz, text) to authenticated, service_role;
grant execute on function public.reservar_itens(text[], text, text, text, timestamptz, text) to authenticated, service_role;
grant execute on function public.liberar_reserva(text, text, text) to authenticated, service_role;
grant execute on function public.baixar_venda(text, numeric, text, text, text, numeric, numeric, text) to authenticated, service_role;
grant execute on function public.baixar_vendas(jsonb, text, text, text, text) to authenticated, service_role;

-- ROLLBACK (manual):
-- drop function if exists public.baixar_vendas(jsonb, text, text, text, text);
-- drop function if exists public.baixar_venda(text, numeric, text, text, text, numeric, numeric, text);
-- drop function if exists public.liberar_reserva(text, text, text);
-- drop function if exists public.reservar_itens(text[], text, text, text, timestamptz, text);
-- drop function if exists public.reservar_item(text, text, text, text, timestamptz, text);
-- drop function if exists public.reservas_expirar(text);
