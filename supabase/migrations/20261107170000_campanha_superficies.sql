-- Campanhas (F4): a promoção passa a valer nas superfícies que já existem. Depende de 20261107150000 (F1).
-- ⚠️ NÃO aplicar em produção sem OK de Pedro OU Bárbara (via MCP apply_migration).
-- Idempotente (create or replace). Assinaturas e colunas de saída NÃO mudam (só chaves novas no JSON).
--  * item_publico(/i)      → ganha `promo` e `agora`.
--  * oferta_precos(/p)     → NOVA: preços promocionais ao vivo dos itens de um link /p.
--  * registrar_interesse   → o valor em € parte do preço promocional (Q9: vale para o público Europa).
--  * catalogo_meta_feed    → payload.itens[0].promo = { preco, preco_cheio, ativa, janela } para sale_price na Meta.

-- 1) /i/<sku> ----------------------------------------------------------------------------------------------------------
create or replace function public.item_publico(p_sku text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('payload', l.payload, 'disponivel', item_disponivel(l.sku) and canal_ativo('whatsapp'),
                            'agora', now(), 'promo', pr.j)
    from listing_state l
    left join lateral (
      select jsonb_build_object('preco', pe.preco, 'preco_cheio', pe.preco_cheio, 'desconto_pct', pe.desconto_pct,
                                'fim_em', pe.campanha_fim, 'campanha', pe.campanha_nome) as j
        from precos_efetivos(array[l.sku], 'whatsapp') pe where pe.campanha_id is not null) pr on true
   where l.sku = p_sku and l.canal = 'whatsapp' and l.estado = 'publicado';
$$;

-- 2) /p/<slug>: só devolve itens COM promoção vigente; o resto segue com o preço do snapshot -----------------------------------
create or replace function public.oferta_precos(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('agora', now(), 'itens', coalesce(
           jsonb_object_agg(pe.sku, jsonb_build_object('preco', pe.preco, 'preco_cheio', pe.preco_cheio, 'desconto_pct', pe.desconto_pct,
                                                      'fim_em', pe.campanha_fim, 'campanha', pe.campanha_nome))
             filter (where pe.campanha_id is not null), '{}'::jsonb))
    from catalogos_publicos c
    cross join lateral jsonb_array_elements(case when jsonb_typeof(c.payload->'itens') = 'array' then c.payload->'itens' else '[]'::jsonb end) e
    cross join lateral precos_efetivos(array[e->>'sku'], 'whatsapp') pe
   where c.slug = p_slug and c.expira_em > now();
$$;
revoke all on function public.oferta_precos(text) from public;
grant execute on function public.oferta_precos(text) to anon, authenticated, service_role;

-- 3) Pedido em € (acréscimo de 25% sobre o preço PROMOCIONAL quando houver campanha) -------------------------------------------
create or replace function public.registrar_interesse(p_slug text, p_sku text, p_lang text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_preco numeric;
  v_promo numeric;
  v_brl numeric(12,2);
  v_eur numeric(12,2);
  v_codigo text;
  v_valido timestamptz := now() + interval '24 hours';
  v_taxa numeric(10,4);
  v_taxa_em timestamptz;
begin
  select taxa, em into v_taxa, v_taxa_em from cotacoes where criado_em > now() - interval '15 minutes' order by criado_em desc limit 1;
  if v_taxa is null then raise exception 'sem cotacao recente'; end if;
  select (e->>'preco')::numeric into v_preco
  from catalogos_publicos c
  cross join lateral jsonb_array_elements(case when jsonb_typeof(c.payload->'itens') = 'array' then c.payload->'itens' else '[]'::jsonb end) e
  where c.slug = p_slug and c.expira_em > now() and coalesce((c.payload->>'euro')::boolean, false) and e->>'sku' = p_sku;
  if v_preco is null or v_preco <= 0 then raise exception 'item indisponivel'; end if;
  select pe.preco into v_promo from precos_efetivos(array[p_sku], 'whatsapp') pe where pe.campanha_id is not null;
  v_preco := coalesce(v_promo, v_preco);
  if (select count(*) from interesses where slug = p_slug and criado_em > now() - interval '10 minutes') >= 30 then
    raise exception 'muitos pedidos';
  end if;
  v_brl := round(v_preco * 1.25, 2);
  v_eur := round(v_brl / v_taxa, 2);
  loop
    v_codigo := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 5));
    exit when not exists (select 1 from interesses where codigo = v_codigo);
  end loop;
  insert into interesses (codigo, slug, sku, lang, brl_base, eur, taxa, taxa_em, valido_ate)
  values (v_codigo, p_slug, p_sku, case when p_lang in ('pt', 'en', 'es') then p_lang else 'pt' end, v_preco, v_eur, v_taxa, v_taxa_em, v_valido);
  return jsonb_build_object('codigo', v_codigo, 'eur', v_eur, 'taxa', v_taxa, 'taxa_em', v_taxa_em, 'valido_ate', v_valido);
