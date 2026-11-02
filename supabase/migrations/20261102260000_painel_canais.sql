-- C6 (#101) + N6 (#89): painel catálogo × triagem e "Retirar de todos" da ficha.
-- ⚠️ Aprovação de schema (Pedro OU Bárbara) antes de aplicar em produção. Idempotente. Rollback no fim.

-- Números do painel (um jsonb): Foto OK+, elegíveis, bloqueios, publicados no catálogo e divergentes (publicado mas não elegível).
create or replace function public.catalogo_painel() returns jsonb
language sql stable security definer set search_path = public as $$
  with e as (
    select x.sku, x.elegivel, x.motivos, i.status::text st from catalogo_elegibilidade(null) x join itens i using (sku)
  ), f as (select * from e where st in ('FOTOGRAFADO','PRECIFICADO','PRONTO','ANUNCIADO')),
  p as (select sku, created_at from listing_state where canal = 'whatsapp' and estado = 'publicado')
  select jsonb_build_object(
    'foto_ok', (select count(*) from f),
    'elegiveis', (select count(*) from f where elegivel),
    'bloqueios', jsonb_build_object(
      'sem_preco', (select count(*) from f where 'sem_preco' = any (motivos)),
      'sem_categoria', (select count(*) from f where 'sem_categoria' = any (motivos)),
      'sem_estado', (select count(*) from f where 'sem_estado' = any (motivos)),
      'sem_foto', (select count(*) from f where 'sem_foto' = any (motivos)),
      'reservado', (select count(*) from f where 'reservado' = any (motivos))),
    'publicados', (select count(*) from p),
    'publicados_7d', (select count(*) from p where created_at >= now() - interval '7 days'),
    'elegiveis_nao_publicados', (select count(*) from f where elegivel and sku not in (select sku from p)),
    'divergentes', (select count(*) from p join e using (sku) where not e.elegivel),
    'atualizado_em', now());
$$;
revoke all on function public.catalogo_painel() from public, anon;
grant execute on function public.catalogo_painel() to authenticated, service_role;

-- Retira a peça de todos os canais onde está publicada SEM mudar o status (a venda usa o trigger). Idempotente por minuto.
create or replace function public.retirar_de_todos(p_sku text, p_user text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0; v_ts text := to_char(now(), 'YYYYMMDDHH24MI'); v_comenta boolean;
begin
  perform pg_advisory_xact_lock(hashtext('item:' || p_sku));
  if not exists (select 1 from itens where sku = p_sku) then raise exception '%: item não encontrado.', p_sku; end if;
  select coalesce((config->>'comentar_vendido')::boolean, true) into v_comenta from canais where codigo = 'instagram';
  for r in select canal, external_listing_id from listing_state where sku = p_sku and estado = 'publicado' loop
    if r.canal = 'instagram' then
      if v_comenta and r.external_listing_id is not null then
        perform enfileirar_job('ig.comentar_vendido', jsonb_build_object('sku', p_sku, 'media_id', r.external_listing_id, 'motivo', 'indisponivel'),
          'man:instagram:' || p_sku || ':' || v_ts);
      end if;
    elsif r.canal = 'whatsapp' then
      perform enfileirar_job('catalogo.retirar', jsonb_build_object('sku', p_sku, 'motivo', 'indisponivel'), 'man:whatsapp:' || p_sku || ':' || v_ts);
      perform catalogo_meta_retirar(p_sku);
    elsif r.canal = 'amazon' then
      perform enfileirar_job('amazon.quantidade', jsonb_build_object('sku', p_sku, 'quantidade', 0, 'motivo', 'manual'), 'man:amazon:' || p_sku || ':' || v_ts);
    else
      continue;
    end if;
    n := n + 1;
  end loop;
  insert into eventos (sku, acao, usuario, detalhe) values (p_sku, 'retirar:todos', p_user, n || ' canal(is)');
  return n;
end $$;
revoke all on function public.retirar_de_todos(text, text) from public, anon;
grant execute on function public.retirar_de_todos(text, text) to authenticated, service_role;

-- ROLLBACK (manual):
-- drop function if exists public.retirar_de_todos(text, text); drop function if exists public.catalogo_painel();
