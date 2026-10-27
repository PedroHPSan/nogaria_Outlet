-- Oferta pública (/p/<slug>) com preview no WhatsApp.
-- 1) bucket PÚBLICO só para a imagem de preview já composta (foto + preço); o bucket
--    fotos-produtos segue privado. 2) RPC para o handler de og:* ler só o necessário.
-- 3) RPC que informa quais SKUs da oferta já saíram do estoque.
-- Aplicada em produção em 2026-10-27 (aprovação de Pedro).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('og-previews', 'og-previews', true, 409600, array['image/jpeg', 'image/png'])
on conflict (id) do update set public = true, file_size_limit = 409600, allowed_mime_types = array['image/jpeg', 'image/png'];

drop policy if exists auth_subir_og_previews on storage.objects;
create policy auth_subir_og_previews on storage.objects
  for insert to authenticated with check (bucket_id = 'og-previews');

create or replace function og_publico(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'titulo', titulo,
    'edicao', edicao,
    'total', payload->'totalItens',
    'og', payload->'og'
  )
  from catalogos_publicos
  where slug = p_slug and expira_em > now()
$$;
revoke all on function og_publico(text) from public;
grant execute on function og_publico(text) to anon, authenticated;

create or replace function oferta_indisponiveis(p_skus text[])
returns setof text language sql stable security definer set search_path = public as $$
  select sku from itens
  where sku = any (p_skus[1:50]) and status in ('VENDIDO', 'ENTREGUE')
$$;
revoke all on function oferta_indisponiveis(text[]) from public;
grant execute on function oferta_indisponiveis(text[]) to anon, authenticated;
