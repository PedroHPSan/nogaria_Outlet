-- N1 (#84): trava no banco em itens.status + RPCs de transição (replanejamento omnichannel, Fase 0).
-- ⚠️ Aprovação de schema (Pedro OU Bárbara) antes de aplicar em produção. Aplicar JUNTO do deploy do N2 (app só por RPC).
-- Idempotente. Rollback no fim (comentado).
--
-- Problema: a RLS `auth_full_itens` deixa qualquer sessão gravar `status` direto, e ficha/planilha/conferência faziam isso:
-- vender uma peça que o bot acabou de reservar para outro cliente. Agora: transição PARA ou A PARTIR de
-- VENDIDO/ENTREGUE/DESCARTE só passa por RPC (SECURITY DEFINER). O trigger vigia só chamadas diretas da API
-- (papéis authenticated/anon); service_role, migrations e as RPCs (donas da função) passam.

create or replace function public.itens_guarda_status() returns trigger
language plpgsql as $$
declare v_final text[] := array['VENDIDO','ENTREGUE','DESCARTE'];
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    if new.status::text = any (v_final) then
      raise exception 'status % só pode ser definido por RPC (baixar_venda, marcar_entregue, mover_etapa)', new.status using errcode = '42501';
    end if;
  elsif new.status is distinct from old.status and (new.status::text = any (v_final) or old.status::text = any (v_final)) then
    raise exception 'mudança de status % → % só por RPC (baixar_venda, marcar_entregue, mover_etapa, reabrir_estoque)', old.status, new.status using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_itens_guarda_status on public.itens;
create trigger trg_itens_guarda_status before insert or update of status on public.itens
  for each row execute function public.itens_guarda_status();

-- Move entre etapas da triagem (e para DESCARTE). VENDIDO/ENTREGUE têm RPC própria; sair de VENDIDO/ENTREGUE só por reabrir_estoque.
create or replace function public.mover_etapa(p_sku text, p_para text, p_user text default null, p_de_label text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_atual text;
begin
  perform pg_advisory_xact_lock(hashtext('item:' || p_sku));
  select status::text into v_atual from itens where sku = p_sku;
  if not found then raise exception '%: item não encontrado.', p_sku; end if;
  if p_para in ('VENDIDO', 'ENTREGUE') then
    raise exception '%: use baixar_venda / marcar_entregue para VENDIDO e ENTREGUE.', p_sku; end if;
  if p_para not in ('A_CATALOGAR','TRIADO','TESTADO','FOTOGRAFADO','PRECIFICADO','PRONTO','ANUNCIADO','DESCARTE') then
    raise exception '%: etapa inválida (%).', p_sku, p_para; end if;
  if v_atual in ('VENDIDO', 'ENTREGUE') then
    raise exception '%: item % — use reabrir_estoque para devolvê-lo ao estoque.', p_sku, v_atual; end if;
  if v_atual = p_para then return; end if;
  if p_para in ('ANUNCIADO', 'DESCARTE') then
    perform reservas_expirar(p_sku);
    if not item_disponivel(p_sku) then
      raise exception '%: reservado por alguém — libere a reserva antes de % .', p_sku, p_para; end if;
  end if;
  update itens set status = p_para::item_status, upd_by = p_user where sku = p_sku;
  insert into eventos (sku, acao, usuario, detalhe)
    values (p_sku, 'status:' || p_para, p_user, 'de ' || coalesce(p_de_label, v_atual));
end $$;

create or replace function public.marcar_anunciado(p_sku text, p_user text default null)
returns void language sql security definer set search_path = public as $$
  select public.mover_etapa(p_sku, 'ANUNCIADO', p_user, null);
$$;

-- VENDIDO → ENTREGUE.
create or replace function public.marcar_entregue(p_sku text, p_user text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_atual text;
begin
  perform pg_advisory_xact_lock(hashtext('item:' || p_sku));
  select status::text into v_atual from itens where sku = p_sku;
  if not found then raise exception '%: item não encontrado.', p_sku; end if;
  if v_atual = 'ENTREGUE' then return; end if;
  if v_atual <> 'VENDIDO' then raise exception '%: só item VENDIDO pode ser entregue (status: %).', p_sku, v_atual; end if;
  update itens set status = 'ENTREGUE', entregue_em = now(), upd_by = p_user where sku = p_sku;
  insert into eventos (sku, acao, usuario) values (p_sku, 'status:ENTREGUE', p_user);
end $$;

-- Devolução/cancelamento: VENDIDO|ENTREGUE → etapa não final (padrão PRONTO). Zera os dados da venda (ficam no evento).
-- NÃO republica em canal nenhum; a reserva CONFIRMADA permanece como histórico da venda.
create or replace function public.reabrir_estoque(p_sku text, p_motivo text, p_para text default 'PRONTO', p_user text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_atual text; i itens%rowtype;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'informe o motivo da devolução'; end if;
  if p_para not in ('A_CATALOGAR','TRIADO','TESTADO','FOTOGRAFADO','PRECIFICADO','PRONTO','ANUNCIADO') then
    raise exception 'etapa de destino inválida (%).', p_para; end if;
  perform pg_advisory_xact_lock(hashtext('item:' || p_sku));
  select * into i from itens where sku = p_sku;
  if not found then raise exception '%: item não encontrado.', p_sku; end if;
  v_atual := i.status::text;
  if v_atual not in ('VENDIDO', 'ENTREGUE') then raise exception '%: só item VENDIDO/ENTREGUE pode ser reaberto (status: %).', p_sku, v_atual; end if;
  update itens set status = p_para::item_status, vendido_em = null, entregue_em = null, valor_vendido = null, canal_venda = null,
         canal_codigo = null, comprador = null, pedido_ref = null, taxa_venda = null, frete_pago = null, upd_by = p_user
   where sku = p_sku;
  insert into eventos (sku, acao, usuario, detalhe)
    values (p_sku, 'status:' || p_para, p_user,
            'reaberto de ' || v_atual || ' — ' || trim(p_motivo) || ' | venda anterior: pedido ' || coalesce(i.pedido_ref, '—')
            || ', R$ ' || coalesce(i.valor_vendido::text, '—') || ', canal ' || coalesce(i.canal_venda, '—'));
end $$;

revoke all on function public.mover_etapa(text, text, text, text) from public, anon;
revoke all on function public.marcar_anunciado(text, text) from public, anon;
revoke all on function public.marcar_entregue(text, text) from public, anon;
revoke all on function public.reabrir_estoque(text, text, text, text) from public, anon;
grant execute on function public.mover_etapa(text, text, text, text) to authenticated, service_role;
grant execute on function public.marcar_anunciado(text, text) to authenticated, service_role;
grant execute on function public.marcar_entregue(text, text) to authenticated, service_role;
grant execute on function public.reabrir_estoque(text, text, text, text) to authenticated, service_role;

-- ROLLBACK (manual):
-- drop trigger if exists trg_itens_guarda_status on public.itens; drop function if exists public.itens_guarda_status();
-- drop function if exists public.reabrir_estoque(text, text, text, text); drop function if exists public.marcar_entregue(text, text);
-- drop function if exists public.marcar_anunciado(text, text); drop function if exists public.mover_etapa(text, text, text, text);
