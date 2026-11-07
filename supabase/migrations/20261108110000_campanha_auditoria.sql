-- Campanhas: auditoria dos produtos, inclusão/remoção por campanha e correção da elegibilidade.
-- Depende de 20261107150000 (F1). ⚠️ NÃO aplicar em produção sem OK de Pedro OU Bárbara (via MCP apply_migration).
-- Idempotente (create or replace / if not exists). Rollback no fim.
--
-- Por que a campanha "BKACK FRIDAY" saiu vazia: campanha_resolver só aceitava peças em PRECIFICADO/PRONTO/ANUNCIADO, e as peças
-- de roupa estão em FOTOGRAFADO/TRIADO/A_CATALOGAR. Elegível passa a ser: TEM preço de venda e NÃO foi vendida/entregue/descartada.
-- (Aparecer no link /promo ainda exige estar publicada no catálogo com foto: a auditoria mostra essa coluna.)

-- 1) Resolução das regras: a versão base devolve também quem NÃO é elegível (a auditoria precisa explicar o "por quê") ----------
create or replace function public.campanha_resolver_base(p_campanha uuid, p_so_elegiveis boolean)
returns table (sku text, canal text, preco_cheio numeric, pct numeric, regra_tipo text)
language sql stable security definer set search_path = public as $$
  with ctx as (
    select '*'::text as canal
    union select r.canal from campanha_regras r where r.campanha_id = p_campanha and r.canal is not null
  ), it as (
    select i.sku, i.preco_ideal, i.lote::text as lote, i.estado::text as estado, c.grupo as grupo_norm, c.macro
      from itens i
      cross join lateral catalogo_categoria(i.grupo) c
     where (not p_so_elegiveis) or (coalesce(i.preco_ideal, 0) > 0 and i.status::text not in ('VENDIDO', 'ENTREGUE', 'DESCARTE'))
  ), cand as (
    select it.sku, ctx.canal as ctx_canal, r.tipo, r.canal as r_canal, r.desconto_pct,
           case when r.tipo = 'item' then 1 when r.tipo = 'grupo' then 2 when r.tipo = 'macro' then 3
                when r.tipo in ('lote','estado') then 4 when r.canal is not null then 5 else 6 end as camada
      from it
      join campanha_regras r on r.campanha_id = p_campanha
       and (   (r.tipo = 'item'   and r.alvo = it.sku)
            or (r.tipo = 'grupo'  and r.alvo = it.grupo_norm)
            or (r.tipo = 'macro'  and r.alvo = it.macro)
            or (r.tipo = 'lote'   and r.alvo = it.lote)
            or (r.tipo = 'estado' and r.alvo = it.estado)
            or  r.tipo = 'geral')
      join ctx on r.canal is null or r.canal = ctx.canal
  ), win as (
    select distinct on (cand.sku, cand.ctx_canal)
           cand.sku, cand.ctx_canal, cand.desconto_pct, cand.tipo
      from cand
     order by cand.sku, cand.ctx_canal, cand.camada, (cand.r_canal is not null) desc, cand.desconto_pct asc
  )
  select w.sku, w.ctx_canal, it.preco_ideal, w.desconto_pct, w.tipo
    from win w join it on it.sku = w.sku;
$$;
revoke all on function public.campanha_resolver_base(uuid, boolean) from public, anon;
grant execute on function public.campanha_resolver_base(uuid, boolean) to authenticated, service_role;

-- A função que o resto do sistema usa continua com o mesmo nome/assinatura: agora só com a elegibilidade corrigida.
create or replace function public.campanha_resolver(p_campanha uuid)
returns table (sku text, canal text, preco_cheio numeric, pct numeric, regra_tipo text)
language sql stable security definer set search_path = public as $$
  select * from campanha_resolver_base(p_campanha, true);
$$;

-- 2) Log de auditoria da campanha (quem incluiu/removeu/publicou/encerrou o quê e quando) -----------------------------------
create table if not exists public.campanha_log (
  id          bigserial primary key,
  campanha_id uuid not null references public.campanhas(id) on delete cascade,
  sku         text,
  acao        text not null,
  detalhe     jsonb,
  usuario     text,
  ts          timestamptz not null default now()
);
create index if not exists campanha_log_campanha_idx on public.campanha_log (campanha_id, ts desc);
alter table public.campanha_log enable row level security;
drop policy if exists campanha_log_ler on public.campanha_log;
create policy campanha_log_ler on public.campanha_log for select to authenticated using (true);
revoke all on public.campanha_log from anon;
revoke insert, update, delete on public.campanha_log from authenticated;

