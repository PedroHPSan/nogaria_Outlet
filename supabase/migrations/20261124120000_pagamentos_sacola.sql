-- Pagamentos da sacola do WhatsApp: parcial, várias formas, crediário (parcelas com vencimento) e estorno com trilha.
-- Antes: um único `valor_pago` solto e a sacola inteira virava VENDIDO ao registrar qualquer valor (caso Cleuma, 2026-11-24).
-- Agora: cada recebimento é uma linha em orcamento_pagamentos (só inserção; correção = estorno por gestor) e o saldo é
-- total − Σ pagamentos. Sacola ABERTA com pagamento não vence (só cancelamento expresso). Itens só são baixados na
-- quitação; com saldo em aberto, só gestor (Bárbara/Valentina/Pedro) libera ("fiado"), e a trava é no banco.
-- ⚠️ Aprovação de schema (Pedro OU Bárbara) antes de aplicar em produção. Idempotente. Rollback no fim (comentado).

-- 1) Recebimentos ---------------------------------------------------------------------------------------------------
create table if not exists public.orcamento_pagamentos (
  id             uuid primary key default gen_random_uuid(),
  orcamento_id   uuid not null references public.orcamentos(id),
  valor          numeric(12,2) not null check (valor > 0),
  forma          text not null check (forma in ('Pix','Dinheiro','Débito','Crédito','Cartão','Transferência','Outro')),
  recebido_em    timestamptz not null default now(),
  observacao     text,
  parcelas_cartao integer check (parcelas_cartao between 1 and 24),     -- cartão de crédito: em quantas vezes o cliente passou
  taxa_pct       numeric(5,2) check (taxa_pct between 0 and 30),        -- taxa da maquininha (informada na hora)
  valor_liquido  numeric(12,2),                                         -- o que cai na conta (valor − taxa)
  chave          text unique,                                           -- idempotência (clique duplo / repetição de rede)
  registrado_por text,
  criado_em      timestamptz not null default now(),
  estornado_em   timestamptz,
  estornado_por  text,
  estorno_motivo text,
  constraint orcamento_pagamentos_estorno_ck check ((estornado_em is null) = (estorno_motivo is null))
);
create index if not exists idx_orc_pagamentos_orc on public.orcamento_pagamentos (orcamento_id, recebido_em);
create index if not exists idx_orc_pagamentos_dia on public.orcamento_pagamentos (recebido_em) where estornado_em is null;
alter table public.orcamento_pagamentos enable row level security;
drop policy if exists orc_pagamentos_ler on public.orcamento_pagamentos;
create policy orc_pagamentos_ler on public.orcamento_pagamentos for select to authenticated using (true);
revoke all on public.orcamento_pagamentos from anon;
revoke insert, update, delete on public.orcamento_pagamentos from authenticated;   -- escrita só pelas RPCs

-- 2) Crediário: parcelas combinadas com o cliente (vencimento por parcela; o que foi pago abate da mais antiga) ---------
create table if not exists public.orcamento_parcelas (
  id           uuid primary key default gen_random_uuid(),
  orcamento_id uuid not null references public.orcamentos(id),
  numero       integer not null check (numero > 0),
  valor        numeric(12,2) not null check (valor > 0),
  vencimento   date not null,
  criado_em    timestamptz not null default now(),
  unique (orcamento_id, numero)
);
alter table public.orcamento_parcelas enable row level security;
drop policy if exists orc_parcelas_ler on public.orcamento_parcelas;
create policy orc_parcelas_ler on public.orcamento_parcelas for select to authenticated using (true);
revoke all on public.orcamento_parcelas from anon;
revoke insert, update, delete on public.orcamento_parcelas from authenticated;

alter table public.orcamentos add column if not exists liberada_com_saldo_por text;
alter table public.orcamentos add column if not exists liberada_com_saldo_em  timestamptz;

-- 3) valor_pago / pago_em / forma_pagamento passam a ser o resumo dos pagamentos ativos (compatível com as telas) ------
create or replace function public.orc_pagamentos_sincronizar() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(new.orcamento_id, old.orcamento_id); v_soma numeric; v_ult record;
begin
  select coalesce(sum(valor), 0) into v_soma from orcamento_pagamentos where orcamento_id = v_id and estornado_em is null;
  select recebido_em, forma into v_ult from orcamento_pagamentos
   where orcamento_id = v_id and estornado_em is null order by recebido_em desc, criado_em desc limit 1;
  update orcamentos set valor_pago = nullif(v_soma, 0), pago_em = v_ult.recebido_em, forma_pagamento = v_ult.forma
   where id = v_id;
  return null;
end $$;
drop trigger if exists trg_orc_pagamentos_sincronizar on public.orcamento_pagamentos;
create trigger trg_orc_pagamentos_sincronizar after insert or update on public.orcamento_pagamentos
  for each row execute function public.orc_pagamentos_sincronizar();

