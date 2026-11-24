-- Reforço da trava de pagamentos (revisão de segurança do commit 69d7c1c / PR #192). Fecha:
-- 1) baixa dos itens por fora da sacola: baixar_venda/baixar_vendas (RPC) com saldo em aberto, e ABERTA → ENTREGUE direto;
-- 2) `total` adulterado para zerar o saldo: o saldo usa o MAIOR entre o total gravado e a soma dos itens da sacola;
-- 3) auditoria (valor_pago, pago_em, forma_pagamento, liberada_com_saldo_*) só muda pelo caminho interno ou por gestor;
-- 4) autor de pagamento/estorno vem do JWT (p_user só vale sem JWT de usuário: service_role/cron/migration);
-- 5) sacola ABERTA com pagamento ativo nunca ganha prazo (reservas.expira_em nulo, validade longa), por qualquer caminho
--    (renovar_sacola, reservar_itens, update direto);
-- 6) backfill idempotente também para sacola que já tenha pagamento.
-- ⚠️ Aprovação de schema (Pedro OU Bárbara) antes de aplicar em produção. Idempotente.

-- Total efetivo: o maior entre o total gravado e o recalculado dos itens (como sacola_preparar_pagamento).
create or replace function public.orc_total_efetivo(o public.orcamentos) returns numeric
language sql stable set search_path = public as $$
  select greatest(round(coalesce(o.total, 0), 2),
    (select round(x.s, 2) - round(x.s * least(90, greatest(0, coalesce(o.desconto_pct, 0))) / 100, 2)
       from (select coalesce(sum((e->>'preco')::numeric) filter (where (e->>'preco')::numeric > 0), 0) as s
               from jsonb_array_elements(case when jsonb_typeof(o.itens) = 'array' then o.itens else '[]'::jsonb end) e) x))
$$;