end $$;

-- 4) Feed da Meta: promo da campanha publicada mais próxima (inclui a agendada: a Meta liga/desliga pela janela) ---------------------
create or replace function public.catalogo_meta_feed()
returns table (sku text, payload jsonb, disponivel boolean)
language sql stable security definer set search_path = public as $$
  select l.sku,
         case when jsonb_typeof(l.payload->'itens') = 'array' then
           jsonb_set(
             jsonb_set(
               case when i.preco_ideal > 0
                    then jsonb_set(jsonb_set(l.payload, '{itens,0,preco}', to_jsonb(i.preco_ideal)),
                                   '{itens,0,produto}', to_jsonb(coalesce(nullif(trim(i.titulo_anuncio), ''), i.produto, l.sku)))
                    else l.payload end,
               '{itens,0,rotulos}',
               (case when i.preco_ideal > 0
                     then jsonb_build_object('grupo', i.grupo, 'lote', i.lote, 'tamanho', i.tamanho, 'estado', i.estado::text)
                     else coalesce(l.payload #> '{itens,0,rotulos}', '{}'::jsonb) end)
               || jsonb_build_object('macro', c.macro, 'grupo_norm', c.grupo)),
             '{itens,0,promo}',
             case when pr.pct > 0 then jsonb_build_object(
                    'preco', least(campanha_arredondar(pr.cheio * (1 - pr.pct / 100), pr.arred), pr.cheio),
                    'preco_cheio', pr.cheio,
                    'ativa', now() >= pr.inicio_em,
                    'janela', to_char(pr.inicio_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') || '-03:00/'
                              || to_char(pr.fim_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') || '-03:00')
                  else 'null'::jsonb end)
         else l.payload end,
         canal_ativo('whatsapp') and coalesce(e.motivos <@ array['preco_nao_validado'], false)
    from listing_state l
    left join itens i on i.sku = l.sku
    cross join lateral catalogo_categoria(i.grupo) c
    left join lateral (select x.motivos from catalogo_elegibilidade(l.sku) x) e on true
    left join lateral (
      select ci.preco_cheio as cheio, ci.desconto_pct as pct, k.inicio_em, k.fim_em, k.arredondamento as arred
        from campanha_itens ci join campanhas k on k.id = ci.campanha_id
       where ci.sku = l.sku and ci.canal in ('whatsapp', '*') and k.status = 'PUBLICADA' and k.fim_em > now()
       order by k.inicio_em, (ci.canal = 'whatsapp') desc
       limit 1) pr on true
   where l.canal = 'whatsapp' and l.estado = 'publicado' order by l.sku;
$$;
revoke all on function public.catalogo_meta_feed() from public, anon, authenticated;
grant execute on function public.catalogo_meta_feed() to service_role;

-- Rollback (manual): recriar item_publico (20261102310000), registrar_interesse (20261104100000) e catalogo_meta_feed
-- (20261106100000); drop function if exists public.oferta_precos(text);
