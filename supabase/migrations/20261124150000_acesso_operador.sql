-- Regras de acesso, parte 1 (gestor × operador). Gestores = tabela gestores_venda (Pedro, Bárbara, Valentina); o resto é operador.
-- 1) anon (sem login) só enxerga o catálogo público; o resto da API fica fechado pelas permissões, não só pela RLS.
-- 2) reservas: ninguém escreve direto pela API (todo o app usa RPCs SECURITY DEFINER) — fecha ATIVA→CONFIRMADA forjado etc.
-- 3) orcamentos: o banco passa a validar os DADOS, em vez de confiar no que o cliente manda:
--    · total é sempre recalculado dos itens (ninguém grava total diferente);
--    · operador não dá desconto, não grava preço de item abaixo do piso (preço de tabela menos a maior promoção já feita,
--      com folga de R$ 1 de arredondamento) e só faz as transições legítimas de sacola do WhatsApp;
--    · operador só cria sacola ABERTA.
-- ⚠️ Aprovação de schema (Pedro OU Bárbara) antes de aplicar em produção. Idempotente. Rollback no fim (comentado).

-- 1) anon -----------------------------------------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select on public.catalogos_publicos to anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;       -- falha aborta a migration
alter default privileges for role postgres in schema public revoke all on sequences from anon;
do $$ begin
  alter default privileges for role supabase_admin in schema public revoke all on tables from anon;
  alter default privileges for role supabase_admin in schema public revoke all on sequences from anon;
exception when insufficient_privilege then raise notice 'default privileges de supabase_admin não ajustados (sem permissão).'; end $$;

-- 2) reservas só por RPC ---------------------------------------------------------------------------------------------
revoke insert, update, delete on public.reservas from authenticated;

-- 3) validação de dados em orcamentos --------------------------------------------------------------------------------
create or replace function public.orc_total_itens(p_itens jsonb, p_pct numeric) returns numeric
language sql immutable as $$
  select round(x.s, 2) - round(x.s * least(90, greatest(0, coalesce(p_pct, 0))) / 100, 2)
    from (select coalesce(sum(v) filter (where v > 0), 0) as s
            from (select case when jsonb_typeof(e->'preco') = 'number' then (e->>'preco')::numeric end as v
                    from jsonb_array_elements(case when jsonb_typeof(p_itens) = 'array' then p_itens else '[]'::jsonb end) e) y) x
$$;

create or replace function public.orc_total_efetivo(o public.orcamentos) returns numeric
language sql stable set search_path = public as $$
  select greatest(round(coalesce(o.total, 0), 2), public.orc_total_itens(o.itens, o.desconto_pct))
$$;

-- Piso do preço de um item numa sacola: preço de tabela (ou o menor "cheio" de campanha) menos a maior promoção já feita.
create or replace function public.orc_piso_item(p_sku text) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare v_base numeric; v_cheio numeric; v_desc numeric := 0;
begin
  select preco_ideal into v_base from itens where sku = p_sku;
  if coalesce(v_base, 0) <= 0 then return null; end if;   -- item inexistente ou sem preço: sem piso (o guarda recusa para operador)
  begin
    select c.preco_cheio, coalesce(c.desconto_pct, 0) into v_cheio, v_desc
      from campanha_itens c join campanhas k on k.id = c.campanha_id
     where c.sku = p_sku and c.canal in ('whatsapp', '*') and k.status in ('PUBLICADA', 'ENCERRADA')
       and k.inicio_em <= now() and k.fim_em > now() - interval '2 hours'   -- janela da campanha + a reserva do bot (2 h)
     order by (k.fim_em > now()) desc, (c.canal = 'whatsapp') desc, k.inicio_em desc limit 1;   -- ativa primeiro, depois a escolha de precos_efetivos
  exception when undefined_table then v_cheio := null; v_desc := 0; end;
  return round(least(v_base, coalesce(v_cheio, v_base)) * (1 - least(coalesce(v_desc, 0), 90) / 100) - 1, 2);   -- R$ 1 de folga de arredondamento
end $$;
revoke all on function public.orc_piso_item(text) from public, anon;
grant execute on function public.orc_piso_item(text) to authenticated, service_role;

