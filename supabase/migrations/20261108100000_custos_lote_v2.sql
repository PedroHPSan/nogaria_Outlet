-- Custos dos lotes v2 (módulo de gestão de custos). Depende de 20261103100000 (custeio_lote_produto, no banco: 20261103165128).
-- ⚠️ NÃO aplicar em produção sem OK de Pedro OU Bárbara (via MCP apply_migration). Idempotente e aditiva. Rollback no fim.
--
--  F2  regra de rateio por linha extra · auditoria de custos · RPC atômica salvar_custeio_lote
--  F3  FONTE ÚNICA do custo por item: custo_itens_lote(lote) (lotes 'composto'; legados seguem no motor JS)
--  F4  custos globais (todos os lotes ou subconjuntos) com vigência, escopo e exceções — entram em custo_itens_lote
--  F5  itens.custo_na_venda: o custo fica congelado quando a peça é vendida (lucro realizado estável)

-- ===== F2 ===================================================================================================
alter table public.lote_custos_extra add column if not exists regra_rateio text not null default 'motor'
  check (regra_rateio in ('motor', 'igual', 'valor', 'peso'));
alter table public.lote_custos_extra add column if not exists atualizado_em timestamptz not null default now();
alter table public.lote_custos_extra add column if not exists atualizado_por text;
revoke all on public.lote_custos_extra from anon;      -- o RLS já bloqueava; isto tira o privilégio de tabela também

create or replace function public.custo_usuario() returns text language sql stable as $$
  select coalesce(nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''), current_user)
$$;

create table if not exists public.custo_auditoria (
  id        bigserial primary key,
  tabela    text not null,
  registro  text,
  lote      integer,
  sku       text,
  acao      text not null,
  antes     jsonb,
  depois    jsonb,
  usuario   text,
  ts        timestamptz not null default now()
);
create index if not exists custo_auditoria_lote_idx on public.custo_auditoria (lote, ts desc);
create index if not exists custo_auditoria_sku_idx on public.custo_auditoria (sku, ts desc) where sku is not null;
alter table public.custo_auditoria enable row level security;
drop policy if exists custo_auditoria_ler on public.custo_auditoria;
create policy custo_auditoria_ler on public.custo_auditoria for select to authenticated using (true);
revoke all on public.custo_auditoria from anon;
revoke insert, update, delete on public.custo_auditoria from authenticated;   -- só os triggers (security definer) gravam

create or replace function public.trg_custo_auditar() returns trigger language plpgsql security definer set search_path = public as $$
declare v_lote integer; v_sku text; v_reg text; a jsonb; d jsonb;
begin
  if tg_table_name = 'lotes' then
    v_lote := new.lote; v_reg := new.lote::text;
    a := jsonb_build_object('modo_custeio', old.modo_custeio, 'custo_origem', old.custo_origem, 'lance_final', old.lance_final,
                            'comissao_leiloeiro', old.comissao_leiloeiro, 'taxa_hisa', old.taxa_hisa, 'custo_total', old.custo_total);
    d := jsonb_build_object('modo_custeio', new.modo_custeio, 'custo_origem', new.custo_origem, 'lance_final', new.lance_final,
                            'comissao_leiloeiro', new.comissao_leiloeiro, 'taxa_hisa', new.taxa_hisa, 'custo_total', new.custo_total);
    if a = d then return null; end if;
    insert into custo_auditoria (tabela, registro, lote, acao, antes, depois, usuario) values ('lotes', v_reg, v_lote, 'update', a, d, custo_usuario());
  elsif tg_table_name = 'lote_custos_extra' then
    if tg_op = 'DELETE' then v_lote := old.lote; v_sku := old.sku; v_reg := old.id::text; a := to_jsonb(old);
    elsif tg_op = 'INSERT' then v_lote := new.lote; v_sku := new.sku; v_reg := new.id::text; d := to_jsonb(new);
    else v_lote := new.lote; v_sku := new.sku; v_reg := new.id::text; a := to_jsonb(old); d := to_jsonb(new); end if;
    insert into custo_auditoria (tabela, registro, lote, sku, acao, antes, depois, usuario)
    values ('lote_custos_extra', v_reg, v_lote, v_sku, lower(tg_op), a, d, custo_usuario());
  elsif tg_table_name = 'itens' then
    insert into custo_auditoria (tabela, registro, lote, sku, acao, antes, depois, usuario)
    values ('itens', new.sku, new.lote, new.sku, 'custo_direto', jsonb_build_object('custo_direto', old.custo_direto),
            jsonb_build_object('custo_direto', new.custo_direto), custo_usuario());
  elsif tg_table_name = 'custos_globais' then
    insert into custo_auditoria (tabela, registro, acao, antes, depois, usuario)
    values ('custos_globais', (case when tg_op = 'DELETE' then old.id else new.id end)::text, lower(tg_op), case when tg_op <> 'INSERT' then to_jsonb(old) end,
            case when tg_op <> 'DELETE' then to_jsonb(new) end, custo_usuario());
  end if;
  return null;
