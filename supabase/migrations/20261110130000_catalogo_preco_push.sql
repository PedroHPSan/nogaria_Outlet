-- Catálogo da Meta em (quase) tempo real: mudança de preço/campanha enfileira o job `catalogo.preco`, que empurra price/sale_price
-- pela Catalog Batch API (items_batch). O feed de hora em hora segue como reconciliação.
-- Depende de 20261107150000 (campanhas), 20261110110000 (preço ao vivo), enfileirar_job e listing_state.
-- ⚠️ NÃO aplicar em produção sem OK de Pedro OU Bárbara (via MCP apply_migration). Sem META_CATALOG_TOKEN/META_CATALOG_ID o handler
-- só registra aviso (o feed reconcilia em até 1 h). Idempotente. Rollback no fim.

-- 1) Preço que a Meta deve mostrar agora, por SKU: mesma regra do feed (catalogo_meta_feed + precoPromoFeed em catalogoMeta.ts) ----------
--   price      = campanha ATIVA → preço cheio da campanha ("de"); senão preço da ficha.
--   sale_price = preço promocional (só se menor que price e com janela); janela no formato da Meta (AAAA-MM-DDTHH:MM-03:00/…).
create or replace function public.catalogo_meta_preco(p_skus text[])
returns table (sku text, price numeric, sale_price numeric, janela text)
language sql stable security definer set search_path = public as $$
  select l.sku,
         case when pr.pct > 0 and now() >= pr.inicio_em then pr.cheio else i.preco_ideal end as price,
         case when v.sale > 0 and v.sale < (case when pr.pct > 0 and now() >= pr.inicio_em then pr.cheio else i.preco_ideal end) then v.sale end as sale_price,
         case when v.sale > 0 and v.sale < (case when pr.pct > 0 and now() >= pr.inicio_em then pr.cheio else i.preco_ideal end)
              then to_char(pr.inicio_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') || '-03:00/'
                   || to_char(pr.fim_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') || '-03:00' end as janela
    from listing_state l
    join itens i on i.sku = l.sku and i.preco_ideal > 0
    left join lateral (
      select ci.preco_cheio as cheio, ci.desconto_pct as pct, k.inicio_em, k.fim_em, k.arredondamento as arred
        from campanha_itens ci join campanhas k on k.id = ci.campanha_id
       where ci.sku = l.sku and ci.canal in ('whatsapp', '*') and k.status = 'PUBLICADA' and k.fim_em > now()
       order by k.inicio_em, (ci.canal = 'whatsapp') desc
       limit 1) pr on true
    left join lateral (
      select case when pr.pct > 0 then least(campanha_arredondar(pr.cheio * (1 - pr.pct / 100), pr.arred), pr.cheio) end as sale) v on true
   where l.canal = 'whatsapp' and l.estado = 'publicado' and l.sku = any (coalesce(p_skus, '{}'))
   order by l.sku;
$$;
revoke all on function public.catalogo_meta_preco(text[]) from public, anon, authenticated;
grant execute on function public.catalogo_meta_preco(text[]) to service_role;

-- 2) Enfileira o push em lotes de 200 SKUs (só peças publicadas no WhatsApp). Sem chave de idempotência fixa: cada mudança gera
--    um job novo e o handler lê o estado ATUAL na hora de executar (mudanças seguidas convergem para o mesmo resultado). -------------------
create or replace function public.catalogo_enfileirar_preco(p_skus text[]) returns void
language plpgsql security definer set search_path = public as $$
declare v text[]; i int := 1; n int;
begin
  select coalesce(array_agg(distinct l.sku order by l.sku), '{}') into v
    from listing_state l where l.canal = 'whatsapp' and l.estado = 'publicado' and l.sku = any (coalesce(p_skus, '{}'));
  n := coalesce(array_length(v, 1), 0);
  while i <= n loop
    perform enfileirar_job('catalogo.preco', jsonb_build_object('skus', to_jsonb(v[i:least(i + 199, n)])),
      'preco:' || md5(clock_timestamp()::text || random()::text || i::text));
    i := i + 200;
  end loop;
end $$;
revoke all on function public.catalogo_enfileirar_preco(text[]) from public, anon, authenticated;

-- 3) Gatilhos --------------------------------------------------------------------------------------------------------------------
-- 3a) preço da ficha mudou
create or replace function public.trg_catalogo_preco_item() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform catalogo_enfileirar_preco(array[new.sku]);
  return null;
end $$;
drop trigger if exists trg_catalogo_preco_item on public.itens;
create trigger trg_catalogo_preco_item after update of preco_ideal on public.itens
  for each row when (old.preco_ideal is distinct from new.preco_ideal)
  execute function public.trg_catalogo_preco_item();

-- 3b) campanha publicada/encerrada ou com janela alterada: todas as peças dela
create or replace function public.trg_catalogo_preco_campanha() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform catalogo_enfileirar_preco((select coalesce(array_agg(distinct ci.sku), '{}') from campanha_itens ci where ci.campanha_id = new.id));
  return null;
end $$;
drop trigger if exists trg_catalogo_preco_campanha on public.campanhas;
create trigger trg_catalogo_preco_campanha after update of status, inicio_em, fim_em on public.campanhas
  for each row when (old.status is distinct from new.status or old.inicio_em is distinct from new.inicio_em or old.fim_em is distinct from new.fim_em)
  execute function public.trg_catalogo_preco_campanha();

-- 3c) peça incluída/removida de campanha PUBLICADA (em campanha em rascunho nada muda no catálogo)
create or replace function public.trg_catalogo_preco_itens_ins() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform catalogo_enfileirar_preco((select coalesce(array_agg(distinct n.sku), '{}') from novas n join campanhas k on k.id = n.campanha_id where k.status = 'PUBLICADA'));
  return null;
end $$;
create or replace function public.trg_catalogo_preco_itens_del() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform catalogo_enfileirar_preco((select coalesce(array_agg(distinct o.sku), '{}') from antigas o join campanhas k on k.id = o.campanha_id where k.status = 'PUBLICADA'));
  return null;
end $$;
drop trigger if exists trg_catalogo_preco_itens_ins on public.campanha_itens;
create trigger trg_catalogo_preco_itens_ins after insert on public.campanha_itens
  referencing new table as novas for each statement execute function public.trg_catalogo_preco_itens_ins();
drop trigger if exists trg_catalogo_preco_itens_del on public.campanha_itens;
create trigger trg_catalogo_preco_itens_del after delete on public.campanha_itens
  referencing old table as antigas for each statement execute function public.trg_catalogo_preco_itens_del();

-- Rollback (manual): drop trigger trg_catalogo_preco_item on public.itens; drop trigger trg_catalogo_preco_campanha on public.campanhas;
--   drop trigger trg_catalogo_preco_itens_ins/_del on public.campanha_itens; drop function public.trg_catalogo_preco_item(),
--   public.trg_catalogo_preco_campanha(), public.trg_catalogo_preco_itens_ins(), public.trg_catalogo_preco_itens_del(),
--   public.catalogo_enfileirar_preco(text[]), public.catalogo_meta_preco(text[]); jobs `catalogo.preco` pendentes: update integracao_jobs
--   set status = 'ok' where tipo = 'catalogo.preco' and status in ('pendente','erro').