create or replace function public.orcamentos_guarda_dados() returns trigger
language plpgsql security definer set search_path = public as $$
declare e jsonb; v_piso numeric; v_antigos jsonb;
begin
  new.total := public.orc_total_itens(new.itens, new.desconto_pct);   -- total derivado dos itens, para todos
  if public.pode_gerir_venda() then return new; end if;

  if tg_op = 'INSERT' then
    new.criado_por := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', '');
    new.criado_em := now();
    if new.origem = 'whatsapp' and new.status <> 'ABERTA' then
      raise exception 'Sacola nova só pode nascer ABERTA.' using errcode = '42501';
    end if;
    if coalesce(new.desconto_pct, 0) <> 0 then
      raise exception 'Só Bárbara, Valentina e Pedro dão desconto.' using errcode = '42501';
    end if;
  else
    if new.criado_por is distinct from old.criado_por or new.criado_em is distinct from old.criado_em then
      raise exception '%: autor e data de criação não mudam.', old.codigo using errcode = '42501';
    end if;
    if new.codigo is distinct from old.codigo then
      raise exception '%: só Bárbara, Valentina e Pedro mudam o código.', old.codigo using errcode = '42501';
    end if;
    if new.origem is distinct from old.origem then
      raise exception '%: só Bárbara, Valentina e Pedro mudam a origem.', old.codigo using errcode = '42501';
    end if;
    if coalesce(new.desconto_pct, 0) <> coalesce(old.desconto_pct, 0) then
      raise exception '%: só Bárbara, Valentina e Pedro mudam o desconto.', old.codigo using errcode = '42501';
    end if;
    if old.origem = 'whatsapp' and new.status is distinct from old.status
       and (old.status, new.status) not in (('ABERTA','VENDIDO'), ('ABERTA','ENTREGUE'), ('VENDIDO','ENTREGUE'), ('EXPIRADO','ABERTA')) then
      raise exception '%: mudança de % para % não é permitida.', old.codigo, old.status, new.status using errcode = '42501';
    end if;
  end if;

  if new.origem = 'whatsapp' then
    if jsonb_typeof(new.itens) is distinct from 'array' then
      raise exception 'Itens da sacola inválidos.' using errcode = '42501';
    end if;
    v_antigos := case when tg_op = 'UPDATE' and old.origem = 'whatsapp' and jsonb_typeof(old.itens) = 'array' then old.itens else '[]'::jsonb end;
    -- item que sai do JSON enquanto a reserva dele na sacola segue ativa: só tirando a reserva antes (gestor)
    if tg_op = 'UPDATE' then
      for e in select value from jsonb_array_elements(v_antigos) loop
        if not exists (select 1 from jsonb_array_elements(new.itens) x where x->>'sku' = e->>'sku')
           and (exists (select 1 from reservas r where r.status in ('ATIVA', 'CONFIRMADA') and r.origem_tipo = 'sacola' and r.origem_ref = old.codigo and r.sku = e->>'sku')
                or exists (select 1 from itens it where it.sku = e->>'sku' and it.pedido_ref = old.codigo and it.status::text in ('VENDIDO', 'ENTREGUE'))) then
          raise exception '%: o item % está reservado ou já vendido nesta sacola; só Bárbara, Valentina e Pedro tiram item.', old.codigo, e->>'sku' using errcode = '42501';
        end if;
      end loop;
    end if;
    for e in select value from jsonb_array_elements(new.itens) loop
      if jsonb_typeof(e->'preco') is distinct from 'number' then
        raise exception '%: preço inválido.', e->>'sku' using errcode = '42501';
      end if;
      continue when exists (select 1 from jsonb_array_elements(v_antigos) x where x->>'sku' = e->>'sku' and (x->'preco') is not distinct from (e->'preco'));
      v_piso := public.orc_piso_item(e->>'sku');
      if v_piso is null then
        raise exception '%: item inexistente ou sem preço de venda; defina o preço antes de separar.', e->>'sku' using errcode = '42501';
      end if;
      if coalesce((e->>'preco')::numeric, 0) * (1 - least(90, greatest(0, coalesce(new.desconto_pct, 0))) / 100) < v_piso then   -- preço já com o desconto da sacola
        raise exception '%: preço R$ % abaixo do mínimo permitido (R$ %). Só Bárbara, Valentina e Pedro mudam preço.',
          e->>'sku', coalesce(e->>'preco', '0'), to_char(v_piso, 'FM999G990D00') using errcode = '42501';
      end if;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_orcamentos_guarda_dados on public.orcamentos;
create trigger trg_orcamentos_guarda_dados before insert or update on public.orcamentos
  for each row execute function public.orcamentos_guarda_dados();