-- 4) Registrar um recebimento (parcial ou total). NÃO baixa itens: quem baixa é o app, só na quitação ------------------
create or replace function public.pagamento_registrar(
  p_orcamento uuid, p_valor numeric, p_forma text, p_obs text default null, p_parcelas integer default null,
  p_taxa numeric default null, p_chave text default null, p_recebido_em timestamptz default null, p_user text default null
) returns public.orcamentos language plpgsql security definer set search_path = public as $$
declare o orcamentos%rowtype; v_pago numeric; v_valor numeric := round(p_valor, 2); v_liq numeric;
begin
  select * into o from orcamentos where id = p_orcamento for update;
  if not found then raise exception 'Sacola não encontrada.' using errcode = 'P0002'; end if;
  if o.origem <> 'whatsapp' then raise exception 'Pagamento por esta tela só vale para sacolas do WhatsApp.' using errcode = 'P0001'; end if;
  if o.status not in ('ABERTA', 'VENDIDO', 'ENTREGUE') then
    raise exception 'Sacola % está % e não recebe pagamento.', o.codigo, o.status using errcode = 'P0001';
  end if;
  if p_chave is not null and exists (select 1 from orcamento_pagamentos where chave = p_chave) then return o; end if;  -- repetição
  if v_valor is null or v_valor <= 0 then raise exception 'Informe o valor recebido.' using errcode = 'P0001'; end if;
  select coalesce(sum(valor), 0) into v_pago from orcamento_pagamentos where orcamento_id = o.id and estornado_em is null;
  if v_valor > round(coalesce(o.total, 0), 2) - v_pago + 0.004 then
    raise exception 'Valor maior que o saldo da sacola (falta R$ %).', to_char(round(coalesce(o.total, 0), 2) - v_pago, 'FM999G990D00') using errcode = 'P0001';
  end if;
  v_liq := case when p_forma in ('Crédito', 'Débito') and p_taxa is not null then round(v_valor * (1 - p_taxa / 100), 2) else v_valor end;
  insert into orcamento_pagamentos (orcamento_id, valor, forma, recebido_em, observacao, parcelas_cartao, taxa_pct, valor_liquido, chave, registrado_por)
    values (o.id, v_valor, p_forma, coalesce(p_recebido_em, now()), nullif(trim(p_obs), ''),
            case when p_forma = 'Crédito' then p_parcelas end, p_taxa, v_liq, p_chave, p_user);
  if o.status = 'ABERTA' then  -- com pagamento, a separação só acaba se for cancelada de propósito
    update orcamentos set validade = now() + interval '10 years' where id = o.id and validade < now() + interval '5 years';
    update reservas set expira_em = null where status = 'ATIVA' and origem_tipo = 'sacola' and origem_ref = o.codigo;
  end if;
  select * into o from orcamentos where id = p_orcamento;
  return o;
end $$;
revoke all on function public.pagamento_registrar(uuid, numeric, text, text, integer, numeric, text, timestamptz, text) from public, anon;
grant execute on function public.pagamento_registrar(uuid, numeric, text, text, integer, numeric, text, timestamptz, text) to authenticated, service_role;

-- 5) Estorno (só gestor): marca o recebimento como estornado, com motivo; nada é apagado ---------------------------------
create or replace function public.pagamento_estornar(p_pagamento uuid, p_motivo text, p_user text default null)
returns public.orcamentos language plpgsql security definer set search_path = public as $$
declare p orcamento_pagamentos%rowtype; o orcamentos%rowtype; v_resta numeric;
begin
  if not public.pode_gerir_venda() then
    raise exception 'Só Bárbara, Valentina e Pedro podem estornar um pagamento.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo do estorno.' using errcode = 'P0001'; end if;
  select * into p from orcamento_pagamentos where id = p_pagamento;
  if not found then raise exception 'Pagamento não encontrado.' using errcode = 'P0002'; end if;
  select * into o from orcamentos where id = p.orcamento_id for update;
  select * into p from orcamento_pagamentos where id = p_pagamento for update;
  if p.estornado_em is not null then raise exception 'Este pagamento já foi estornado.' using errcode = 'P0001'; end if;
  update orcamento_pagamentos set estornado_em = now(), estornado_por = p_user, estorno_motivo = trim(p_motivo) where id = p.id;
  select coalesce(sum(valor), 0) into v_resta from orcamento_pagamentos where orcamento_id = o.id and estornado_em is null;
  if o.status = 'ABERTA' and v_resta = 0 then  -- voltou a "não pago": volta o prazo normal de 48 h
    update orcamentos set validade = now() + interval '48 hours' where id = o.id;
    update reservas set expira_em = now() + interval '48 hours' where status = 'ATIVA' and origem_tipo = 'sacola' and origem_ref = o.codigo;
  end if;
  select * into o from orcamentos where id = o.id;
  return o;
end $$;
revoke all on function public.pagamento_estornar(uuid, text, text) from public, anon;
grant execute on function public.pagamento_estornar(uuid, text, text) to authenticated, service_role;

