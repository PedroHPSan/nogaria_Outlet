-- Campanhas (F6): resultado realizado de uma campanha. Depende de F1 e F5 (campanha_vendas). Só leitura.
-- ⚠️ NÃO aplicar em produção sem OK de Pedro OU Bárbara (via MCP apply_migration). Idempotente.
--  * no_prazo       → vendas fechadas dentro da campanha (ledger campanha_vendas, decisão 'no_prazo')
--  * depois_do_fim  → fechadas depois do fim: promoção mantida × cobradas a preço cheio × sem decisão
--  * sacolas_abertas→ sacolas ainda a pagar com item da campanha (desconto ainda comprometido)
--  * nao_vendidos   → itens da campanha ainda à venda, fora de sacola aberta
--  * fora_da_sacola → itens da campanha vendidos na janela por outro caminho (sem registro no ledger)
create or replace function public.campanha_resultado(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c campanhas; v jsonb; v_total int; v_aberta jsonb; v_vendas jsonb; v_fora jsonb; v_naovend int;
begin
  select * into c from campanhas where id = p_id;
  if not found then return null; end if;

  select count(distinct sku) into v_total from campanha_itens where campanha_id = p_id and desconto_pct > 0;

  select coalesce(jsonb_object_agg(d.decisao, jsonb_build_object('itens', d.n, 'receita', d.receita, 'desconto', d.desconto)), '{}'::jsonb)
    into v
    from (select decisao, count(*) n, coalesce(sum(valor_vendido), 0) receita,
                 coalesce(sum(preco_cheio - valor_vendido) filter (where valor_vendido is not null and preco_cheio is not null), 0) desconto
            from campanha_vendas where campanha_id = p_id group by decisao) d;

  select jsonb_build_object('sacolas', count(distinct o.id), 'itens', count(*),
           'valor', coalesce(sum((x->>'preco')::numeric), 0),
           'desconto_comprometido', coalesce(sum((x->>'preco_cheio')::numeric - (x->>'preco')::numeric)
                                              filter (where (x->>'preco_cheio') is not null), 0))
    into v_aberta
    from orcamentos o cross join lateral jsonb_array_elements(o.itens) x
   where o.status in ('ABERTA', 'RESERVADO', 'ENVIADO') and x->>'campanha_id' = p_id::text and not (x ? 'campanha_decisao');

  select count(distinct ci.sku) into v_naovend
    from campanha_itens ci join itens i on i.sku = ci.sku
   where ci.campanha_id = p_id and ci.desconto_pct > 0 and i.status not in ('VENDIDO', 'ENTREGUE', 'DESCARTE')
     and not exists (select 1 from orcamentos o cross join lateral jsonb_array_elements(o.itens) x
                      where o.status in ('ABERTA', 'RESERVADO', 'ENVIADO') and x->>'sku' = ci.sku);

  select jsonb_build_object('itens', count(*), 'receita', coalesce(sum(i.valor_vendido), 0))
    into v_fora
    from (select distinct sku from campanha_itens where campanha_id = p_id and desconto_pct > 0) ci
    join itens i on i.sku = ci.sku
   where i.vendido_em >= c.inicio_em and i.vendido_em < c.fim_em
     and not exists (select 1 from campanha_vendas cv where cv.sku = ci.sku and cv.campanha_id = p_id);

  select coalesce(jsonb_agg(jsonb_build_object('sku', cv.sku, 'produto', i.produto, 'decisao', cv.decisao, 'preco_cheio', cv.preco_cheio,
                   'preco_promo', cv.preco_promo, 'valor_vendido', cv.valor_vendido, 'fechado_em', cv.fechado_em, 'sacola', cv.origem_ref)
                   order by cv.fechado_em desc), '[]'::jsonb)
    into v_vendas
    from (select * from campanha_vendas where campanha_id = p_id order by fechado_em desc limit 200) cv join itens i on i.sku = cv.sku;

  return jsonb_build_object('agora', now(), 'itens_na_campanha', v_total, 'por_decisao', v, 'sacolas_abertas', v_aberta,
                            'nao_vendidos', v_naovend, 'fora_da_sacola', v_fora, 'vendas', v_vendas);
end $$;
revoke all on function public.campanha_resultado(uuid) from public, anon;
grant execute on function public.campanha_resultado(uuid) to authenticated, service_role;

-- Rollback (manual): drop function if exists public.campanha_resultado(uuid);