-- Venda de item sob o código de uma sacola ABERTA: o SKU precisa estar listado nela (e a sacola paga/liberada).
create or replace function public.itens_guarda_venda_saldo() returns trigger
language plpgsql security definer set search_path = public as $$
declare o orcamentos%rowtype; v_saldo numeric; v_minimo numeric;
begin
  if new.status = 'VENDIDO' and old.status is distinct from 'VENDIDO' and nullif(new.pedido_ref, '') is not null
     and not public.pode_gerir_venda() then
    select * into o from orcamentos where codigo = new.pedido_ref and origem = 'whatsapp';
    if found then
      if o.status <> 'ABERTA' then
        raise exception '%: a sacola % está % e não aceita venda de item.', new.sku, new.pedido_ref, o.status using errcode = '42501';
      end if;
      if not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(o.itens) = 'array' then o.itens else '[]'::jsonb end) x where x->>'sku' = new.sku) then
        raise exception '%: o item não está listado na sacola %.', new.sku, new.pedido_ref using errcode = '42501';
      end if;
      v_saldo := public.orc_saldo(o.id);
      if v_saldo > 0.004 then
        raise exception '%: a sacola % ainda tem R$ % a receber. Só Bárbara, Valentina e Pedro liberam a venda com saldo em aberto.',
          new.sku, new.pedido_ref, to_char(v_saldo, 'FM999G990D00') using errcode = '42501';
      end if;
      -- o valor da venda do item acompanha o preço dele na sacola (com o desconto dela; R$ 0,10 de folga de centavos)
      select (x->>'preco')::numeric * (1 - least(90, greatest(0, coalesce(o.desconto_pct, 0))) / 100) - 0.10 into v_minimo
        from jsonb_array_elements(case when jsonb_typeof(o.itens) = 'array' then o.itens else '[]'::jsonb end) x where x->>'sku' = new.sku limit 1;
      if new.valor_vendido is null or v_minimo is null or new.valor_vendido = 'NaN'::numeric or new.valor_vendido < v_minimo then   -- fecha fechado (sem piso, nulo ou NaN = recusa)
        raise exception '%: o valor da venda (R$ %) é menor que o preço do item na sacola %.', new.sku, coalesce(new.valor_vendido, 0), new.pedido_ref using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;

-- Valores de venda finitos (sem NaN, +Infinity nem -Infinity). Não exige >= 0: há vendas antigas com valor negativo.
-- NOT VALID: vale para gravações novas sem varrer a tabela inteira.
alter table public.itens drop constraint if exists itens_valor_vendido_finito;
alter table public.itens add constraint itens_valor_vendido_finito
  check (valor_vendido is null or (valor_vendido > '-Infinity'::numeric and valor_vendido < 'Infinity'::numeric)) not valid;
alter table public.itens drop constraint if exists itens_taxa_frete_finitos;
alter table public.itens add constraint itens_taxa_frete_finitos
  check ((taxa_venda is null or (taxa_venda > '-Infinity'::numeric and taxa_venda < 'Infinity'::numeric))
     and (frete_pago is null or (frete_pago > '-Infinity'::numeric and frete_pago < 'Infinity'::numeric))) not valid;

-- Valor de venda de item vendido sob uma sacola: operador não edita na mão (a venda gravou o valor pelo baixar_venda).
-- Sair do estado vendido (reabrir_estoque) e vendas sem sacola seguem como antes.
create or replace function public.itens_guarda_valor_vendido() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.valor_vendido is distinct from old.valor_vendido
     and old.status::text in ('VENDIDO', 'ENTREGUE') and new.status::text in ('VENDIDO', 'ENTREGUE')
     and not public.pode_gerir_venda()
     and exists (select 1 from orcamentos o where o.codigo in (nullif(trim(old.pedido_ref), ''), nullif(trim(new.pedido_ref), ''))) then
    raise exception '%: o valor desta venda veio de uma sacola; só Bárbara, Valentina e Pedro corrigem.', old.sku using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_itens_guarda_valor_vendido on public.itens;
create trigger trg_itens_guarda_valor_vendido before update of valor_vendido on public.itens
  for each row execute function public.itens_guarda_valor_vendido();

-- Campanhas definem o piso de preço: criar/publicar/encerrar/mudar desconto só gestor (as RPCs de campanha são SECURITY
-- DEFINER mas o papel vem do JWT). O gatilho de preço do item só atualiza preco_cheio, que segue livre.
create or replace function public.campanhas_so_gestor() returns trigger
language plpgsql as $$
begin
  if public.pode_gerir_venda() then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_table_name = 'campanha_itens' and tg_op = 'UPDATE' then
    if (new.campanha_id, new.sku, new.canal, new.desconto_pct, new.regra_tipo) is not distinct from (old.campanha_id, old.sku, old.canal, old.desconto_pct, old.regra_tipo) then
      return new;   -- só preco_cheio mudou (cascata do preço do item)
    end if;
  end if;
  raise exception 'Campanhas: só Bárbara, Valentina e Pedro criam, publicam, encerram ou mudam descontos.' using errcode = '42501';