-- 6) Plano de parcelas (crediário). Σ parcelas = total da sacola; lista vazia apaga o plano ------------------------------
create or replace function public.plano_parcelas_definir(p_orcamento uuid, p_parcelas jsonb, p_user text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare o orcamentos%rowtype; e jsonb; n integer := 0; v_soma numeric := 0;
begin
  select * into o from orcamentos where id = p_orcamento for update;
  if not found then raise exception 'Sacola não encontrada.' using errcode = 'P0002'; end if;
  if o.origem <> 'whatsapp' or o.status not in ('ABERTA', 'VENDIDO', 'ENTREGUE') then
    raise exception 'Sacola % não aceita plano de parcelas.', o.codigo using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_parcelas) <> 'array' then raise exception 'Parcelas inválidas.' using errcode = 'P0001'; end if;
  if jsonb_array_length(p_parcelas) > 24 then raise exception 'No máximo 24 parcelas.' using errcode = 'P0001'; end if;
  for e in select value from jsonb_array_elements(p_parcelas) loop
    if coalesce((e->>'valor')::numeric, 0) <= 0 or nullif(e->>'vencimento', '') is null then
      raise exception 'Cada parcela precisa de valor e vencimento.' using errcode = 'P0001';
    end if;
    v_soma := v_soma + round((e->>'valor')::numeric, 2);
  end loop;
  if jsonb_array_length(p_parcelas) > 0 and abs(v_soma - round(coalesce(o.total, 0), 2)) > 0.009 then
    raise exception 'As parcelas somam R$ % e a sacola é R$ %.', to_char(v_soma, 'FM999G990D00'), to_char(round(coalesce(o.total, 0), 2), 'FM999G990D00') using errcode = 'P0001';
  end if;
  delete from orcamento_parcelas where orcamento_id = o.id;
  for e in select value from jsonb_array_elements(p_parcelas) order by (value->>'vencimento')::date loop
    n := n + 1;
    insert into orcamento_parcelas (orcamento_id, numero, valor, vencimento)
      values (o.id, n, round((e->>'valor')::numeric, 2), (e->>'vencimento')::date);
  end loop;
  return n;
end $$;
revoke all on function public.plano_parcelas_definir(uuid, jsonb, text) from public, anon;
grant execute on function public.plano_parcelas_definir(uuid, jsonb, text) to authenticated, service_role;

-- 7) Trava no banco: sacola do WhatsApp com saldo em aberto só vira VENDIDO por gestor (libera "fiado") --------------
create or replace function public.orcamentos_guarda_saldo() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pago numeric; v_saldo numeric;
begin
  if new.origem = 'whatsapp' and new.status = 'VENDIDO' and old.status is distinct from 'VENDIDO' and old.status = 'ABERTA' then
    select coalesce(sum(valor), 0) into v_pago from orcamento_pagamentos where orcamento_id = new.id and estornado_em is null;
    v_saldo := round(coalesce(new.total, 0), 2) - v_pago;
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
create trigger trg_orcamentos_guarda_saldo before update of status on public.orcamentos
  for each row execute function public.orcamentos_guarda_saldo();

-- 8) O cron de vencimento não toca em sacola com pagamento (reservas dela têm expira_em nulo) -------------------------
create or replace function public.sacolas_expirar() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select id, codigo from orcamentos o
            where status = 'ABERTA' and validade <= now()
              and not exists (select 1 from orcamento_pagamentos p where p.orcamento_id = o.id and p.estornado_em is null)
              for update skip locked loop
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

-- 9) Backfill: cada sacola que já tinha valor_pago ganha 1 pagamento (idempotente pela chave) --------------------------
insert into public.orcamento_pagamentos (orcamento_id, valor, forma, recebido_em, chave, registrado_por)
select o.id, o.valor_pago,
       case when o.forma_pagamento in ('Pix','Dinheiro','Débito','Crédito','Cartão','Transferência','Outro') then o.forma_pagamento else 'Outro' end,
       coalesce(o.pago_em, o.atualizado_em, now()), 'backfill:' || o.id, 'backfill'
  from public.orcamentos o
 where o.origem = 'whatsapp' and coalesce(o.valor_pago, 0) > 0
   and not exists (select 1 from public.orcamento_pagamentos p where p.orcamento_id = o.id)
on conflict (chave) do nothing;

-- ROLLBACK (manual):
--   drop trigger if exists trg_orcamentos_guarda_saldo on public.orcamentos; drop function if exists public.orcamentos_guarda_saldo();
--   drop trigger if exists trg_orc_pagamentos_sincronizar on public.orcamento_pagamentos; drop function if exists public.orc_pagamentos_sincronizar();
--   drop function if exists public.pagamento_registrar(uuid, numeric, text, text, integer, numeric, text, timestamptz, text);
--   drop function if exists public.pagamento_estornar(uuid, text, text), public.plano_parcelas_definir(uuid, jsonb, text);
--   drop table if exists public.orcamento_parcelas, public.orcamento_pagamentos;
--   alter table public.orcamentos drop column if exists liberada_com_saldo_por, drop column if exists liberada_com_saldo_em;
--   (recriar sacolas_expirar de 20261116120000_gestores_venda_reforco2.sql)
