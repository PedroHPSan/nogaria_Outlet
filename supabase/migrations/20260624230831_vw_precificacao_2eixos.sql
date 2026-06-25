-- Fase 3 — vw_precificacao de 2 eixos. Depende de 20260624_pricing_2eixos.sql
-- (tabela pricing_factor_embalagem + coluna itens.cond_embalagem).
-- Mudanças vs 20260619d:
--   1) 'Embalagem aberta/avariada' -> NOVO_LACRADO (era NOVO_CAIXA_AVARIADA, que caía
--      no fator de usado). A avaria da caixa passa a ser tratada pelo eixo embalagem.
--   2) lê emb_cod = coalesce(i.cond_embalagem,'PERFEITA') e multiplica f_emb no p_anuncio.
--   3) expõe emb_cod e f_emb (anexados ao FIM — create or replace só permite adicionar
--      colunas no final, não reordenar). NÃO aplicar sem OK de Pedro/Bárbara.
create or replace view public.vw_precificacao as
with cfg as (
  select max(valor) filter (where key='margem_sp')     as margem_sp,
         max(valor) filter (where key='margem_belem')  as margem_belem,
         max(valor) filter (where key='reserva')        as reserva,
         max(valor) filter (where key='embalagem')      as embalagem,
         max(valor) filter (where key='frete_kg')       as frete_kg,
         max(valor) filter (where key='frete_min')      as frete_min,
         max(valor) filter (where key='conv_novo_usado') as conv,
         max(valor_txt) filter (where key='condicao_padrao') as cond_padrao
  from pricing_config
),
resolved as (
  select i.sku, i.lote, i.produto, i.grupo, i.canal_principal, i.destino,
    case i.estado
      when 'Novo' then 'NOVO_LACRADO'
      when 'Embalagem aberta/avariada' then 'NOVO_LACRADO'   -- caixa tratada no eixo embalagem
      when 'Usado' then 'USADO_OK'
      when 'Usado sem teste' then 'SEM_TESTE'
      when 'Avariado' then 'AVARIA_ESTETICA'
      when 'Incompleto' then 'SEM_TESTE'
      when 'Sucata' then 'DEFEITO_PECAS'
      else cfg.cond_padrao end as cond_cod,
    coalesce(i.cond_embalagem,'PERFEITA') as emb_cod,
    case
      when i.canal_principal ilike '%shopee%' then 'SHOPEE'
      when i.canal_principal ilike '%mercado livre%' then 'ML'
      when i.canal_principal ilike '%tiktok%' then 'TIKTOK'
      when i.canal_principal ilike '%magalu%' then 'MAGALU'
      when i.canal_principal ilike '%amazon%' then 'AMAZON'
      when i.canal_principal ilike '%b2b%' then 'B2B'
      when i.canal_principal ilike '%olx%' or i.canal_principal ilike '%facebook%' or i.canal_principal ilike '%local%' then 'LOCAL'
      else 'ML' end as canal_cod,
    coalesce(i.preco_ref_novo, g.ancora_novo, i.preco_novo_est) as ref_novo,
    coalesce(i.preco_ref_usado, g.ancora_usado, coalesce(i.preco_ref_novo,g.ancora_novo,i.preco_novo_est)*cfg.conv) as ref_usado,
    coalesce(g.nivel_risco,'MEDIO') as nivel_risco,
    coalesce(i.peso_real_kg, i.peso_kg, 0) as peso,
    cfg.margem_sp,cfg.margem_belem,cfg.reserva,cfg.embalagem,cfg.frete_kg,cfg.frete_min,
    i.preco_ref_confianca
  from itens i cross join cfg left join pricing_grupo g on g.grupo=i.grupo
),
priced as (
  select r.*, c.fator as f_cond, c.ancora, rk.fator as f_risco,
    coalesce(fe.fator,1) as f_emb,
    case when c.ancora='NOVO' then r.ref_novo else r.ref_usado end as ref_eff,
    cn.take_rate, cn.fixo,
    case when r.destino ilike '%belem%' or r.destino ilike '%belém%' then r.margem_belem else r.margem_sp end as margem_min
  from resolved r
  left join pricing_factor_condicao c  on c.codigo=r.cond_cod
  left join pricing_factor_risco rk    on rk.nivel=r.nivel_risco
  left join pricing_factor_embalagem fe on fe.codigo=r.emb_cod
  left join pricing_canal cn           on cn.codigo=r.canal_cod
),
anun as (
  select p.*,
    round(coalesce(ref_eff,0)*coalesce(f_cond,0.55)*coalesce(f_emb,1)*coalesce(f_risco,0.9),2) as p_anuncio
  from priced p
),
rateio as (
  select a.*, sum(p_anuncio) over (partition by lote) as soma_base_lote,
    case when a.canal_cod in ('LOCAL','B2B') then 0 else round(greatest(a.frete_min,a.peso*a.frete_kg),2) end as frete
  from anun a
)
select r.sku,r.lote,r.produto,r.grupo,r.canal_cod,r.destino,r.cond_cod,r.ancora,r.nivel_risco,
  r.f_cond,r.f_risco,r.ref_novo,r.ref_usado,r.ref_eff,r.preco_ref_confianca,r.p_anuncio,
  round(coalesce(lc.custo_total,0)*r.p_anuncio/nullif(r.soma_base_lote,0),2) as custo_proporcional,
  r.frete,r.take_rate,r.fixo,r.margem_min,
  round((round(coalesce(lc.custo_total,0)*r.p_anuncio/nullif(r.soma_base_lote,0),2)+r.frete+r.embalagem+r.fixo)/nullif(1-r.take_rate-r.reserva-r.margem_min,0),2) as p_piso,
  round(r.p_anuncio-round(coalesce(lc.custo_total,0)*r.p_anuncio/nullif(r.soma_base_lote,0),2)-r.frete-r.embalagem-r.fixo-r.p_anuncio*(r.take_rate+r.reserva),2) as lucro_liquido,
  case when r.p_anuncio>0 then round((r.p_anuncio-round(coalesce(lc.custo_total,0)*r.p_anuncio/nullif(r.soma_base_lote,0),2)-r.frete-r.embalagem-r.fixo-r.p_anuncio*(r.take_rate+r.reserva))/r.p_anuncio,4) else 0 end as margem_liquida,
  (r.p_anuncio >= round((round(coalesce(lc.custo_total,0)*r.p_anuncio/nullif(r.soma_base_lote,0),2)+r.frete+r.embalagem+r.fixo)/nullif(1-r.take_rate-r.reserva-r.margem_min,0),2)) as viavel,
  r.emb_cod, r.f_emb
from rateio r left join pricing_lote_custo lc on lc.lote=r.lote;
