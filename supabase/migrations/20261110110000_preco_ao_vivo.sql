-- Preço ao vivo: alterar `itens.preco_ideal` passa a valer na hora nas campanhas em andamento e nos links já enviados.
-- Depende de 20261107150000, 20261107170000 e 20261108110000. ⚠️ NÃO aplicar em produção sem OK de Pedro OU Bárbara (via MCP apply_migration).
-- Idempotente. Rollback no fim.
--
-- Por que o preço novo não aparecia (10/11/2026): a BLACK FRIDAY cobre ~1.800 peças no WhatsApp e o preço efetivo de toda
-- superfície (cards, /p, /i, /promo, sacola, feed da Meta) sai de `campanha_itens.preco_cheio`, congelado na publicação.
-- Quem mudava o preço na ficha via o valor antigo com desconto (ex.: 29,07 → 57,00 continuava saindo por 23,26).
-- Fora de campanha, /p e /i mostravam o preço gravado no snapshot do link/da publicação.

-- 1) Campanha em andamento ou agendada acompanha o preço da ficha -----------------------------------------------------------
-- O "de" deixa de ser congelado para peças ainda à venda; campanha encerrada e peça vendida ficam como estavam (histórico).
create or replace function public.trg_itens_preco_campanha() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_user text := coalesce(nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''), current_user);
begin
  if coalesce(new.preco_ideal, 0) > 0 and new.status::text not in ('VENDIDO', 'ENTREGUE', 'DESCARTE') then
    with alvo as (
      select ci.campanha_id, ci.canal, ci.preco_cheio as antes
        from campanha_itens ci join campanhas k on k.id = ci.campanha_id
       where ci.sku = new.sku and k.status = 'PUBLICADA' and k.fim_em > now() and ci.preco_cheio is distinct from new.preco_ideal
    ), upd as (
      update campanha_itens ci set preco_cheio = new.preco_ideal
        from alvo a where ci.campanha_id = a.campanha_id and ci.sku = new.sku and ci.canal = a.canal
      returning ci.campanha_id, ci.canal, a.antes
    )
    insert into campanha_log (campanha_id, sku, acao, detalhe, usuario)
      select campanha_id, new.sku, 'preco_atualizado', jsonb_build_object('canal', canal, 'de', antes, 'para', new.preco_ideal), v_user from upd;
  end if;
  return null;
end $$;
drop trigger if exists trg_itens_preco_campanha on public.itens;
create trigger trg_itens_preco_campanha after update of preco_ideal on public.itens
  for each row when (old.preco_ideal is distinct from new.preco_ideal)
  execute function public.trg_itens_preco_campanha();

-- Acerto único: peças cujo preço já mudou depois da publicação da campanha (26 em produção em 10/11/2026).
with upd as (
  update campanha_itens ci set preco_cheio = i.preco_ideal
    from campanhas k, itens i
   where k.id = ci.campanha_id and i.sku = ci.sku and k.status = 'PUBLICADA' and k.fim_em > now()
     and coalesce(i.preco_ideal, 0) > 0 and i.status::text not in ('VENDIDO', 'ENTREGUE', 'DESCARTE')
     and ci.preco_cheio is distinct from i.preco_ideal
  returning ci.campanha_id, ci.sku, ci.canal, i.preco_ideal
)
insert into campanha_log (campanha_id, sku, acao, detalhe, usuario)
  select campanha_id, sku, 'preco_atualizado', jsonb_build_object('canal', canal, 'para', preco_ideal, 'origem', 'acerto_migration'), 'migration' from upd;

-- 2) /i/<sku>: o preço do payload sai da ficha (como o feed da Meta já faz), não do snapshot da publicação -----------------------
create or replace function public.item_publico(p_sku text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'payload', case when i.preco_ideal > 0 and jsonb_typeof(l.payload->'itens') = 'array' and (l.payload #>> '{itens,0,preco}') is not null
                           then jsonb_set(l.payload, '{itens,0,preco}', to_jsonb(i.preco_ideal)) else l.payload end,
           'disponivel', item_disponivel(l.sku) and canal_ativo('whatsapp'),
           'agora', now(), 'promo', pr.j)
    from listing_state l
    left join itens i on i.sku = l.sku
    left join lateral (
      select jsonb_build_object('preco', pe.preco, 'preco_cheio', pe.preco_cheio, 'desconto_pct', pe.desconto_pct,
                                'fim_em', pe.campanha_fim, 'campanha', pe.campanha_nome) as j
        from precos_efetivos(array[l.sku], 'whatsapp') pe where pe.campanha_id is not null) pr on true
   where l.sku = p_sku and l.canal = 'whatsapp' and l.estado = 'publicado';
$$;

-- 3) /p/<slug> e /c/<slug>: além das promoções (`itens`), devolve o preço cheio ATUAL de cada peça do link (`precos`) -------------
-- `precos` só traz peça cujo snapshot mostra preço (link gerado com "mostrar preço" desligado continua sem preço).
-- Chave nova no JSON: a página antiga ignora; a página nova sem esta migration segue no snapshot.
create or replace function public.oferta_precos(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  with pecas as (
    select s.sku, bool_or(s.com_preco) as com_preco
      from catalogos_publicos c
      cross join lateral (
        select e->>'sku' as sku, (e->>'preco') is not null as com_preco
          from jsonb_array_elements(case when jsonb_typeof(c.payload->'itens') = 'array' then c.payload->'itens' else '[]'::jsonb end) e
        union all
        select k->>'sku', (k->>'preco') is not null
          from jsonb_array_elements(case when jsonb_typeof(c.payload->'secoes') = 'array' then c.payload->'secoes' else '[]'::jsonb end) sc
          cross join lateral jsonb_array_elements(case when jsonb_typeof(sc->'cards') = 'array' then sc->'cards' else '[]'::jsonb end) k
      ) s
     where c.slug = p_slug and c.expira_em > now() and s.sku is not null
     group by s.sku
  )
  select jsonb_build_object(
           'agora', now(),
           'itens', coalesce(jsonb_object_agg(pe.sku, jsonb_build_object('preco', pe.preco, 'preco_cheio', pe.preco_cheio, 'desconto_pct', pe.desconto_pct,
                                                                         'fim_em', pe.campanha_fim, 'campanha', pe.campanha_nome))
                               filter (where pe.campanha_id is not null), '{}'::jsonb),
           'precos', coalesce(jsonb_object_agg(pe.sku, pe.preco_cheio) filter (where p.com_preco and pe.preco_cheio > 0), '{}'::jsonb))
    from pecas p
    join lateral precos_efetivos(array[p.sku], 'whatsapp') pe on true;
$$;
revoke all on function public.oferta_precos(text) from public;
grant execute on function public.oferta_precos(text) to anon, authenticated, service_role;

-- 4) Pedido em €: a base é o preço atual da peça (promoção vigente ou preço da ficha); o snapshot só decide se o link mostra preço ----
create or replace function public.registrar_interesse(p_slug text, p_sku text, p_lang text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_preco numeric;
  v_atual numeric;
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
  select pe.preco into v_atual from precos_efetivos(array[p_sku], 'whatsapp') pe;
  if v_atual > 0 then v_preco := v_atual; end if;
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

-- Rollback (manual): drop trigger trg_itens_preco_campanha on public.itens; drop function public.trg_itens_preco_campanha();
--   recriar item_publico, oferta_precos e registrar_interesse da 20261107170000. O acerto de preco_cheio fica registrado em
--   campanha_log (acao = 'preco_atualizado', detalhe.de = valor anterior quando veio do gatilho).