end $$;

drop trigger if exists custo_auditar_lotes on public.lotes;
create trigger custo_auditar_lotes after update of modo_custeio, custo_origem, lance_final, comissao_leiloeiro, taxa_hisa on public.lotes
  for each row execute function public.trg_custo_auditar();
drop trigger if exists custo_auditar_extra on public.lote_custos_extra;
create trigger custo_auditar_extra after insert or update or delete on public.lote_custos_extra
  for each row execute function public.trg_custo_auditar();
drop trigger if exists custo_auditar_item on public.itens;
create trigger custo_auditar_item after update of custo_direto on public.itens
  for each row when (old.custo_direto is distinct from new.custo_direto) execute function public.trg_custo_auditar();

-- ===== F4 (tabelas; entram na F3) ===========================================================================
create table if not exists public.custos_globais (
  id             bigserial primary key,
  nome           text not null check (length(trim(nome)) >= 2),
  tipo           text not null default 'outros',
  valor          numeric not null check (valor >= 0),
  base           text not null default 'por_item' check (base in ('por_item', 'por_lote', 'pct_custo_lote')),
  regra_rateio   text not null default 'valor' check (regra_rateio in ('igual', 'valor', 'peso')),
  grupos         text[],          -- null = todos os grupos
  lotes          integer[],       -- null = todos os lotes
  vigencia_inicio date not null default current_date,
  vigencia_fim   date,
  ativo          boolean not null default true,
  criado_por     text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  check (vigencia_fim is null or vigencia_fim >= vigencia_inicio)
);
create table if not exists public.custos_globais_excecao (
  global_id bigint not null references public.custos_globais(id) on delete cascade,
  lote      integer not null references public.lotes(lote) on update cascade on delete cascade,
  primary key (global_id, lote)
);
alter table public.custos_globais enable row level security;
alter table public.custos_globais_excecao enable row level security;
drop policy if exists custos_globais_equipe on public.custos_globais;
create policy custos_globais_equipe on public.custos_globais for all to authenticated using (true) with check (true);
drop policy if exists custos_globais_excecao_equipe on public.custos_globais_excecao;
create policy custos_globais_excecao_equipe on public.custos_globais_excecao for all to authenticated using (true) with check (true);
revoke all on public.custos_globais, public.custos_globais_excecao from anon;
grant select, insert, update, delete on public.custos_globais, public.custos_globais_excecao to authenticated;
grant usage, select on sequence public.custos_globais_id_seq to authenticated;
drop trigger if exists custo_auditar_global on public.custos_globais;
create trigger custo_auditar_global after insert or update or delete on public.custos_globais
  for each row execute function public.trg_custo_auditar();

-- ===== F3: rateio em centavos e custo por item ============================================================
-- Divide p_total entre os SKUs pelos pesos; maior resto em centavos (desempate: peso maior, depois sku) → a soma BATE.
create or replace function public.ratear_centavos(p_total numeric, p_skus text[], p_pesos numeric[])
returns table (sku text, valor numeric) language sql immutable as $$
  with w as (select s as sku, greatest(coalesce(p, 0), 0) as w from unnest(p_skus, p_pesos) as t(s, p)),
       tot as (select coalesce(sum(w), 0) as sw, count(*) as n from w),
       q as (select w.sku, w.w, case when tot.sw > 0 then p_total * 100 * w.w / tot.sw else p_total * 100 / nullif(tot.n, 0) end as exato from w, tot),
       b as (select sku, w, floor(exato) as base_c, exato - floor(exato) as resto from q),
       f as (select round(p_total * 100) - coalesce(sum(base_c), 0) as falta from b),
       r as (select b.*, row_number() over (order by resto desc, w desc, sku) as rn from b)
  select r.sku, (r.base_c + case when r.rn <= (select falta from f) then 1 else 0 end) / 100 from r
$$;

