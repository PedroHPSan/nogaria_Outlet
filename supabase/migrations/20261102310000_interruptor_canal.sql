-- N12 (#95): interruptor por canal (canais.ativo) respeitado por reserva, publicação, feed e página pública.
-- ⚠️ Aprovação de schema (Pedro OU Bárbara) antes de aplicar em produção. Idempotente. Rollback no fim.
-- Desativar um canal NÃO derruba retiradas: venda/descarte/"retirar de todos" continuam enfileirando e executando.
-- (Anúncios pagos ainda não existem; o N11 nasce respeitando este interruptor. Amazon: publicar-amazon checa na Edge Function.)

create or replace function public.canal_ativo(p_canal text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select ativo from canais where codigo = p_canal), true);  -- canal desconhecido não bloqueia
$$;
revoke all on function public.canal_ativo(text) from public, anon;
grant execute on function public.canal_ativo(text) to authenticated, service_role;

-- Reserva (bot, sacola, orçamento): recusa canal desativado.
create or replace function public.reservar_item(
  p_sku text, p_canal text, p_origem_tipo text, p_origem_ref text,
  p_expira_em timestamptz default null, p_user text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text; v_r reservas%rowtype;
begin
  if not canal_ativo(p_canal) then
    raise exception '%: o canal % está desativado.', p_sku, p_canal using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('item:' || p_sku));
  select status into v_status from itens where sku = p_sku;
  if not found then raise exception '%: item não encontrado.', p_sku using errcode = 'P0002'; end if;
  if v_status in ('VENDIDO','ENTREGUE','DESCARTE') then
    raise exception '%: fora de estoque.', p_sku using errcode = 'P0001';
  end if;
  perform reservas_expirar(p_sku);
  select * into v_r from reservas where sku = p_sku and status = 'ATIVA';
  if found then
    if v_r.origem_tipo = p_origem_tipo and v_r.origem_ref is not distinct from p_origem_ref then
      update reservas set expira_em = p_expira_em where id = v_r.id;
      return jsonb_build_object('sku', p_sku, 'reserva_id', v_r.id, 'renovada', true);
    end if;
    raise exception '%: já separado em % (%).', p_sku, coalesce(v_r.origem_ref, v_r.origem_tipo), v_r.canal
      using errcode = 'P0001';
  end if;
  insert into reservas (sku, canal, origem_tipo, origem_ref, expira_em, criado_por)
    values (p_sku, p_canal, p_origem_tipo, p_origem_ref, p_expira_em, p_user) returning * into v_r;
  insert into eventos (sku, acao, usuario) values (p_sku, 'reserva:' || p_canal, p_user);
  return jsonb_build_object('sku', p_sku, 'reserva_id', v_r.id, 'renovada', false);
end $$;

-- Publicar no catálogo WhatsApp: recusa com o canal desativado.
create or replace function public.catalogo_meta_publicar(p_sku text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not canal_ativo('whatsapp') then raise exception 'O canal WhatsApp está desativado.'; end if;
  if not exists (select 1 from itens where sku = p_sku) then raise exception '%: item não encontrado.', p_sku; end if;
  if not item_disponivel(p_sku) then raise exception '%: indisponível (vendido ou reservado).', p_sku; end if;
  if jsonb_typeof(p_payload->'itens') <> 'array' or jsonb_array_length(p_payload->'itens') <> 1
     or p_payload->'itens'->0->>'sku' <> p_sku or coalesce((p_payload->'itens'->0->>'preco')::numeric, 0) <= 0 then
    raise exception 'payload inválido (1 item, mesmo SKU, com preço)';
  end if;
  insert into listing_state (sku, canal, estado, payload, url_publica, precisa_sync, sync_em, updated_at)
  values (p_sku, 'whatsapp', 'publicado', p_payload, '/i/' || p_sku, false, now(), now())
  on conflict (sku, canal) do update
    set estado = 'publicado', payload = excluded.payload, url_publica = excluded.url_publica,
        precisa_sync = false, sync_em = now(), pausado_motivo = null, ultimo_erro = null, updated_at = now();
end $$;

-- Página pública /i/<sku> e feed: com o canal desativado tudo sai como indisponível (não some: a Meta marca "out of stock").
create or replace function public.item_publico(p_sku text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('payload', l.payload, 'disponivel', item_disponivel(l.sku) and canal_ativo('whatsapp'))
    from listing_state l
   where l.sku = p_sku and l.canal = 'whatsapp' and l.estado = 'publicado';
$$;

create or replace function public.catalogo_meta_feed()
returns table (sku text, payload jsonb, disponivel boolean)
language sql stable security definer set search_path = public as $$
  select l.sku,
         case when i.preco_ideal > 0 and jsonb_typeof(l.payload->'itens') = 'array'
              then jsonb_set(jsonb_set(jsonb_set(l.payload, '{itens,0,preco}', to_jsonb(i.preco_ideal)),
                             '{itens,0,produto}', to_jsonb(coalesce(nullif(trim(i.titulo_anuncio), ''), i.produto, l.sku))),
                             '{itens,0,rotulos}', jsonb_build_object('grupo', i.grupo, 'lote', i.lote, 'tamanho', i.tamanho, 'estado', i.estado::text))
              else l.payload end,
         canal_ativo('whatsapp') and coalesce(e.motivos <@ array['preco_nao_validado'], false)
    from listing_state l
    left join itens i on i.sku = l.sku
    left join lateral (select x.motivos from catalogo_elegibilidade(l.sku) x) e on true
   where l.canal = 'whatsapp' and l.estado = 'publicado' order by l.sku;
$$;
revoke all on function public.catalogo_meta_feed() from public, anon, authenticated;
grant execute on function public.catalogo_meta_feed() to service_role;

-- ROLLBACK (manual): recriar reservar_item (20261102130000), catalogo_meta_publicar/item_publico (20261102170000)
-- e catalogo_meta_feed (20261102290000); drop function public.canal_ativo(text).
