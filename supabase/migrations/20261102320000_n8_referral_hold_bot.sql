-- N8 (#91): atribuição de anúncio (referral/ctwa_clid) nos contatos do WhatsApp e reserva do bot visível/assumível pela equipe.
-- ⚠️ Aprovação de schema (Pedro OU Bárbara) antes de aplicar em produção. Idempotente. Rollback no fim.

-- 1) Atribuição: o webhook grava, ao receber mensagem vinda de anúncio Click-to-WhatsApp, o clique que originou a conversa.
--    fep_ate = fim da janela grátis de ponto de entrada de anúncio (72 h do clique); janela_ate (24 h) segue como está.
alter table public.contatos_whatsapp add column if not exists ctwa_clid text;
alter table public.contatos_whatsapp add column if not exists referral_source_id text;     -- id do anúncio/post
alter table public.contatos_whatsapp add column if not exists referral_source_type text;   -- ad | post
alter table public.contatos_whatsapp add column if not exists referral_headline text;
alter table public.contatos_whatsapp add column if not exists referral_em timestamptz;
alter table public.contatos_whatsapp add column if not exists fep_ate timestamptz;

-- 2) Reserva do bot ("carrinho_wa"/"interesse") pode ser ASSUMIDA pela equipe ao criar a sacola (origem 'sacola'):
--    em vez de "já separado", a reserva passa para a sacola com o novo prazo. Só a equipe (sacola) assume; outra origem segue recusada.
--    (Base: reservar_item do N12, com o interruptor de canal.)
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
    if p_origem_tipo = 'sacola' and v_r.origem_tipo in ('carrinho_wa', 'interesse') then
      update reservas set origem_tipo = p_origem_tipo, origem_ref = p_origem_ref, canal = p_canal,
             expira_em = p_expira_em, criado_por = p_user where id = v_r.id;
      insert into eventos (sku, acao, usuario, detalhe) values (p_sku, 'reserva:assumida', p_user, 'do bot (' || coalesce(v_r.criado_por, '?') || ') para ' || coalesce(p_origem_ref, 'sacola'));
      return jsonb_build_object('sku', p_sku, 'reserva_id', v_r.id, 'renovada', false, 'assumida', true);
    end if;
    raise exception '%: já separado em % (%).', p_sku, coalesce(v_r.origem_ref, v_r.origem_tipo), v_r.canal
      using errcode = 'P0001';
  end if;
  insert into reservas (sku, canal, origem_tipo, origem_ref, expira_em, criado_por)
    values (p_sku, p_canal, p_origem_tipo, p_origem_ref, p_expira_em, p_user) returning * into v_r;
  insert into eventos (sku, acao, usuario) values (p_sku, 'reserva:' || p_canal, p_user);
  return jsonb_build_object('sku', p_sku, 'reserva_id', v_r.id, 'renovada', false);
end $$;

-- 3) Reservas ativas do bot, por cliente, para a equipe converter em sacola (tela de sacolas).
create or replace function public.reservas_bot()
returns table (wa_id text, nome text, ctwa boolean, skus text[], produtos text[], expira_em timestamptz)
language sql stable security definer set search_path = public as $$
  select substr(r.criado_por, 4), c.nome, coalesce(c.ctwa_clid is not null, false),
         array_agg(r.sku order by r.sku), array_agg(coalesce(i.produto, r.sku) order by r.sku), min(r.expira_em)
    from reservas r
    left join itens i on i.sku = r.sku
    left join contatos_whatsapp c on c.wa_id = substr(r.criado_por, 4)
   where r.status = 'ATIVA' and r.origem_tipo in ('carrinho_wa', 'interesse') and r.criado_por like 'wa:%'
     and (r.expira_em is null or r.expira_em > now())
   group by substr(r.criado_por, 4), c.nome, c.ctwa_clid
   order by min(r.expira_em)
$$;
revoke all on function public.reservas_bot() from public, anon;
grant execute on function public.reservas_bot() to authenticated, service_role;

-- ROLLBACK (manual): drop function if exists public.reservas_bot(); recriar reservar_item sem a "assumida" (20261102310000);
-- alter table public.contatos_whatsapp drop column if exists ctwa_clid, drop column if exists referral_source_id,
--   drop column if exists referral_source_type, drop column if exists referral_headline, drop column if exists referral_em, drop column if exists fep_ate;
