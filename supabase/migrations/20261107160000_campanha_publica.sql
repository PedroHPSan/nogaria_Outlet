-- Campanhas (F3): página pública /promo/<slug> e texto do preview (og). Depende de 20261107150000_campanhas.sql.
-- ⚠️ NÃO aplicar em produção sem OK de Pedro OU Bárbara (via MCP apply_migration).
-- Idempotente e só aditiva. O anon só executa estas duas RPCs, por slug exato (sem listar campanhas).
--
-- campanha_publica(slug): { agora, estado, nome, inicio_em, fim_em, contato, itens[] }.
--  * só campanhas PUBLICADAS; rascunho/cancelada → null; encerrada há mais de 7 dias → null.
--  * itens = peças publicadas no catálogo (têm foto pública) que a campanha cobre no canal whatsapp com desconto > 0.
--  * promo só é exposta com a campanha ATIVA (agora ∈ [início, fim)); antes/depois mostra o preço atual cheio.
--  * `agora` é o relógio do banco: o cliente calcula a contagem por diferença para o próprio relógio.
create or replace function public.campanha_publica(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c campanhas; v_estado text; v_em timestamptz; v_itens jsonb; v_contato jsonb;
begin
  select * into c from campanhas where slug = p_slug and status = 'PUBLICADA';
  if not found then return null; end if;
  v_estado := case when now() < c.inicio_em then 'agendada' when now() < c.fim_em then 'ativa' else 'encerrada' end;
  if v_estado = 'encerrada' and now() > c.fim_em + interval '7 days' then return null; end if;
  -- instante usado para decidir QUEM está na campanha (dentro da janela, mesmo antes de começar/depois de acabar)
  v_em := least(greatest(now(), c.inicio_em), c.fim_em - interval '1 millisecond');

  select coalesce(jsonb_agg(x.j order by x.macro, x.nome), '[]'::jsonb), (array_agg(x.contato))[1]
    into v_itens, v_contato
    from (
      select cat.macro, coalesce(i.produto, l.sku) as nome, l.payload->'contato' as contato,
             (l.payload->'itens'->0)
               || jsonb_build_object(
                    'sku', l.sku,
                    'preco', case when v_estado = 'ativa' then pe.preco else i.preco_ideal end,
                    'preco_cheio', case when v_estado = 'ativa' then pe.preco_cheio end,
                    'desconto_pct', case when v_estado = 'ativa' then pe.desconto_pct end,
                    'disponivel', item_disponivel(l.sku) and canal_ativo('whatsapp')) as j
        from (select distinct sku from campanha_itens where campanha_id = c.id and desconto_pct > 0) ci
        join listing_state l on l.sku = ci.sku and l.canal = 'whatsapp' and l.estado = 'publicado'
        join itens i on i.sku = ci.sku
        cross join lateral catalogo_categoria(i.grupo) cat
        cross join lateral (select * from precos_efetivos(array[ci.sku], 'whatsapp', v_em)) pe
       where pe.campanha_id = c.id and pe.desconto_pct > 0 and jsonb_typeof(l.payload->'itens') = 'array'
       limit 200
    ) x;

  return jsonb_build_object('agora', now(), 'estado', v_estado, 'nome', c.nome,
                            'inicio_em', c.inicio_em, 'fim_em', c.fim_em, 'contato', v_contato, 'itens', v_itens);
end $$;
revoke all on function public.campanha_publica(text) from public;
grant execute on function public.campanha_publica(text) to anon, authenticated, service_role;

-- Preview (og) do link: SEM preço (o WhatsApp guarda a prévia em cache; o preço pode mudar ao encerrar antes do prazo).
create or replace function public.campanha_og(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c campanhas; v_max numeric; v_img text;
begin
  select * into c from campanhas where slug = p_slug and status = 'PUBLICADA';
  if not found or now() > c.fim_em + interval '7 days' then return null; end if;
  select max(ci.desconto_pct) into v_max from campanha_itens ci where ci.campanha_id = c.id;
  select l.payload->'og'->>'imagem' into v_img
    from campanha_itens ci join listing_state l on l.sku = ci.sku and l.canal = 'whatsapp' and l.estado = 'publicado'
   where ci.campanha_id = c.id and ci.desconto_pct > 0 and l.payload->'og'->>'imagem' is not null
   order by ci.sku limit 1;
  return jsonb_build_object('titulo', c.nome, 'og', jsonb_build_object(
    'titulo', c.nome,
    'descricao', 'Até ' || trim_scale(coalesce(v_max, 0))::text || '% OFF · oferta válida até '
                 || to_char(c.fim_em at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI') || '. Toque para ver as peças.',
    'imagem', v_img));
end $$;
revoke all on function public.campanha_og(text) from public;
grant execute on function public.campanha_og(text) to anon, authenticated, service_role;

-- Rollback (manual): drop function if exists public.campanha_publica(text), public.campanha_og(text);
