-- Campanhas (F5): sacola do WhatsApp com preço promocional + decisão no pagamento + registro de vendas da campanha.
-- Depende de 20261107150000 (F1). ⚠️ NÃO aplicar em produção sem OK de Pedro OU Bárbara (via MCP apply_migration).
-- Idempotente e só aditiva (tabela nova, função nova, trigger novo). Rollback no fim (comentado).
--
-- O item da sacola guarda no snapshot (orcamentos.itens[]): preco (o que será cobrado), preco_cheio ("de" congelado),
-- preco_promo, campanha_id/nome/fim, entrou_em e, depois da decisão, campanha_decisao.
-- Pagar depois do fim da campanha: sacola_preparar_pagamento recusa com DECISAO_CAMPANHA até a equipe escolher manter a
-- promoção ou cobrar o preço cheio atual (Q1: sempre perguntar). Quem decide se a campanha venceu é o now() do banco.

create table if not exists public.campanha_vendas (       -- registro só de inserção, gravado por trigger
  id            bigint generated always as identity primary key,
  campanha_id   uuid not null references public.campanhas(id),
  sku           text not null references public.itens(sku),
  origem_ref    text not null,                              -- código da sacola
  canal         text,
  preco_cheio   numeric(12,2),
  preco_promo   numeric(12,2) not null,                     -- preço com que o item entrou na sacola
  valor_vendido numeric(12,2),                              -- itens.valor_vendido depois da baixa
  entrou_em     timestamptz,
  fechado_em    timestamptz not null default now(),
  decisao       text not null check (decisao in ('no_prazo','manteve_promo','preco_cheio','sem_decisao')),
  decidido_por  text,
  unique (campanha_id, sku)
);
create index if not exists idx_campanha_vendas_campanha on public.campanha_vendas (campanha_id);
alter table public.campanha_vendas enable row level security;
drop policy if exists campanha_vendas_ler on public.campanha_vendas;
create policy campanha_vendas_ler on public.campanha_vendas for select to authenticated using (true);
revoke all on public.campanha_vendas from anon;
revoke insert, update, delete on public.campanha_vendas from authenticated;

-- Pagamento: resolve os itens cuja campanha já terminou (ou foi encerrada/cancelada) e fecha o total.
create or replace function public.sacola_preparar_pagamento(p_id uuid, p_manter_promo boolean default null, p_user text default null)
returns public.orcamentos language plpgsql security definer set search_path = public as $$
declare
  o orcamentos%rowtype; x jsonb; k campanhas; v_atual numeric; v_sub numeric; v_pct numeric;
  v_novos jsonb := '[]'::jsonb; v_pend jsonb := '[]'::jsonb;
begin
  select * into o from orcamentos where id = p_id for update;
  if not found then raise exception 'Sacola não encontrada.' using errcode = 'P0002'; end if;
  if o.status in ('VENDIDO', 'ENTREGUE', 'CANCELADO') then
    raise exception 'Sacola % já está %.', o.codigo, o.status using errcode = 'P0001';
  end if;
  for x in select e from jsonb_array_elements(o.itens) e loop
    if x->>'campanha_id' is null or x ? 'campanha_decisao' then v_novos := v_novos || x; continue; end if;
    select * into k from campanhas where id = (x->>'campanha_id')::uuid;
    if found and k.status = 'PUBLICADA' and k.fim_em > now() then
      v_novos := v_novos || (x || jsonb_build_object('campanha_decisao', 'no_prazo'));
    else
      select i.preco_ideal into v_atual from itens i where i.sku = x->>'sku';
      v_atual := case when coalesce(v_atual, 0) > 0 then v_atual else (x->>'preco_cheio')::numeric end;
      if p_manter_promo is null then
        v_pend := v_pend || jsonb_build_object('sku', x->>'sku', 'produto', x->>'produto',
                   'preco_promo', coalesce((x->>'preco_promo')::numeric, (x->>'preco')::numeric), 'preco_cheio_atual', v_atual,
                   'campanha', x->>'campanha_nome', 'campanha_fim', coalesce(k.fim_em::text, x->>'campanha_fim'));
      elsif p_manter_promo then
        v_novos := v_novos || (x || jsonb_build_object('campanha_decisao', 'manteve_promo', 'decidido_por', p_user));
      else
        v_novos := v_novos || (x || jsonb_build_object('preco', v_atual, 'campanha_decisao', 'preco_cheio', 'decidido_por', p_user));
      end if;
    end if;
  end loop;
  if jsonb_array_length(v_pend) > 0 then
    raise exception 'DECISAO_CAMPANHA' using errcode = 'P0001', detail = v_pend::text;
  end if;
  select coalesce(sum((e->>'preco')::numeric) filter (where (e->>'preco')::numeric > 0), 0) into v_sub from jsonb_array_elements(v_novos) e;
  v_pct := least(90, greatest(0, coalesce(o.desconto_pct, 0)));
  update orcamentos set itens = v_novos, total = round(v_sub, 2) - round(v_sub * v_pct / 100, 2), atualizado_em = now()
   where id = p_id returning * into o;
  return o;
end $$;
revoke all on function public.sacola_preparar_pagamento(uuid, boolean, text) from public, anon;
grant execute on function public.sacola_preparar_pagamento(uuid, boolean, text) to authenticated, service_role;

-- Ledger: quando a sacola vira VENDIDO, cada item de campanha entra em campanha_vendas. Nunca bloqueia a venda.
create or replace function public.campanha_vendas_registrar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'VENDIDO' and old.status is distinct from 'VENDIDO' then
    begin
      insert into campanha_vendas (campanha_id, sku, origem_ref, canal, preco_cheio, preco_promo, valor_vendido, entrou_em, decisao, decidido_por)
      select (x->>'campanha_id')::uuid, x->>'sku', new.codigo, 'whatsapp', (x->>'preco_cheio')::numeric,
             coalesce((x->>'preco_promo')::numeric, (x->>'preco')::numeric), i.valor_vendido, (x->>'entrou_em')::timestamptz,
             coalesce(x->>'campanha_decisao', case when k.fim_em > now() and k.status = 'PUBLICADA' then 'no_prazo' else 'sem_decisao' end),
             x->>'decidido_por'
        from jsonb_array_elements(new.itens) x
        join itens i on i.sku = x->>'sku'
        join campanhas k on k.id = (x->>'campanha_id')::uuid
       where x->>'campanha_id' is not null
      on conflict (campanha_id, sku) do nothing;
    exception when others then
      raise warning 'campanha_vendas_registrar: % (sacola %)', sqlerrm, new.codigo;
    end;
  end if;
  return new;
end $$;
drop trigger if exists trg_campanha_vendas on public.orcamentos;
create trigger trg_campanha_vendas after update of status on public.orcamentos
  for each row execute function public.campanha_vendas_registrar();

-- Rollback (manual): drop trigger if exists trg_campanha_vendas on public.orcamentos;
--   drop function if exists public.campanha_vendas_registrar(), public.sacola_preparar_pagamento(uuid, boolean, text);
--   drop table if exists public.campanha_vendas;
