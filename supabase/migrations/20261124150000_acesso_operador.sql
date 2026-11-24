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
do $$ begin
  alter default privileges for role postgres in schema public revoke all on tables from anon;
  alter default privileges for role postgres in schema public revoke all on sequences from anon;
  alter default privileges for role supabase_admin in schema public revoke all on tables from anon;
  alter default privileges for role supabase_admin in schema public revoke all on sequences from anon;
exception when others then raise notice 'default privileges não ajustados (%).', sqlerrm; end $$;

-- 2) reservas só por RPC ---------------------------------------------------------------------------------------------
revoke insert, update, delete on public.reservas from authenticated;

-- 3) validação de dados em orcamentos --------------------------------------------------------------------------------
create or replace function public.orc_total_itens(p_itens jsonb, p_pct numeric) returns numeric
language sql immutable as $$
  select round(x.s, 2) - round(x.s * least(90, greatest(0, coalesce(p_pct, 0))) / 100, 2)
    from (select coalesce(sum((e->>'preco')::numeric) filter (where (e->>'preco')::numeric > 0), 0) as s
            from jsonb_array_elements(case when jsonb_typeof(p_itens) = 'array' then p_itens else '[]'::jsonb end) e) x
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
  if coalesce(v_base, 0) <= 0 then return null; end if;   -- sem preço de tabela não há piso (separar já recusa item sem preço)
  begin
    select min(preco_cheio), coalesce(max(desconto_pct), 0) into v_cheio, v_desc from campanha_itens where sku = p_sku;
  exception when undefined_table then v_cheio := null; v_desc := 0; end;
  return round(least(v_base, coalesce(v_cheio, v_base)) * (1 - least(coalesce(v_desc, 0), 90) / 100) - 1, 2);
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
    if new.origem = 'whatsapp' and new.status <> 'ABERTA' then
      raise exception 'Sacola nova só pode nascer ABERTA.' using errcode = '42501';
    end if;
    if coalesce(new.desconto_pct, 0) <> 0 then
      raise exception 'Só Bárbara, Valentina e Pedro dão desconto.' using errcode = '42501';
    end if;
  else
    if coalesce(new.desconto_pct, 0) <> coalesce(old.desconto_pct, 0) then
      raise exception '%: só Bárbara, Valentina e Pedro mudam o desconto.', old.codigo using errcode = '42501';
    end if;
    if old.origem = 'whatsapp' and new.status is distinct from old.status
       and (old.status, new.status) not in (('ABERTA','VENDIDO'), ('ABERTA','ENTREGUE'), ('VENDIDO','ENTREGUE'), ('EXPIRADO','ABERTA'), ('ABERTA','CANCELADO')) then
      raise exception '%: mudança de % para % não é permitida.', old.codigo, old.status, new.status using errcode = '42501';
    end if;
  end if;

  if new.origem = 'whatsapp' and jsonb_typeof(new.itens) = 'array' then
    v_antigos := case when tg_op = 'UPDATE' and jsonb_typeof(old.itens) = 'array' then old.itens else '[]'::jsonb end;
    for e in select value from jsonb_array_elements(new.itens) loop
      continue when exists (select 1 from jsonb_array_elements(v_antigos) x where x->>'sku' = e->>'sku' and (x->>'preco') is not distinct from (e->>'preco'));
      v_piso := public.orc_piso_item(e->>'sku');
      if v_piso is not null and coalesce((e->>'preco')::numeric, 0) < v_piso then
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

-- ROLLBACK (manual):
--   drop trigger if exists trg_orcamentos_guarda_dados on public.orcamentos; drop function if exists public.orcamentos_guarda_dados();
--   drop function if exists public.orc_piso_item(text);
--   grant insert, update, delete on public.reservas to authenticated;
--   (anon: grant select, insert, update, delete on <tabela> to anon — só se algo público realmente precisar)