-- Pesos de rateio: valor positivo; peça sem dado recebe a MEDIANA das que têm (se nenhuma tem, todas pesam 1).
create or replace function public.pesos_ou_mediana(p_vals numeric[]) returns numeric[] language plpgsql immutable as $$
declare med numeric; out numeric[] := '{}'; v numeric;
begin
  select percentile_cont(0.5) within group (order by x) into med from unnest(p_vals) x where x > 0;
  foreach v in array p_vals loop out := out || coalesce(case when v > 0 then v end, med, 1::numeric); end loop;
  return out;
end $$;
create or replace function public.pesos_estimados(p_vals numeric[]) returns boolean[] language plpgsql immutable as $$
declare algum boolean; out boolean[] := '{}'; v numeric;
begin
  select bool_or(x > 0) into algum from unnest(p_vals) x;
  foreach v in array p_vals loop out := out || (coalesce(algum, false) and not coalesce(v > 0, false)); end loop;
  return out;
end $$;

-- FONTE ÚNICA do custo por item dos lotes 'composto' (legados seguem no motor do app).
-- custo = base (custo direto ou parte do valor do lote) + extras do lote (regra de cada extra) + extras da peça + globais vigentes.
-- Peças DESCARTE não entram na divisão (o custo passa para as vendáveis).
create or replace function public.custo_itens_lote(p_lote integer)
returns table (sku text, base numeric, extras_lote numeric, extras_item numeric, globais numeric, total numeric, origem text, estimado boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  l lotes%rowtype; n int; i int; idx int;
  skus text[]; grupos text[]; v_val numeric[]; v_peso numeric[]; v_dir numeric[];
  p_val numeric[]; p_pes numeric[]; est_val boolean[];
  a_base numeric[]; a_el numeric[]; a_ei numeric[]; a_gl numeric[];
  v_pool numeric; v_somadir numeric; sub_s text[]; sub_p numeric[];
  e record; g record; r record; pw numeric[]; v_data date; s text;
begin
  select * into l from lotes where lote = p_lote;
  if not found or l.custo_origem is distinct from 'composto' then return; end if;
  v_data := l.created_at::date;
  select array_agg(x.sku order by x.sku), array_agg(x.grupo order by x.sku),
         array_agg(coalesce(nullif(x.preco_ideal, 0), nullif(x.preco_sugerido, 0)) order by x.sku),
         array_agg(coalesce(nullif(x.peso_real_kg, 0), nullif(x.peso_kg, 0)) order by x.sku),
         array_agg(x.custo_direto order by x.sku)
    into skus, grupos, v_val, v_peso, v_dir
    from itens x where x.lote = p_lote and x.status::text <> 'DESCARTE';
  if skus is null then return; end if;
  n := array_length(skus, 1);
  p_val := pesos_ou_mediana(v_val); p_pes := pesos_ou_mediana(v_peso); est_val := pesos_estimados(v_val);
  a_base := array_fill(0::numeric, array[n]); a_el := a_base; a_ei := a_base; a_gl := a_base;

  -- base
  if l.modo_custeio = 'soma' then
    for i in 1..n loop a_base[i] := coalesce(v_dir[i], 0); end loop;
  else
    select coalesce(sum(d), 0) into v_somadir from unnest(v_dir) d;
    v_pool := greatest(0, coalesce(l.lance_final, 0) + coalesce(l.comissao_leiloeiro, 0) + coalesce(l.taxa_hisa, 0) - v_somadir);
    sub_s := '{}'; sub_p := '{}';
    for i in 1..n loop
      if v_dir[i] is null then sub_s := sub_s || skus[i]; sub_p := sub_p || p_val[i]; else a_base[i] := v_dir[i]; end if;
    end loop;
    if coalesce(array_length(sub_s, 1), 0) > 0 then
      for r in select * from ratear_centavos(v_pool, sub_s, sub_p) loop
        idx := array_position(skus, r.sku); a_base[idx] := a_base[idx] + r.valor;
      end loop;
    end if;
  end if;

  -- extras do lote (sem sku: regra de cada extra) e extras da peça (com sku)
  for e in select * from lote_custos_extra where lote = p_lote order by id loop
    if e.sku is not null then
      idx := array_position(skus, e.sku);
      if idx is not null then a_ei[idx] := a_ei[idx] + e.valor; end if;
    else
      pw := case e.regra_rateio when 'igual' then array_fill(1::numeric, array[n]) when 'peso' then p_pes else p_val end;
      for r in select * from ratear_centavos(e.valor, skus, pw) loop
        idx := array_position(skus, r.sku); a_el[idx] := a_el[idx] + r.valor;
      end loop;
    end if;
  end loop;

  -- globais vigentes (data do lote), do escopo do lote/grupo, sem exceção
  for g in select * from custos_globais c
            where c.ativo and v_data >= c.vigencia_inicio and (c.vigencia_fim is null or v_data <= c.vigencia_fim)
              and (c.lotes is null or p_lote = any (c.lotes))
              and not exists (select 1 from custos_globais_excecao x where x.global_id = c.id and x.lote = p_lote)
            order by c.id loop
    sub_s := '{}'; sub_p := '{}';
    for i in 1..n loop
      if g.grupos is null or grupos[i] = any (g.grupos) then
        sub_s := sub_s || skus[i];
        sub_p := sub_p || (case g.regra_rateio when 'igual' then 1::numeric when 'peso' then p_pes[i] else p_val[i] end);
      end if;
    end loop;
    if coalesce(array_length(sub_s, 1), 0) = 0 then continue; end if;
    if g.base = 'por_item' then
      foreach s in array sub_s loop idx := array_position(skus, s); a_gl[idx] := a_gl[idx] + g.valor; end loop;
    elsif g.base = 'por_lote' then
      for r in select * from ratear_centavos(g.valor, sub_s, sub_p) loop idx := array_position(skus, r.sku); a_gl[idx] := a_gl[idx] + r.valor; end loop;
    else
      foreach s in array sub_s loop
        idx := array_position(skus, s);
        a_gl[idx] := a_gl[idx] + round((a_base[idx] + a_el[idx] + a_ei[idx]) * g.valor / 100, 2);
      end loop;
    end if;
  end loop;

  for i in 1..n loop
    sku := skus[i]; base := round(a_base[i], 2); extras_lote := round(a_el[i], 2); extras_item := round(a_ei[i], 2); globais := round(a_gl[i], 2);
    total := round(a_base[i] + a_el[i] + a_ei[i] + a_gl[i], 2);
    origem := case when v_dir[i] is not null then 'direto' when l.modo_custeio = 'soma' then 'sem_custo' else 'rateado' end;
    estimado := v_dir[i] is null and l.modo_custeio <> 'soma' and est_val[i];
    return next;
  end loop;
end $$;
revoke all on function public.custo_itens_lote(integer) from public, anon;
grant execute on function public.custo_itens_lote(integer) to authenticated, service_role;

-- custo_total do lote 'composto' passa a incluir os globais (as views leem lotes.custo_total / pricing_lote_custo)
create or replace function public.custo_total_composto(p_lote integer) returns numeric
language sql stable as $$
  select case when l.custo_origem is distinct from 'composto' then null else
    case l.modo_custeio
      when 'soma' then coalesce((select sum(i.custo_direto) from itens i where i.lote = l.lote and i.status::text <> 'DESCARTE'), 0)
      else coalesce(l.lance_final, 0) + coalesce(l.comissao_leiloeiro, 0) + coalesce(l.taxa_hisa, 0)
    end
    + coalesce((select sum(e.valor) from lote_custos_extra e where e.lote = l.lote), 0)
    + coalesce((select sum(c.globais) from custo_itens_lote(l.lote) c), 0)
  end
  from lotes l where l.lote = p_lote
$$;

-- global criado/alterado/removido ou exceção mudou: recalcula os lotes 'composto'
create or replace function public.trg_global_sync_custo() returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select lote from lotes where custo_origem = 'composto' loop perform sync_custo_lote(r.lote); end loop;
  return null;
end $$;
drop trigger if exists global_sync_custo on public.custos_globais;
create trigger global_sync_custo after insert or update or delete on public.custos_globais
  for each statement execute function public.trg_global_sync_custo();
drop trigger if exists global_excecao_sync_custo on public.custos_globais_excecao;
create trigger global_excecao_sync_custo after insert or update or delete on public.custos_globais_excecao
  for each statement execute function public.trg_global_sync_custo();

-- ===== F2: gravação ATÔMICA do custeio ======================================================================
-- p_extras: [{id?, sku?, tipo, descricao?, valor, regra_rateio?}]  (substitui o conjunto: o que não vier é removido)
-- p_diretos: {"SKU": 12.5, "SKU2": null}  (só peças deste lote; null limpa o custo direto)
create or replace function public.salvar_custeio_lote(p_lote integer, p_modo text, p_lance numeric default null, p_comissao numeric default null,
                                                       p_taxa numeric default null, p_extras jsonb default '[]', p_diretos jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare e jsonb; k text; v jsonb; v_ids bigint[] := '{}'; v_id bigint; v_user text := custo_usuario(); v_total numeric;
begin
  if p_modo not in ('rateio', 'soma') then raise exception 'Modo de custeio inválido.' using errcode = 'P0001'; end if;
  if p_modo = 'rateio' and not (coalesce(p_lance, 0) > 0) then raise exception 'Informe o valor pago pelo lote.' using errcode = 'P0001'; end if;
  if not exists (select 1 from lotes where lote = p_lote) then raise exception 'Lote % não encontrado.', p_lote using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtext('custeio:' || p_lote));

  for k, v in select * from jsonb_each(coalesce(p_diretos, '{}')) loop
    update itens set custo_direto = case when jsonb_typeof(v) = 'null' then null else (v #>> '{}')::numeric end, upd_by = v_user
     where sku = k and lote = p_lote;
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p_extras, '[]')) loop
    if coalesce((e->>'valor')::numeric, 0) <= 0 then continue; end if;
    if nullif(e->>'id', '') is not null then
      update lote_custos_extra set sku = nullif(trim(e->>'sku'), ''), tipo = coalesce(nullif(e->>'tipo', ''), 'outros'),
             descricao = nullif(trim(e->>'descricao'), ''), valor = (e->>'valor')::numeric,
             regra_rateio = coalesce(nullif(e->>'regra_rateio', ''), 'motor'), atualizado_em = now(), atualizado_por = v_user
       where id = (e->>'id')::bigint and lote = p_lote returning id into v_id;
    else v_id := null; end if;
    if v_id is null then
      insert into lote_custos_extra (lote, sku, tipo, descricao, valor, regra_rateio, criado_por, atualizado_por)
      values (p_lote, nullif(trim(e->>'sku'), ''), coalesce(nullif(e->>'tipo', ''), 'outros'), nullif(trim(e->>'descricao'), ''),
              (e->>'valor')::numeric, coalesce(nullif(e->>'regra_rateio', ''), 'motor'), v_user, v_user) returning id into v_id;
    end if;
    v_ids := v_ids || v_id;
  end loop;
  delete from lote_custos_extra where lote = p_lote and not (id = any (v_ids));

  update lotes set modo_custeio = p_modo, custo_origem = 'composto',
         lance_final = case when p_modo = 'rateio' then p_lance else lance_final end,
         comissao_leiloeiro = case when p_modo = 'rateio' then coalesce(p_comissao, 0) else comissao_leiloeiro end,
         taxa_hisa = case when p_modo = 'rateio' then coalesce(p_taxa, 0) else taxa_hisa end,
         valor_pago_hisa = case when p_modo = 'rateio' then p_lance + coalesce(p_comissao, 0) + coalesce(p_taxa, 0) else valor_pago_hisa end,
         frete_retirada = null, frete_transferencia = null, outros_custos = null
   where lote = p_lote;
  perform sync_custo_lote(p_lote);
  select custo_total into v_total from lotes where lote = p_lote;
  return jsonb_build_object('lote', p_lote, 'custo_total', v_total, 'extras', coalesce(array_length(v_ids, 1), 0));
