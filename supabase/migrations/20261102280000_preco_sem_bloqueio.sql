-- Reverte o bloqueio "preço aguardando validação" (20261102270000): peça com preço de venda > 0 pode ir ao catálogo.
-- A Bárbara revisa na última etapa da publicação (lista com aviso) e tira o que quiser. Decisão do Pedro.
-- ⚠️ Aprovação de schema (Pedro OU Bárbara) antes de aplicar em produção. Idempotente.
-- Efeito esperado hoje: elegíveis voltam de 65 para ~1.071.

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

-- ROLLBACK (manual): recriar catalogo_elegibilidade com o corpo de 20261102270000_preco_validado.sql.
