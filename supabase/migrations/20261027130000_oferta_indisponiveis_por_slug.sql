-- Fecha o vazamento de oferta_indisponiveis(text[]): anônimo podia perguntar o status de
-- qualquer SKU. Agora a função recebe o SLUG e só responde sobre os itens daquela oferta
-- (enquanto válida). Aplicada em produção em 2026-10-27 (aprovação de Pedro).
drop function if exists oferta_indisponiveis(text[]);

create or replace function oferta_indisponiveis(p_slug text)
returns setof text language sql stable security definer set search_path = public as $$
  select i.sku
  from catalogos_publicos c
  cross join lateral jsonb_array_elements(case when jsonb_typeof(c.payload->'itens') = 'array' then c.payload->'itens' else '[]'::jsonb end) e
  join itens i on i.sku = e->>'sku'
  where c.slug = p_slug and c.expira_em > now()
    and i.status in ('VENDIDO', 'ENTREGUE')
$$;
revoke all on function oferta_indisponiveis(text) from public;
grant execute on function oferta_indisponiveis(text) to anon, authenticated;
