-- Campanhas de promoção (F1): núcleo no banco. Spec: docs/superpowers/specs/2026-11-07-campanhas-promocao-design.md
-- ⚠️ NÃO aplicar em produção sem OK de Pedro OU Bárbara (via MCP apply_migration).
-- Idempotente e só aditiva. Rollback no fim do arquivo (comentado).
--
-- Modelo: a equipe monta REGRAS (rascunho). Ao PUBLICAR, as regras são resolvidas uma vez e o resultado
-- (preço "de" congelado + % por SKU/canal) é gravado em campanha_itens. O preço efetivo é só uma consulta a
-- campanha_itens com now() do banco — o servidor é a autoridade, o relógio do cliente nunca decide.
-- Várias campanhas podem estar ativas ao mesmo tempo, mas um SKU só pode estar em UMA por vez (checado em campanha_publicar).

-- 1) Tabelas ---------------------------------------------------------------------------------------------------------
create table if not exists public.campanhas (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  nome          text not null check (length(trim(nome)) between 3 and 80),
  inicio_em     timestamptz not null,
  fim_em        timestamptz not null,
  fim_previsto  timestamptz,                               -- fim original, quando encerrada antes do prazo
  status        text not null default 'RASCUNHO' check (status in ('RASCUNHO','PUBLICADA','CANCELADA')),
  arredondamento text not null default 'centavos' check (arredondamento in ('centavos','inteiro','vitrine_90')),
  criado_por    text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (fim_em > inicio_em)
);

create table if not exists public.campanha_regras (
  id           uuid primary key default gen_random_uuid(),
  campanha_id  uuid not null references public.campanhas(id) on delete cascade,
  tipo         text not null check (tipo in ('item','grupo','macro','lote','estado','geral')),
  alvo         text,                                        -- sku | grupo oficial | macro | lote | estado; nulo só em 'geral'
  canal        text references public.canais(codigo),       -- nulo = todos os canais
  desconto_pct numeric(5,2) not null check (desconto_pct >= 0 and desconto_pct <= 90),  -- 0 = EXCLUI o alvo
  check ((tipo = 'geral') = (alvo is null))
);
create unique index if not exists uq_campanha_regra
  on public.campanha_regras (campanha_id, tipo, coalesce(alvo, ''), coalesce(canal, ''));

-- Resultado congelado da publicação. canal '*' = todos os canais; linha por canal só quando há regra específica.
create table if not exists public.campanha_itens (
  campanha_id  uuid not null references public.campanhas(id) on delete cascade,
  sku          text not null references public.itens(sku) on delete cascade,
  canal        text not null default '*',
  preco_cheio  numeric(12,2) not null,                      -- "de" congelado na publicação
  desconto_pct numeric(5,2) not null,                       -- 0 = excluído neste canal
  regra_tipo   text not null,
  primary key (campanha_id, sku, canal)
);
create index if not exists idx_campanha_itens_sku on public.campanha_itens (sku);

-- 2) RLS (equipe única; anon não tem nenhum acesso às tabelas) -------------------------------------------------------
alter table public.campanhas enable row level security;
alter table public.campanha_regras enable row level security;
alter table public.campanha_itens enable row level security;
drop policy if exists campanhas_equipe on public.campanhas;
create policy campanhas_equipe on public.campanhas for all to authenticated using (true) with check (true);
drop policy if exists campanha_regras_equipe on public.campanha_regras;
create policy campanha_regras_equipe on public.campanha_regras for all to authenticated using (true) with check (true);
drop policy if exists campanha_itens_ler on public.campanha_itens;
create policy campanha_itens_ler on public.campanha_itens for select to authenticated using (true);
revoke all on public.campanhas, public.campanha_regras, public.campanha_itens from anon;
revoke insert, update, delete on public.campanha_itens from authenticated;   -- só as RPCs (security definer) escrevem

-- 3) Guardas: status e prazo só mudam por RPC; regras só no rascunho --------------------------------------------------
create or replace function public.campanhas_guarda() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('campanhas.rpc', true), '') = '1' then
    new.atualizado_em := now();
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'RASCUNHO' then
      raise exception 'Campanha % já foi publicada/cancelada; não pode ser apagada (use encerrar).', old.nome;
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'RASCUNHO' or new.fim_previsto is not null then
      raise exception 'Campanha nasce como rascunho; publique pela ação de publicar.';
    end if;
  else
    if old.status <> 'RASCUNHO' then
      raise exception 'Campanha % já foi publicada/cancelada; só pode ser encerrada ou duplicada.', old.nome;
    end if;
    if new.status <> old.status or new.fim_previsto is distinct from old.fim_previsto then
      raise exception 'Mudança de status só pelas ações de publicar/encerrar/cancelar.';
    end if;
  end if;
  new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists trg_campanhas_guarda on public.campanhas;
