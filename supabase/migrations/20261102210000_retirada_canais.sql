-- N4 (#87): venda (ou descarte) retira a peça de TODOS os canais onde está publicada, por jobs idempotentes.
-- Substitui o trigger itens_vendido_instagram (que só tratava o Instagram). Depende do worker (sync-canais).
-- ⚠️ Aprovação de schema (Pedro OU Bárbara) antes de aplicar em produção. Idempotente. Rollback no fim.
--
-- Ao ENTRAR em VENDIDO/ENTREGUE/DESCARTE (não ao passar de VENDIDO para ENTREGUE), para cada listing_state
-- 'publicado' do SKU:
--   instagram    → ig.comentar_vendido (comentário "SKU VENDIDO"/"INDISPONÍVEL"; respeita canais.config.comentar_vendido)
--   whatsapp     → catalogo.retirar    (Catalog Batch API: availability=out of stock em segundos; o feed segue como reconciliação)
--   amazon       → amazon.quantidade   (PATCH fulfillment_availability.quantity = 0)
--   mercadolivre → (sem handler ainda; entra no E4)
-- A chave de idempotência inclui o instante da transição: uma 2ª venda depois de reabrir_estoque gera novos jobs.

create or replace function public.itens_retirar_canais() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record; v_comenta boolean; v_motivo text; v_ts text;
  v_final text[] := array['VENDIDO','ENTREGUE','DESCARTE'];
begin
  if not (new.status::text = any (v_final)) or old.status::text = any (v_final) then return new; end if;
  v_motivo := case when new.status::text = 'DESCARTE' then 'indisponivel' else 'vendido' end;
  v_ts := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS');
  select coalesce((config->>'comentar_vendido')::boolean, true) into v_comenta from canais where codigo = 'instagram';

  for r in select canal, external_listing_id from listing_state where sku = new.sku and estado = 'publicado' loop
    if r.canal = 'instagram' then
      if v_comenta and r.external_listing_id is not null then
        perform enfileirar_job('ig.comentar_vendido',
          jsonb_build_object('sku', new.sku, 'media_id', r.external_listing_id, 'motivo', v_motivo),
          'ret:instagram:' || new.sku || ':' || v_ts);
      end if;
    elsif r.canal = 'whatsapp' then
      perform enfileirar_job('catalogo.retirar', jsonb_build_object('sku', new.sku, 'motivo', v_motivo),
        'ret:whatsapp:' || new.sku || ':' || v_ts);
    elsif r.canal = 'amazon' then
      perform enfileirar_job('amazon.quantidade', jsonb_build_object('sku', new.sku, 'quantidade', 0, 'motivo', v_motivo),
        'ret:amazon:' || new.sku || ':' || v_ts);
    end if;
  end loop;

  -- publicação do Instagram cujos itens todos saíram do estoque fica 'esgotado'
  update fila_publicacao p set status = 'esgotado', atualizado_em = now()
   where p.canal = 'instagram' and p.status = 'publicado' and new.sku = any (p.skus)
     and not exists (select 1 from unnest(p.skus) k join itens i on i.sku = k
                      where i.status::text not in ('VENDIDO','ENTREGUE','DESCARTE'));
  return new;
end $$;
revoke all on function public.itens_retirar_canais() from public, anon, authenticated;

drop trigger if exists trg_itens_vendido_instagram on public.itens;
drop function if exists public.itens_vendido_instagram();
drop trigger if exists trg_itens_retirar_canais on public.itens;
create trigger trg_itens_retirar_canais after update of status on public.itens
  for each row execute function public.itens_retirar_canais();

-- ROLLBACK (manual): restaurar itens_vendido_instagram da migration 20261102180000 e recriar trg_itens_vendido_instagram.
-- drop trigger if exists trg_itens_retirar_canais on public.itens; drop function if exists public.itens_retirar_canais();