create or replace function public.trg_campanha_log() returns trigger language plpgsql security definer set search_path = public as $$
declare v_user text := coalesce(nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''), current_user);
begin
  if tg_table_name = 'campanha_itens' then
    if tg_op = 'INSERT' then
      insert into campanha_log (campanha_id, sku, acao, detalhe, usuario)
      values (new.campanha_id, new.sku, 'item_incluido', jsonb_build_object('canal', new.canal, 'preco_cheio', new.preco_cheio, 'desconto_pct', new.desconto_pct, 'origem', new.regra_tipo), v_user);
    else
      insert into campanha_log (campanha_id, sku, acao, detalhe, usuario)
      values (old.campanha_id, old.sku, 'item_removido', jsonb_build_object('canal', old.canal, 'preco_cheio', old.preco_cheio, 'desconto_pct', old.desconto_pct, 'origem', old.regra_tipo), v_user);
    end if;
  elsif tg_table_name = 'campanhas' then
    if old.status is distinct from new.status or old.fim_em is distinct from new.fim_em then
      insert into campanha_log (campanha_id, acao, detalhe, usuario)
      values (new.id, case when new.status = 'PUBLICADA' and old.status = 'RASCUNHO' then 'publicada'
                           when new.status = 'CANCELADA' then 'cancelada' else 'prazo_alterado' end,
              jsonb_build_object('status_antes', old.status, 'status_depois', new.status, 'fim_antes', old.fim_em, 'fim_depois', new.fim_em), v_user);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_campanha_itens_log on public.campanha_itens;
create trigger trg_campanha_itens_log after insert or delete on public.campanha_itens
  for each row execute function public.trg_campanha_log();
drop trigger if exists trg_campanhas_log on public.campanhas;
create trigger trg_campanhas_log after update on public.campanhas
  for each row execute function public.trg_campanha_log();

-- 3) AUDITORIA: todos os produtos que a campanha toca, com a situação e o motivo -------------------------------------------
-- situacao: na_campanha · excluida_0pct · sem_preco · indisponivel · conflito · nao_incluida (casa com as regras mas a campanha
-- publicada não congelou o item: use Reaplicar/Incluir)
create or replace function public.campanha_auditar(p_id uuid, p_canal text default '*')
returns table (sku text, produto text, grupo text, lote integer, status text, preco_ideal numeric, regra_tipo text, pct numeric,
               preco_cheio numeric, preco numeric, situacao text, no_catalogo boolean, conflito_campanha uuid, conflito_nome text, origem text)
language sql stable security definer set search_path = public as $$
  with c as (select * from campanhas where id = p_id),
  regra as (
    select x.* from campanha_resolver_base(p_id, false) x
     where x.canal = p_canal
        or (x.canal = '*' and not exists (select 1 from campanha_resolver_base(p_id, false) y where y.sku = x.sku and y.canal = p_canal))
  ), cong as (
    select ci.* from campanha_itens ci
     where ci.campanha_id = p_id
       and (ci.canal = p_canal or (ci.canal = '*' and not exists (select 1 from campanha_itens z where z.campanha_id = p_id and z.sku = ci.sku and z.canal = p_canal)))
  ), base as (
    select coalesce(cg.sku, rg.sku) as sku, rg.pct as pct_regra, rg.regra_tipo as tipo_regra,
           cg.desconto_pct as pct_cong, cg.regra_tipo as tipo_cong, cg.preco_cheio as cheio_cong
      from regra rg full join cong cg on cg.sku = rg.sku
  ), r as (
    select i.sku, i.produto, i.grupo, i.lote, i.status::text as status, i.preco_ideal,
           b.pct_regra, b.tipo_regra, b.pct_cong, b.tipo_cong, b.cheio_cong,
           coalesce(b.pct_cong, b.pct_regra) as pct_final,
           coalesce(b.cheio_cong, i.preco_ideal) as cheio_final,
           exists (select 1 from cong z where z.sku = b.sku) as congelado,
           (coalesce(i.preco_ideal, 0) > 0) as tem_preco,
           (i.status::text in ('VENDIDO', 'ENTREGUE', 'DESCARTE')) as fora_estoque
      from base b join itens i on i.sku = b.sku
  )
  select r.sku, r.produto, r.grupo, r.lote, r.status, r.preco_ideal,
         coalesce(r.tipo_cong, r.tipo_regra), r.pct_final, r.cheio_final,
         case when r.pct_final > 0 and r.cheio_final > 0
              then least(campanha_arredondar(r.cheio_final * (1 - r.pct_final / 100), c.arredondamento), r.cheio_final) else r.cheio_final end,
         case
           when coalesce(r.pct_final, 0) = 0 then 'excluida_0pct'
           when r.congelado then 'na_campanha'
           when not r.tem_preco then 'sem_preco'
           when r.fora_estoque then 'indisponivel'
           when k.id is not null then 'conflito'
           when c.status = 'RASCUNHO' then 'na_campanha'
           else 'nao_incluida'
         end,
         exists (select 1 from listing_state l where l.sku = r.sku and l.canal = 'whatsapp' and l.estado = 'publicado'),
         k.id, k.nome,
         case when r.congelado and coalesce(r.tipo_cong, '') = 'manual' then 'manual' else 'regra' end
    from r cross join c
    left join lateral (
      select o.id, o.nome from campanha_itens ci join campanhas o on o.id = ci.campanha_id
       where ci.sku = r.sku and ci.desconto_pct > 0 and coalesce(r.pct_final, 0) > 0 and o.id <> p_id and o.status = 'PUBLICADA'
         and tstzrange(o.inicio_em, o.fim_em, '[)') && tstzrange(c.inicio_em, c.fim_em, '[)')
       limit 1) k on true
   order by r.sku;
