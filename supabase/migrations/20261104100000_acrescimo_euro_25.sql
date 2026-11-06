-- Acréscimo do preço Europa: 20% -> 25% (mantém em sincronia com ACRESCIMO_EURO em src/lib/precoEuro.js).
drop function if exists public.registrar_interesse(text, text, text, numeric, timestamptz);
create or replace function public.registrar_interesse(p_slug text, p_sku text, p_lang text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_preco numeric;
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
revoke all on function public.registrar_interesse(text, text, text) from public;
grant execute on function public.registrar_interesse(text, text, text) to anon, authenticated;
