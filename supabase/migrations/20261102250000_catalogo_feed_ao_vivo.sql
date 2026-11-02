-- C3 (#98): o feed do catálogo Meta lê preço e título AO VIVO da ficha e a disponibilidade pela regra C1.
-- ⚠️ Aprovação de schema (Pedro OU Bárbara) antes de aplicar em produção. Idempotente. Rollback no fim.
-- listing_state('whatsapp').payload segue sendo o snapshot da publicação (foto, contato, medidas); preço e título
-- vêm de itens. disponivel = elegível (C1): vendido, reservado, sem preço ou fora de Foto OK+ saem como "out of stock".

create or replace function public.catalogo_meta_feed()
returns table (sku text, payload jsonb, disponivel boolean)
language sql stable security definer set search_path = public as $$
  select l.sku,
         case when i.preco_ideal > 0 and jsonb_typeof(l.payload->'itens') = 'array'
              then jsonb_set(jsonb_set(l.payload, '{itens,0,preco}', to_jsonb(i.preco_ideal)),
                             '{itens,0,produto}', to_jsonb(coalesce(nullif(trim(i.titulo_anuncio), ''), i.produto, l.sku)))
              else l.payload end,
         coalesce(e.elegivel, false)
    from listing_state l
    left join itens i on i.sku = l.sku
    left join lateral (select x.elegivel from catalogo_elegibilidade(l.sku) x) e on true
   where l.canal = 'whatsapp' and l.estado = 'publicado' order by l.sku;
$$;
revoke all on function public.catalogo_meta_feed() from public, anon, authenticated;
grant execute on function public.catalogo_meta_feed() to service_role;

-- ROLLBACK (manual): recriar catalogo_meta_feed() com o corpo de 20261102170000_catalogo_meta.sql.