end $$;
revoke all on function public.salvar_custeio_lote(integer, text, numeric, numeric, numeric, jsonb, jsonb) from public, anon;
grant execute on function public.salvar_custeio_lote(integer, text, numeric, numeric, numeric, jsonb, jsonb) to authenticated, service_role;

-- ===== F5: custo congelado na venda =========================================================================
alter table public.itens add column if not exists custo_na_venda numeric;
create or replace function public.trg_item_custo_na_venda() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.custo_na_venda is null and new.lote is not null then
    select c.total into new.custo_na_venda from custo_itens_lote(new.lote) c where c.sku = new.sku;
  end if;
  return new;
end $$;
drop trigger if exists item_custo_na_venda on public.itens;
create trigger item_custo_na_venda before update of status on public.itens
  for each row when (new.status::text = 'VENDIDO' and old.status::text is distinct from 'VENDIDO')
  execute function public.trg_item_custo_na_venda();

-- Rollback (manual): drop trigger item_custo_na_venda on itens; drop function trg_item_custo_na_venda();
--   alter table itens drop column custo_na_venda; drop function salvar_custeio_lote(integer,text,numeric,numeric,numeric,jsonb,jsonb);
--   (restaurar custo_total_composto da 20261103100000) drop function custo_itens_lote(integer), pesos_estimados(numeric[]), pesos_ou_mediana(numeric[]), ratear_centavos(numeric,text[],numeric[]);
--   drop table custos_globais_excecao, custos_globais, custo_auditoria; drop function trg_custo_auditar(), custo_usuario(), trg_global_sync_custo();