create trigger trg_campanhas_guarda before insert or update or delete on public.campanhas
  for each row execute function public.campanhas_guarda();

create or replace function public.campanha_regras_guarda() returns trigger
language plpgsql set search_path = public as $$
begin
  -- confere a campanha de origem (old) e a de destino (new): não dá para mover regra de/para campanha publicada
  if exists (select 1 from campanhas c
              where c.status <> 'RASCUNHO'
                and c.id in (case when tg_op <> 'INSERT' then old.campanha_id end,
                             case when tg_op <> 'DELETE' then new.campanha_id end)) then
    raise exception 'Regras só podem ser alteradas em campanha rascunho.';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_campanha_regras_guarda on public.campanha_regras;
create trigger trg_campanha_regras_guarda before insert or update or delete on public.campanha_regras
  for each row execute function public.campanha_regras_guarda();

-- 4) Arredondamento ---------------------------------------------------------------------------------------------------
create or replace function public.campanha_arredondar(p_valor numeric, p_modo text)
returns numeric language sql immutable set search_path = public as $$
  select case
    when p_modo = 'inteiro' and round(p_valor) >= 1 then round(p_valor)
    when p_modo = 'vitrine_90' and floor(p_valor) >= 1 then floor(p_valor) - 0.10
    else round(p_valor, 2)
  end;
$$;

-- 5) Resolução das regras → (sku, canal, pct). Itens elegíveis: com preço e ainda à venda. ------------------------------
-- Camadas: item 1 · grupo 2 · macro 3 · lote/estado 4 · geral com canal 5 · geral 6.
-- Dentro da camada: regra do canal do contexto vence regra sem canal; empate restante → MENOR desconto.
create or replace function public.campanha_resolver(p_campanha uuid)
returns table (sku text, canal text, preco_cheio numeric, pct numeric, regra_tipo text)
language sql stable security definer set search_path = public as $$
  with ctx as (
    select '*'::text as canal
    union select r.canal from campanha_regras r where r.campanha_id = p_campanha and r.canal is not null
  ), it as (
    select i.sku, i.preco_ideal, i.lote, i.estado::text as estado, c.grupo as grupo_norm, c.macro
      from itens i
      cross join lateral catalogo_categoria(i.grupo) c
     where coalesce(i.preco_ideal, 0) > 0
       and i.status in ('PRECIFICADO','PRONTO','ANUNCIADO')
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
revoke all on function public.campanha_resolver(uuid) from public, anon;
grant execute on function public.campanha_resolver(uuid) to authenticated, service_role;

-- 6) Simulação (rascunho ou publicada) — mostra o preço, a regra e o conflito com outra campanha ----------------------------
create or replace function public.campanha_simular(p_id uuid, p_canal text default '*')
returns table (sku text, preco_cheio numeric, desconto_pct numeric, preco numeric, regra_tipo text,
               conflito_campanha uuid, conflito_nome text)
language sql stable security definer set search_path = public as $$
  with c as (select * from campanhas where id = p_id), r as (
    select x.* from campanha_resolver(p_id) x
     where x.canal = p_canal
        or (x.canal = '*' and not exists (select 1 from campanha_resolver(p_id) y where y.sku = x.sku and y.canal = p_canal))
  )
  select r.sku, r.preco_cheio, r.pct,
         case when r.pct > 0 then least(campanha_arredondar(r.preco_cheio * (1 - r.pct / 100), c.arredondamento), r.preco_cheio)
              else r.preco_cheio end,
         r.regra_tipo, k.id, k.nome
    from r cross join c
    left join lateral (
      select o.id, o.nome from campanha_itens ci join campanhas o on o.id = ci.campanha_id
       where ci.sku = r.sku and ci.desconto_pct > 0 and r.pct > 0 and o.id <> p_id and o.status = 'PUBLICADA'
         and tstzrange(o.inicio_em, o.fim_em, '[)') && tstzrange(c.inicio_em, c.fim_em, '[)')
       limit 1) k on true
   order by r.sku;
$$;
revoke all on function public.campanha_simular(uuid, text) from public, anon;
grant execute on function public.campanha_simular(uuid, text) to authenticated, service_role;