$$;
revoke all on function public.campanha_auditar(uuid, text) from public, anon;
grant execute on function public.campanha_auditar(uuid, text) to authenticated, service_role;

-- 4) Incluir / remover / reaplicar em campanha PUBLICADA e em andamento (rascunho edita as regras) ---------------------------------
create or replace function public.campanha_incluir_itens(p_id uuid, p_skus text[], p_pct numeric, p_user text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c campanhas; s text; i itens; v_ok text[] := '{}'; v_ign jsonb := '[]'::jsonb; v_motivo text;
begin
  perform pg_advisory_xact_lock(hashtext('campanha_publicar'));
  select * into c from campanhas where id = p_id for update;
  if not found then raise exception 'Campanha não encontrada.'; end if;
  if c.status <> 'PUBLICADA' or c.fim_em <= now() then raise exception 'Só dá para incluir itens em campanha publicada e ainda em andamento (rascunho: edite as regras).'; end if;
  if not (coalesce(p_pct, 0) > 0 and p_pct <= 90) then raise exception 'Informe um desconto entre 0,01%% e 90%%.'; end if;
  foreach s in array coalesce(p_skus, '{}') loop
    s := upper(trim(s));
    select * into i from itens where sku = s;
    v_motivo := case
      when not found then 'SKU não encontrado'
      when coalesce(i.preco_ideal, 0) <= 0 then 'sem preço de venda'
      when i.status::text in ('VENDIDO', 'ENTREGUE', 'DESCARTE') then 'já vendido/descartado'
      when exists (select 1 from campanha_itens x where x.campanha_id = p_id and x.sku = s) then 'já está na campanha'
      when exists (select 1 from campanha_itens ci join campanhas o on o.id = ci.campanha_id
                    where ci.sku = s and ci.desconto_pct > 0 and o.id <> p_id and o.status = 'PUBLICADA'
                      and tstzrange(o.inicio_em, o.fim_em, '[)') && tstzrange(c.inicio_em, c.fim_em, '[)')) then 'já está em outra campanha no mesmo período'
    end;
    if v_motivo is not null then v_ign := v_ign || jsonb_build_object('sku', s, 'motivo', v_motivo);
    else
      insert into campanha_itens (campanha_id, sku, canal, preco_cheio, desconto_pct, regra_tipo) values (p_id, s, '*', i.preco_ideal, p_pct, 'manual');
      v_ok := v_ok || s;
    end if;
  end loop;
  return jsonb_build_object('incluidos', to_jsonb(v_ok), 'ignorados', v_ign);
end $$;
revoke all on function public.campanha_incluir_itens(uuid, text[], numeric, text) from public, anon;
grant execute on function public.campanha_incluir_itens(uuid, text[], numeric, text) to authenticated, service_role;

create or replace function public.campanha_remover_item(p_id uuid, p_sku text, p_user text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare c campanhas; n integer;
begin
  select * into c from campanhas where id = p_id for update;
  if not found then raise exception 'Campanha não encontrada.'; end if;
  if c.status <> 'PUBLICADA' then raise exception 'Só dá para remover itens de campanha publicada (rascunho: edite as regras).'; end if;
  delete from campanha_itens where campanha_id = p_id and sku = upper(trim(p_sku));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.campanha_remover_item(uuid, text, text) from public, anon;
grant execute on function public.campanha_remover_item(uuid, text, text) to authenticated, service_role;

-- Reaplica as regras numa campanha publicada em andamento: inclui o que casa com as regras e ainda não está (preço "de" = preço atual).
create or replace function public.campanha_reaplicar(p_id uuid, p_user text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c campanhas; r record; v_inc int := 0; v_conf int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('campanha_publicar'));
  select * into c from campanhas where id = p_id for update;
  if not found then raise exception 'Campanha não encontrada.'; end if;
  if c.status <> 'PUBLICADA' or c.fim_em <= now() then raise exception 'Só dá para reaplicar em campanha publicada e ainda em andamento.'; end if;
  for r in select x.* from campanha_resolver(p_id) x
            where not exists (select 1 from campanha_itens ci where ci.campanha_id = p_id and ci.sku = x.sku) loop
    if r.pct > 0 and exists (select 1 from campanha_itens ci join campanhas o on o.id = ci.campanha_id
                              where ci.sku = r.sku and ci.desconto_pct > 0 and o.id <> p_id and o.status = 'PUBLICADA'
                                and tstzrange(o.inicio_em, o.fim_em, '[)') && tstzrange(c.inicio_em, c.fim_em, '[)')) then
      v_conf := v_conf + 1;
    else
      insert into campanha_itens (campanha_id, sku, canal, preco_cheio, desconto_pct, regra_tipo) values (p_id, r.sku, r.canal, r.preco_cheio, r.pct, r.regra_tipo)
      on conflict do nothing;
      v_inc := v_inc + 1;
    end if;
  end loop;
  return jsonb_build_object('linhas_incluidas', v_inc, 'ignoradas_por_conflito', v_conf);
end $$;
revoke all on function public.campanha_reaplicar(uuid, text) from public, anon;
grant execute on function public.campanha_reaplicar(uuid, text) to authenticated, service_role;

-- 5) Publicar: recusa campanha sem nenhum item elegível (a BKACK FRIDAY foi publicada vazia, sem aviso) ------------------------
create or replace function public.campanha_publicar(p_id uuid, p_ignorar_conflitos boolean default false, p_user text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c campanhas; v_conf jsonb; v_n int; v_ign int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('campanha_publicar'));
  select * into c from campanhas where id = p_id for update;
  if not found then raise exception 'Campanha não encontrada.'; end if;
  if c.status <> 'RASCUNHO' then raise exception 'Só rascunho pode ser publicado (status atual: %).', c.status; end if;
  if c.fim_em <= now() then raise exception 'O prazo da campanha já passou.'; end if;
  if not exists (select 1 from campanha_regras where campanha_id = p_id) then raise exception 'Campanha sem regras.'; end if;

  drop table if exists pg_temp._res;
  create temp table _res on commit drop as select * from campanha_resolver(p_id);
  if not exists (select 1 from _res where pct > 0) then
    raise exception 'NENHUM_ITEM: nenhuma peça elegível (precisa ter preço de venda e não estar vendida/descartada). Confira a auditoria da campanha.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('sku', x.sku, 'campanha_id', o.id, 'campanha', o.nome) order by x.sku), '[]'::jsonb)
    into v_conf
    from (select distinct sku from _res where pct > 0) x
    join (select distinct campanha_id, sku from campanha_itens where desconto_pct > 0) ci on ci.sku = x.sku
    join campanhas o on o.id = ci.campanha_id and o.id <> p_id and o.status = 'PUBLICADA'
     and tstzrange(o.inicio_em, o.fim_em, '[)') && tstzrange(c.inicio_em, c.fim_em, '[)');
  if jsonb_array_length(v_conf) > 0 then
    if not p_ignorar_conflitos then
      raise exception 'CONFLITO_SKU' using errcode = 'P0001', detail = v_conf::text;
    end if;
    select count(distinct e->>'sku') into v_ign from jsonb_array_elements(v_conf) e;
    delete from _res where sku in (select e->>'sku' from jsonb_array_elements(v_conf) e);
    if not exists (select 1 from _res where pct > 0) then
      raise exception 'NENHUM_ITEM: todas as peças elegíveis já estão em outra campanha no mesmo período.' using errcode = 'P0001';
    end if;
  end if;

  perform set_config('campanhas.rpc', '1', true);
  insert into campanha_itens (campanha_id, sku, canal, preco_cheio, desconto_pct, regra_tipo)
    select p_id, sku, canal, preco_cheio, pct, regra_tipo from _res;
  get diagnostics v_n = row_count;
  update campanhas set status = 'PUBLICADA' where id = p_id;
  perform set_config('campanhas.rpc', '', true);
  return jsonb_build_object('linhas', v_n, 'skus_ignorados', v_ign, 'conflitos', v_conf);
end $$;

-- Rollback (manual): recriar campanha_resolver/campanha_publicar da 20261107150000; drop trigger trg_campanha_itens_log on campanha_itens;
--   drop trigger trg_campanhas_log on campanhas; drop function trg_campanha_log(), campanha_auditar(uuid,text), campanha_incluir_itens(uuid,text[],numeric,text),
--   campanha_remover_item(uuid,text,text), campanha_reaplicar(uuid,text), campanha_resolver_base(uuid,boolean); drop table campanha_log;
