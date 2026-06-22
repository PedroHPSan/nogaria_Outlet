-- Controle de vendas, entrega e lucratividade por lote.
-- 1 SKU = 1 unidade, então a venda é 1:1 com o item: os dados de venda ficam como
-- colunas em `itens` (mesmo idioma de conferido_em/conferido_por), sem tabela `vendas`.
-- `valor_vendido` já existe (valor bruto recebido). Campos novos detalham a venda real
-- para apurar o lucro líquido exato e separar VENDIDO (pago) de ENTREGUE (enviado).

alter table itens add column if not exists vendido_em  timestamptz;  -- quando foi vendido
alter table itens add column if not exists entregue_em timestamptz;  -- quando foi entregue/enviado
alter table itens add column if not exists canal_venda text;         -- canal REAL da venda (≠ canal_principal, que é o planejado)
alter table itens add column if not exists taxa_venda  numeric;      -- comissão/taxa do marketplace (R$)
alter table itens add column if not exists frete_pago  numeric;      -- frete pago pelo vendedor (R$)
alter table itens add column if not exists comprador   text;         -- nome/identificação do comprador
alter table itens add column if not exists pedido_ref  text;         -- nº do pedido / referência no canal

-- Backfill leve: itens já vendidos antes desta migração não têm data; carimba `now()`
-- só onde está nulo, para não ficarem fora dos relatórios de lote. Idempotente.
update itens set vendido_em = now() where status::text = 'VENDIDO' and vendido_em is null;

-- Resultado realizado por lote, partindo do breakeven (custo pago no arremate).
-- Reusa vw_precificacao (custo_proporcional = rateio do custo do lote por item;
-- p_anuncio = teto de venda) e pricing_lote_custo (custo_total pago no lote).
-- Compara status::text (robusto ao valor de enum recém-criado e a coluna text).
create or replace view public.vw_lote_resultado as
with item_calc as (
  select
    i.lote,
    i.valor_vendido,
    i.taxa_venda,
    i.frete_pago,
    vp.custo_proporcional,
    vp.p_anuncio,
    (i.status::text in ('VENDIDO', 'ENTREGUE')) as vendido,
    (i.status::text = 'ENTREGUE')               as entregue
  from itens i
  left join vw_precificacao vp on vp.sku = i.sku
)
select
  c.lote,
  coalesce(lc.custo_total, 0)                                                          as custo_total,
  count(*)                                                                             as n_itens,
  count(*) filter (where c.vendido)                                                    as n_vendidos,
  count(*) filter (where c.entregue)                                                   as n_entregues,
  coalesce(sum(c.valor_vendido)                       filter (where c.vendido), 0)     as receita_bruta,
  coalesce(sum(coalesce(c.taxa_venda, 0) + coalesce(c.frete_pago, 0))
                                                      filter (where c.vendido), 0)     as custos_venda,
  coalesce(sum(c.custo_proporcional)                  filter (where c.vendido), 0)     as custo_itens_vendidos,
  coalesce(sum(c.valor_vendido)                       filter (where c.vendido), 0)
    - coalesce(sum(coalesce(c.taxa_venda, 0) + coalesce(c.frete_pago, 0))
                                                      filter (where c.vendido), 0)
    - coalesce(sum(c.custo_proporcional)              filter (where c.vendido), 0)     as lucro_realizado,
  round(
    coalesce(sum(c.valor_vendido) filter (where c.vendido), 0)
      / nullif(coalesce(lc.custo_total, 0), 0)
  , 4)                                                                                 as pct_breakeven,
  coalesce(sum(c.p_anuncio)                           filter (where not c.vendido), 0) as estoque_potencial
from item_calc c
left join pricing_lote_custo lc on lc.lote = c.lote
group by c.lote, lc.custo_total;

-- A view roda como o usuário que consulta (respeita RLS de itens/pricing_*), igual a
-- vw_precificacao (ver 20260617_pricing_engine_rls.sql). O app consulta autenticado.
alter view vw_lote_resultado set (security_invoker = on);
