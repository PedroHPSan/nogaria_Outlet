-- C4 (#99) + C5 (#100): rótulos no feed e retirada/reposição do catálogo em segundos ao RESERVAR/LIBERAR.
-- ⚠️ Aprovação de schema (Pedro OU Bárbara) antes de aplicar em produção. Idempotente. Rollback no fim.
-- (A retirada por VENDA já existe: itens_retirar_canais → catalogo.retirar.)

-- C4: grupo/lote/tamanho/estado vão no payload do item (itens[0].rotulos); o TS monta product_type, custom_label_0..2 e size.
create or replace function public.catalogo_meta_feed()
returns table (sku text, payload jsonb, disponivel boolean)
language sql stable security definer set search_path = public as $$
  select l.sku,
         case when i.preco_ideal > 0 and jsonb_typeof(l.payload->'itens') = 'array'
              then jsonb_set(jsonb_set(jsonb_set(l.payload, '{itens,0,preco}', to_jsonb(i.preco_ideal)),
                             '{itens,0,produto}', to_jsonb(coalesce(nullif(trim(i.titulo_anuncio), ''), i.produto, l.sku))),
                             '{itens,0,rotulos}', jsonb_build_object('grupo', i.grupo, 'lote', i.lote, 'tamanho', i.tamanho, 'estado', i.estado::text))
              else l.payload end,
         coalesce(e.motivos <@ array['preco_nao_validado'], false)
    from listing_state l
    left join itens i on i.sku = l.sku
    left join lateral (select x.motivos from catalogo_elegibilidade(l.sku) x) e on true
   where l.canal = 'whatsapp' and l.estado = 'publicado' order by l.sku;
$$;
revoke all on function public.catalogo_meta_feed() from public, anon, authenticated;
grant execute on function public.catalogo_meta_feed() to service_role;

-- C5: reserva ATIVA de peça publicada no catálogo → catalogo.retirar; reserva liberada/expirada e peça disponível → catalogo.repor.
-- (Venda confirma a reserva: ATIVA→CONFIRMADA não repõe; a retirada fica por conta do trigger de status.)
create or replace function public.reservas_sync_catalogo() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ts text := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS');
begin
  if not exists (select 1 from listing_state where sku = new.sku and canal = 'whatsapp' and estado = 'publicado') then return new; end if;
  if new.status = 'ATIVA' and (tg_op = 'INSERT' or old.status <> 'ATIVA') then
    perform enfileirar_job('catalogo.retirar', jsonb_build_object('sku', new.sku, 'motivo', 'reservado'), 'res:retirar:' || new.sku || ':' || v_ts);
  elsif tg_op = 'UPDATE' and old.status = 'ATIVA' and new.status in ('LIBERADA', 'EXPIRADA') and item_disponivel(new.sku) then
    perform enfileirar_job('catalogo.repor', jsonb_build_object('sku', new.sku), 'res:repor:' || new.sku || ':' || v_ts);
  end if;
  return new;
end $$;
revoke all on function public.reservas_sync_catalogo() from public, anon, authenticated;
drop trigger if exists trg_reservas_sync_catalogo on public.reservas;
create trigger trg_reservas_sync_catalogo after insert or update of status on public.reservas
  for each row execute function public.reservas_sync_catalogo();

-- ROLLBACK (manual):
-- drop trigger if exists trg_reservas_sync_catalogo on public.reservas; drop function if exists public.reservas_sync_catalogo();
-- e recriar catalogo_meta_feed com o corpo de 20261102270000_preco_validado.sql.