end $$;
drop trigger if exists trg_campanhas_so_gestor on public.campanhas;
create trigger trg_campanhas_so_gestor before insert or update or delete on public.campanhas
  for each row execute function public.campanhas_so_gestor();
drop trigger if exists trg_campanha_itens_so_gestor on public.campanha_itens;
create trigger trg_campanha_itens_so_gestor before insert or update or delete on public.campanha_itens
  for each row execute function public.campanhas_so_gestor();
drop trigger if exists trg_campanha_regras_so_gestor on public.campanha_regras;
create trigger trg_campanha_regras_so_gestor before insert or update or delete on public.campanha_regras
  for each row execute function public.campanhas_so_gestor();

-- Excluir sacola/orçamento: operador só desfaz a própria sacola ABERTA criada há < 5 min, sem reserva, venda nem pagamento
-- (é o undo do "separar" quando a reserva falha); qualquer outra exclusão é de gestor.
create or replace function public.orcamentos_guarda_exclusao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.pode_gerir_venda() then return old; end if;
  if (old.status = 'ABERTA'
      and old.criado_por = nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', '')
      and old.criado_em > now() - interval '5 minutes'
      and not exists (select 1 from reservas r where r.origem_ref = old.codigo)
      and not exists (select 1 from itens i where i.pedido_ref = old.codigo)
      and not exists (select 1 from orcamento_pagamentos p where p.orcamento_id = old.id)) is not true then
    raise exception '%: operador só desfaz a própria sacola recém-criada e vazia; para excluir outra, peça a Bárbara, Valentina ou Pedro.', old.codigo using errcode = '42501';
  end if;
  return old;
end $$;
drop trigger if exists trg_orcamentos_guarda_exclusao on public.orcamentos;
create trigger trg_orcamentos_guarda_exclusao before delete on public.orcamentos
  for each row execute function public.orcamentos_guarda_exclusao();

-- Item já vendido sob uma sacola: operador não troca o pedido_ref (é o elo com a sacola).
create or replace function public.itens_guarda_pedido_ref() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.pedido_ref is distinct from old.pedido_ref and old.status::text in ('VENDIDO', 'ENTREGUE')
     and not public.pode_gerir_venda()
     and exists (select 1 from orcamentos o where o.codigo in (nullif(trim(old.pedido_ref), ''), nullif(trim(new.pedido_ref), ''))) then
    raise exception '%: a referência % / % envolve uma sacola; só Bárbara, Valentina e Pedro trocam a referência de um item vendido.', old.sku, coalesce(old.pedido_ref, '(vazio)'), coalesce(new.pedido_ref, '(vazio)') using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_itens_guarda_pedido_ref on public.itens;
create trigger trg_itens_guarda_pedido_ref before update of pedido_ref on public.itens
  for each row execute function public.itens_guarda_pedido_ref();

-- ROLLBACK (manual):
--   drop trigger if exists trg_orcamentos_guarda_dados on public.orcamentos; drop function if exists public.orcamentos_guarda_dados();
--   alter table public.itens drop constraint if exists itens_valor_vendido_finito, drop constraint if exists itens_taxa_frete_finitos;
--   drop trigger if exists trg_itens_guarda_valor_vendido on public.itens; drop function if exists public.itens_guarda_valor_vendido();
--   drop function if exists public.orc_piso_item(text);
--   drop trigger if exists trg_orcamentos_guarda_exclusao on public.orcamentos; drop function if exists public.orcamentos_guarda_exclusao();
--   drop trigger if exists trg_itens_guarda_pedido_ref on public.itens; drop function if exists public.itens_guarda_pedido_ref();
--   drop trigger if exists trg_campanhas_so_gestor on public.campanhas; drop trigger if exists trg_campanha_itens_so_gestor on public.campanha_itens; drop trigger if exists trg_campanha_regras_so_gestor on public.campanha_regras; drop function if exists public.campanhas_so_gestor();
--   grant insert, update, delete on public.reservas to authenticated;
--   (anon: grant select, insert, update, delete on <tabela> to anon — só se algo público realmente precisar)
