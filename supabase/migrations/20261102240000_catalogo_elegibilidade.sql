-- C1 (#96): regra única de elegibilidade ao catálogo (Foto OK ou além). Espelho em JS: src/lib/catalogoElegibilidade.js.
-- ⚠️ Aprovação de schema (Pedro OU Bárbara) antes de aplicar em produção. Só leitura; idempotente. Rollback no fim.
-- Elegível = status ≥ FOTOGRAFADO (FOTOGRAFADO, PRECIFICADO, PRONTO, ANUNCIADO) + ≥ 1 foto + preco_ideal > 0 + estado
-- + categoria (grupo) + item_disponivel (não vendido, não reservado). `motivos` lista TODOS os bloqueios.

create or replace function public.catalogo_elegibilidade(p_sku text default null)
returns table (sku text, elegivel boolean, motivos text[])
language sql stable security definer set search_path = public as $$
  select m.sku, cardinality(m.motivos) = 0, m.motivos
    from (
      select i.sku, array_remove(array[
        case when i.status::text in ('VENDIDO','ENTREGUE','DESCARTE') then 'vendido'
             when i.status::text not in ('FOTOGRAFADO','PRECIFICADO','PRONTO','ANUNCIADO') then 'etapa' end,
        case when not exists (select 1 from fotos f where f.sku = i.sku) then 'sem_foto' end,
        case when coalesce(i.preco_ideal, 0) <= 0 then 'sem_preco' end,
        case when i.estado is null then 'sem_estado' end,
        case when nullif(trim(i.grupo), '') is null then 'sem_categoria' end,
        case when i.status::text not in ('VENDIDO','ENTREGUE','DESCARTE') and not item_disponivel(i.sku) then 'reservado' end
      ], null) as motivos
        from itens i where p_sku is null or i.sku = p_sku
    ) m
$$;
revoke all on function public.catalogo_elegibilidade(text) from public, anon;
grant execute on function public.catalogo_elegibilidade(text) to authenticated, service_role;

-- ROLLBACK (manual):
-- drop function if exists public.catalogo_elegibilidade(text);
