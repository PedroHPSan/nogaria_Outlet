-- WhatsApp (issue E1-4): catálogo Meta + página pública permanente por SKU (/i/<sku>).
-- Depende de 20261102120000_omnichannel_base.sql (listing_state ampliada, reservas).
-- ⚠️ NÃO aplicar em produção sem OK de Pedro OU Bárbara (via MCP apply_migration, antes do deploy).
-- Idempotente. Rollback no fim (comentado).
--
-- Modelo: o item entra no catálogo quando alguém o PUBLICA (listing_state canal 'whatsapp', payload = snapshot
-- no formato da oferta /p com UM item). Só item publicado é visível ao anônimo (SKUs são sequenciais: sem
-- publicação não há enumeração). Disponibilidade é calculada AO VIVO (status + reserva), nunca do snapshot.

-- Fotos para o catálogo: bucket público de leitura (a Meta busca a imagem por URL estável).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalogo-meta', 'catalogo-meta', true, 2097152, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;
drop policy if exists auth_subir_catalogo_meta on storage.objects;
create policy auth_subir_catalogo_meta on storage.objects for insert to authenticated with check (bucket_id = 'catalogo-meta');
drop policy if exists auth_atualizar_catalogo_meta on storage.objects;
create policy auth_atualizar_catalogo_meta on storage.objects for update to authenticated
  using (bucket_id = 'catalogo-meta') with check (bucket_id = 'catalogo-meta');

create or replace function public.item_disponivel(p_sku text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from itens i where i.sku = p_sku and i.status not in ('VENDIDO','ENTREGUE','DESCARTE'))
     and not exists (select 1 from reservas r where r.sku = p_sku and r.status = 'ATIVA'
                       and (r.expira_em is null or r.expira_em > now()));
$$;
revoke all on function public.item_disponivel(text) from public, anon, authenticated;
grant execute on function public.item_disponivel(text) to service_role;

-- Publica (ou atualiza) o item no catálogo WhatsApp.
create or replace function public.catalogo_meta_publicar(p_sku text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
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
revoke all on function public.catalogo_meta_publicar(text, jsonb) from public, anon;
grant execute on function public.catalogo_meta_publicar(text, jsonb) to authenticated, service_role;

-- Retira do catálogo: a página /i/<sku> passa a "não encontrado" e o item sai do feed.
create or replace function public.catalogo_meta_retirar(p_sku text)
returns void language sql security definer set search_path = public as $$
  update listing_state set estado = 'nao_publicado', pausado_motivo = 'retirado', updated_at = now()
   where sku = p_sku and canal = 'whatsapp';
$$;
revoke all on function public.catalogo_meta_retirar(text) from public, anon;
grant execute on function public.catalogo_meta_retirar(text) to authenticated, service_role;

-- Página pública /i/<sku> (anônimo): só item PUBLICADO; devolve o snapshot + disponibilidade ao vivo.
create or replace function public.item_publico(p_sku text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('payload', l.payload, 'disponivel', item_disponivel(l.sku))
    from listing_state l
   where l.sku = p_sku and l.canal = 'whatsapp' and l.estado = 'publicado';
$$;
revoke all on function public.item_publico(text) from public;
grant execute on function public.item_publico(text) to anon, authenticated, service_role;

-- Feed da Meta (Edge Function, service_role): todos os publicados, com disponibilidade ao vivo.
-- Itens vendidos continuam no feed como "out of stock" (a Meta os marca indisponíveis nas mensagens já enviadas).
create or replace function public.catalogo_meta_feed()
returns table (sku text, payload jsonb, disponivel boolean)
language sql stable security definer set search_path = public as $$
  select l.sku, l.payload, item_disponivel(l.sku) from listing_state l
   where l.canal = 'whatsapp' and l.estado = 'publicado' order by l.sku;
$$;
revoke all on function public.catalogo_meta_feed() from public, anon, authenticated;
grant execute on function public.catalogo_meta_feed() to service_role;

-- ROLLBACK (manual):
-- drop function if exists public.catalogo_meta_feed();
-- drop function if exists public.item_publico(text);
-- drop function if exists public.catalogo_meta_retirar(text);
-- drop function if exists public.catalogo_meta_publicar(text, jsonb);
-- drop function if exists public.item_disponivel(text);
-- drop policy if exists auth_subir_catalogo_meta on storage.objects;
-- drop policy if exists auth_atualizar_catalogo_meta on storage.objects;