-- 7) Publicar: resolve, confere conflito de SKU entre campanhas e congela ---------------------------------------------------
-- p_ignorar_conflitos = true → os SKUs em conflito ficam FORA desta campanha (decisão da equipe); false → recusa e lista.
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
  end if;

  perform set_config('campanhas.rpc', '1', true);
  insert into campanha_itens (campanha_id, sku, canal, preco_cheio, desconto_pct, regra_tipo)
    select p_id, sku, canal, preco_cheio, pct, regra_tipo from _res;
  get diagnostics v_n = row_count;
  update campanhas set status = 'PUBLICADA' where id = p_id;
  perform set_config('campanhas.rpc', '', true);
  return jsonb_build_object('linhas', v_n, 'skus_ignorados', v_ign, 'conflitos', v_conf);
end $$;
revoke all on function public.campanha_publicar(uuid, boolean, text) from public, anon;
grant execute on function public.campanha_publicar(uuid, boolean, text) to authenticated, service_role;

-- 8) Encerrar antes do prazo / cancelar -------------------------------------------------------------------------------------
create or replace function public.campanha_encerrar(p_id uuid, p_user text default null)
returns campanhas language plpgsql security definer set search_path = public as $$
declare c campanhas;
begin
  select * into c from campanhas where id = p_id for update;
  if not found then raise exception 'Campanha não encontrada.'; end if;
  perform set_config('campanhas.rpc', '1', true);
  if c.status = 'RASCUNHO' then
    update campanhas set status = 'CANCELADA' where id = p_id returning * into c;
  elsif c.status = 'PUBLICADA' then
    if c.inicio_em >= now() then   -- ainda não começou: cancela de vez
      update campanhas set status = 'CANCELADA', fim_previsto = c.fim_em where id = p_id returning * into c;
    elsif c.fim_em > now() then
      update campanhas set fim_previsto = c.fim_em, fim_em = now() where id = p_id returning * into c;
    end if;
  else
    raise exception 'Campanha já cancelada.';
  end if;
  perform set_config('campanhas.rpc', '', true);
  return c;
end $$;
revoke all on function public.campanha_encerrar(uuid, text) from public, anon;
grant execute on function public.campanha_encerrar(uuid, text) to authenticated, service_role;

-- 9) FONTE ÚNICA do preço efetivo -------------------------------------------------------------------------------------------
-- Sem promo vigente devolve o preço_ideal e campanha_id nulo. Só authenticated/service_role: p_em permitiria "viajar no tempo".
create or replace function public.precos_efetivos(p_skus text[], p_canal text default 'whatsapp', p_em timestamptz default now())
returns table (sku text, preco_cheio numeric, preco numeric, desconto_pct numeric,
               campanha_id uuid, campanha_nome text, campanha_fim timestamptz)
language sql stable security definer set search_path = public as $$
  select i.sku,
         coalesce(p.preco_cheio, i.preco_ideal),
         case when p.pct > 0 then least(campanha_arredondar(p.preco_cheio * (1 - p.pct / 100), p.arred), p.preco_cheio)
              else coalesce(p.preco_cheio, i.preco_ideal) end,
         case when p.pct > 0 then p.pct else 0 end,
         case when p.pct > 0 then p.cid end,
         case when p.pct > 0 then p.nome end,
         case when p.pct > 0 then p.fim_em end
    from itens i
    left join lateral (
      select ci.preco_cheio, ci.desconto_pct as pct, c.id as cid, c.nome, c.fim_em, c.arredondamento as arred
        from campanha_itens ci join campanhas c on c.id = ci.campanha_id
       where ci.sku = i.sku and ci.canal in (p_canal, '*')
         and c.status = 'PUBLICADA' and p_em >= c.inicio_em and p_em < c.fim_em
       order by (ci.canal = p_canal) desc, c.inicio_em desc
       limit 1) p on true
   where i.sku = any (p_skus);
$$;
revoke all on function public.precos_efetivos(text[], text, timestamptz) from public, anon;
grant execute on function public.precos_efetivos(text[], text, timestamptz) to authenticated, service_role;

-- Rollback (manual):
--   drop function if exists precos_efetivos(text[], text, timestamptz), campanha_encerrar(uuid, text),
--     campanha_publicar(uuid, boolean, text), campanha_simular(uuid, text), campanha_resolver(uuid),
--     campanha_arredondar(numeric, text), campanhas_guarda(), campanha_regras_guarda() cascade;
--   drop table if exists campanha_itens, campanha_regras, campanhas;