create or replace function public.orc_saldo(p_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select public.orc_total_efetivo(o) - coalesce((select sum(p.valor) from orcamento_pagamentos p where p.orcamento_id = o.id and p.estornado_em is null), 0)
    from orcamentos o where o.id = p_id
$$;
revoke all on function public.orc_saldo(uuid) from public, anon;
grant execute on function public.orc_saldo(uuid) to authenticated, service_role;

-- (1)+(2) orcamentos: nenhum status "vendido" sai de uma sacola do WhatsApp com saldo sem gestor.
create or replace function public.orcamentos_guarda_saldo() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pago numeric; v_saldo numeric; v_tot numeric;
begin
  if old.origem = 'whatsapp' and new.origem is distinct from old.origem and not public.pode_gerir_venda() then
    raise exception '%: só Bárbara, Valentina e Pedro mudam a origem da sacola.', old.codigo using errcode = '42501';
  end if;
  if old.origem = 'whatsapp' and new.status in ('VENDIDO', 'ENTREGUE') and old.status not in ('VENDIDO', 'ENTREGUE') then
    select coalesce(sum(valor), 0) into v_pago from orcamento_pagamentos where orcamento_id = new.id and estornado_em is null;
    v_tot := greatest(public.orc_total_efetivo(old), public.orc_total_efetivo(new));
    v_saldo := v_tot - v_pago;
    if v_saldo > 0.004 then
      if not public.pode_gerir_venda() then
        raise exception '%: falta receber R$ %. Só Bárbara, Valentina e Pedro liberam a venda com saldo em aberto.',
          new.codigo, to_char(v_saldo, 'FM999G990D00') using errcode = '42501';
      end if;
      new.liberada_com_saldo_por := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', 'service_role');
      new.liberada_com_saldo_em := now();
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_orcamentos_guarda_saldo on public.orcamentos;
create trigger trg_orcamentos_guarda_saldo before update of status, origem on public.orcamentos
  for each row execute function public.orcamentos_guarda_saldo();

-- (1) itens: vender um item cujo pedido_ref é uma sacola do WhatsApp ABERTA com saldo exige gestor (fecha o atalho
-- baixar_venda/baixar_vendas chamado direto pela API, sem passar pelo status da sacola).
create or replace function public.itens_guarda_venda_saldo() returns trigger
language plpgsql security definer set search_path = public as $$
declare o_id uuid; v_saldo numeric;
begin
  if new.status = 'VENDIDO' and old.status is distinct from 'VENDIDO' and nullif(new.pedido_ref, '') is not null
     and not public.pode_gerir_venda() then
    select id into o_id from orcamentos where codigo = new.pedido_ref and origem = 'whatsapp' and status = 'ABERTA';
    if found then
      v_saldo := public.orc_saldo(o_id);
      if v_saldo > 0.004 then
        raise exception '%: a sacola % ainda tem R$ % a receber. Só Bárbara, Valentina e Pedro liberam a venda com saldo em aberto.',
          new.sku, new.pedido_ref, to_char(v_saldo, 'FM999G990D00') using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_itens_guarda_venda_saldo on public.itens;
create trigger trg_itens_guarda_venda_saldo before update of status on public.itens
  for each row execute function public.itens_guarda_venda_saldo();

-- (3) auditoria: colunas de resumo do pagamento só mudam pelo caminho interno (trigger de sincronização) ou por gestor.
create or replace function public.orcamentos_guarda_colunas_pagamento() returns trigger
language plpgsql as $$
begin
  if public.pode_gerir_venda() or current_setting('app.pagamento_interno', true) = '1' then return new; end if;
  if tg_op = 'INSERT' then
    if new.valor_pago is not null or new.pago_em is not null or new.forma_pagamento is not null
       or new.liberada_com_saldo_por is not null or new.liberada_com_saldo_em is not null then
      raise exception 'Pagamento só se registra pela tela de sacolas (pagamento_registrar).' using errcode = '42501';
    end if;
  elsif (new.valor_pago, new.pago_em, new.forma_pagamento, new.liberada_com_saldo_por, new.liberada_com_saldo_em)
        is distinct from (old.valor_pago, old.pago_em, old.forma_pagamento, old.liberada_com_saldo_por, old.liberada_com_saldo_em) then
    raise exception '%: pagamento só se registra pela tela de sacolas (pagamento_registrar).', old.codigo using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_orcamentos_guarda_colunas_pagamento on public.orcamentos;
create trigger trg_orcamentos_guarda_colunas_pagamento before insert or update on public.orcamentos
  for each row execute function public.orcamentos_guarda_colunas_pagamento();

create or replace function public.orc_pagamentos_sincronizar() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(new.orcamento_id, old.orcamento_id); v_soma numeric; v_ult record;
begin
  select coalesce(sum(valor), 0) into v_soma from orcamento_pagamentos where orcamento_id = v_id and estornado_em is null;
  select recebido_em, forma into v_ult from orcamento_pagamentos
   where orcamento_id = v_id and estornado_em is null order by recebido_em desc, criado_em desc limit 1;
  perform set_config('app.pagamento_interno', '1', true);
  update orcamentos set valor_pago = nullif(v_soma, 0), pago_em = v_ult.recebido_em, forma_pagamento = v_ult.forma
   where id = v_id;
  perform set_config('app.pagamento_interno', '', true);
  return null;
end $$;

-- (4) autor vem do JWT; p_user só vale sem JWT de usuário.
create or replace function public.pagamento_registrar(
  p_orcamento uuid, p_valor numeric, p_forma text, p_obs text default null, p_parcelas integer default null,
  p_taxa numeric default null, p_chave text default null, p_recebido_em timestamptz default null, p_user text default null
) returns public.orcamentos language plpgsql security definer set search_path = public as $$
declare o orcamentos%rowtype; v_pago numeric; v_valor numeric := round(p_valor, 2); v_liq numeric; v_user text;
begin
  v_user := coalesce(nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''), p_user);
  select * into o from orcamentos where id = p_orcamento for update;
  if not found then raise exception 'Sacola não encontrada.' using errcode = 'P0002'; end if;
  if o.origem <> 'whatsapp' then raise exception 'Pagamento por esta tela só vale para sacolas do WhatsApp.' using errcode = 'P0001'; end if;
  if o.status not in ('ABERTA', 'VENDIDO', 'ENTREGUE') then
    raise exception 'Sacola % está % e não recebe pagamento.', o.codigo, o.status using errcode = 'P0001';
  end if;
  if p_chave is not null and exists (select 1 from orcamento_pagamentos where chave = p_chave) then return o; end if;
  if v_valor is null or v_valor <= 0 then raise exception 'Informe o valor recebido.' using errcode = 'P0001'; end if;
  select coalesce(sum(valor), 0) into v_pago from orcamento_pagamentos where orcamento_id = o.id and estornado_em is null;
  if v_valor > public.orc_total_efetivo(o) - v_pago + 0.004 then
    raise exception 'Valor maior que o saldo da sacola (falta R$ %).', to_char(public.orc_total_efetivo(o) - v_pago, 'FM999G990D00') using errcode = 'P0001';
  end if;
  v_liq := case when p_forma in ('Crédito', 'Débito') and p_taxa is not null then round(v_valor * (1 - p_taxa / 100), 2) else v_valor end;
  insert into orcamento_pagamentos (orcamento_id, valor, forma, recebido_em, observacao, parcelas_cartao, taxa_pct, valor_liquido, chave, registrado_por)
    values (o.id, v_valor, p_forma, coalesce(p_recebido_em, now()), nullif(trim(p_obs), ''),
            case when p_forma = 'Crédito' then p_parcelas end, p_taxa, v_liq, p_chave, v_user);
  if o.status = 'ABERTA' then
    update orcamentos set validade = now() + interval '10 years' where id = o.id and validade < now() + interval '5 years';
    update reservas set expira_em = null where status = 'ATIVA' and origem_tipo = 'sacola' and origem_ref = o.codigo;
  end if;
  select * into o from orcamentos where id = p_orcamento;
  return o;
