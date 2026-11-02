-- Preço é subjetivo: só entra no catálogo a peça cujo preço a Bárbara VALIDOU (preco_aprovacao = 'APROVADO').
-- ⚠️ Aprovação de schema (Pedro OU Bárbara) antes de aplicar em produção. Idempotente. Rollback no fim.
-- Efeito esperado hoje: elegíveis caem de 1.071 para ~65 (só 65 têm preço validado) até a Bárbara validar pela Fila de preço.
-- Tirar uma oferta é decisão dela: o feed NÃO tira peça publicada só porque a validação mudou (só estoque/etapa/foto/preço/estado).

create or replace function public.catalogo_elegibilidade(p_sku text default null)
returns table (sku text, elegivel boolean, motivos text[])
language sql stable security definer set search_path = public as $$
  select m.sku, cardinality(m.motivos) = 0, m.motivos
    from (
      select i.sku, array_remove(array[
        case when i.status::text in ('VENDIDO','ENTREGUE','DESCARTE') then 'vendido'
             when i.status::text not in ('FOTOGRAFADO','PRECIFICADO','PRONTO','ANUNCIADO') then 'etapa' end,
        case when not exists (select 1 from fotos f where f.sku = i.sku) then 'sem_foto' end,
        case when coalesce(i.preco_ideal, 0) <= 0 then 'sem_preco'
             when i.preco_aprovacao is distinct from 'APROVADO' then 'preco_nao_validado' end,
        case when i.estado is null then 'sem_estado' end,
        case when nullif(trim(i.grupo), '') is null then 'sem_categoria' end,
        case when i.status::text not in ('VENDIDO','ENTREGUE','DESCARTE') and not item_disponivel(i.sku) then 'reservado' end
      ], null) as motivos
        from itens i where p_sku is null or i.sku = p_sku
    ) m
$$;

-- Feed: publicada sai do ar só por estoque/etapa/foto/preço/estado — preço não validado NÃO retira sozinho.
create or replace function public.catalogo_meta_feed()
returns table (sku text, payload jsonb, disponivel boolean)
language sql stable security definer set search_path = public as $$
  select l.sku,
         case when i.preco_ideal > 0 and jsonb_typeof(l.payload->'itens') = 'array'
              then jsonb_set(jsonb_set(l.payload, '{itens,0,preco}', to_jsonb(i.preco_ideal)),
                             '{itens,0,produto}', to_jsonb(coalesce(nullif(trim(i.titulo_anuncio), ''), i.produto, l.sku)))
              else l.payload end,
         coalesce(e.motivos <@ array['preco_nao_validado'], false)
    from listing_state l
    left join itens i on i.sku = l.sku
    left join lateral (select x.motivos from catalogo_elegibilidade(l.sku) x) e on true
   where l.canal = 'whatsapp' and l.estado = 'publicado' order by l.sku;
$$;

create or replace function public.catalogo_painel() returns jsonb
language sql stable security definer set search_path = public as $$
  with e as (
    select x.sku, x.elegivel, x.motivos, i.status::text st from catalogo_elegibilidade(null) x join itens i using (sku)
  ), f as (select * from e where st in ('FOTOGRAFADO','PRECIFICADO','PRONTO','ANUNCIADO')),
  p as (select sku, created_at from listing_state where canal = 'whatsapp' and estado = 'publicado'),
  x as (select sku from listing_state where canal = 'whatsapp' and estado = 'pausado' and pausado_motivo = 'excluido')
  select jsonb_build_object(
    'foto_ok', (select count(*) from f),
    'elegiveis', (select count(*) from f where elegivel),
    'bloqueios', jsonb_build_object(
      'sem_preco', (select count(*) from f where 'sem_preco' = any (motivos)),
      'preco_nao_validado', (select count(*) from f where 'preco_nao_validado' = any (motivos)),
      'sem_categoria', (select count(*) from f where 'sem_categoria' = any (motivos)),
      'sem_estado', (select count(*) from f where 'sem_estado' = any (motivos)),
      'sem_foto', (select count(*) from f where 'sem_foto' = any (motivos)),
      'reservado', (select count(*) from f where 'reservado' = any (motivos))),
    'publicados', (select count(*) from p),
    'publicados_7d', (select count(*) from p where created_at >= now() - interval '7 days'),
    'elegiveis_nao_publicados', (select count(*) from f where elegivel and sku not in (select sku from p) and sku not in (select sku from x)),
    'excluidos', (select count(*) from x),
    'divergentes', (select count(*) from p join e using (sku) where not e.elegivel),
    'atualizado_em', now());
$$;

-- ROLLBACK (manual): recriar catalogo_elegibilidade (20261102240000), catalogo_meta_feed (20261102250000) e catalogo_painel (20261102260000).