end $$;

create or replace function public.pagamento_estornar(p_pagamento uuid, p_motivo text, p_user text default null)
returns public.orcamentos language plpgsql security definer set search_path = public as $$
declare p orcamento_pagamentos%rowtype; o orcamentos%rowtype; v_resta numeric; v_user text;
begin
  if not public.pode_gerir_venda() then
    raise exception 'Só Bárbara, Valentina e Pedro podem estornar um pagamento.' using errcode = '42501';
  end if;
  v_user := coalesce(nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''), p_user);
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo do estorno.' using errcode = 'P0001'; end if;
  select * into p from orcamento_pagamentos where id = p_pagamento;
  if not found then raise exception 'Pagamento não encontrado.' using errcode = 'P0002'; end if;
  select * into o from orcamentos where id = p.orcamento_id for update;
  select * into p from orcamento_pagamentos where id = p_pagamento for update;
  if p.estornado_em is not null then raise exception 'Este pagamento já foi estornado.' using errcode = 'P0001'; end if;
  update orcamento_pagamentos set estornado_em = now(), estornado_por = v_user, estorno_motivo = trim(p_motivo) where id = p.id;
  select coalesce(sum(valor), 0) into v_resta from orcamento_pagamentos where orcamento_id = o.id and estornado_em is null;
  if o.status = 'ABERTA' and v_resta = 0 then
    update orcamentos set validade = now() + interval '48 hours' where id = o.id;
    update reservas set expira_em = now() + interval '48 hours' where status = 'ATIVA' and origem_tipo = 'sacola' and origem_ref = o.codigo;
  end if;
  select * into o from orcamentos where id = o.id;
  return o;
end $$;

-- (5) sem prazo enquanto houver pagamento ativo (reservas e validade), qualquer que seja o caminho de escrita.
create or replace function public.reservas_sem_prazo_com_pagamento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'ATIVA' and new.origem_tipo = 'sacola' and new.expira_em is not null and exists (
       select 1 from orcamentos o join orcamento_pagamentos p on p.orcamento_id = o.id and p.estornado_em is null
        where o.codigo = new.origem_ref and o.origem = 'whatsapp' and o.status = 'ABERTA') then
    new.expira_em := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_reservas_0_sem_prazo on public.reservas;
create trigger trg_reservas_0_sem_prazo before insert or update on public.reservas
  for each row execute function public.reservas_sem_prazo_com_pagamento();

create or replace function public.orcamentos_sem_prazo_com_pagamento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.origem = 'whatsapp' and new.status = 'ABERTA' and new.validade < now() + interval '5 years'
     and exists (select 1 from orcamento_pagamentos p where p.orcamento_id = new.id and p.estornado_em is null) then
    new.validade := now() + interval '10 years';
  end if;
  return new;
end $$;
drop trigger if exists trg_orcamentos_0_sem_prazo on public.orcamentos;
create trigger trg_orcamentos_0_sem_prazo before update of validade, status on public.orcamentos
  for each row execute function public.orcamentos_sem_prazo_com_pagamento();

-- ROLLBACK (manual):
--   drop trigger if exists trg_orcamentos_0_sem_prazo on public.orcamentos; drop function if exists public.orcamentos_sem_prazo_com_pagamento();
--   drop trigger if exists trg_reservas_0_sem_prazo on public.reservas; drop function if exists public.reservas_sem_prazo_com_pagamento();
--   drop trigger if exists trg_orcamentos_guarda_colunas_pagamento on public.orcamentos; drop function if exists public.orcamentos_guarda_colunas_pagamento();
--   drop trigger if exists trg_itens_guarda_venda_saldo on public.itens; drop function if exists public.itens_guarda_venda_saldo();
--   drop function if exists public.orc_saldo(uuid), public.orc_total_efetivo(public.orcamentos);
--   (recriar orcamentos_guarda_saldo, orc_pagamentos_sincronizar, pagamento_registrar, pagamento_estornar de 20261124120000)
