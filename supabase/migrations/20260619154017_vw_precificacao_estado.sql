-- Atualiza vw_precificacao para os novos estados de triagem: mapeia
-- 'Embalagem aberta/avariada' -> NOVO_CAIXA_AVARIADA e 'Usado' -> USADO_OK.
-- (migração separada da alteração do enum, pois o novo valor só pode ser usado
-- fora da transação em que foi adicionado.)
create or replace view public.vw_precificacao as
 with cfg as (
         select max(pricing_config.valor) filter (where pricing_config.key = 'margem_sp'::text) as margem_sp,
            max(pricing_config.valor) filter (where pricing_config.key = 'margem_belem'::text) as margem_belem,
            max(pricing_config.valor) filter (where pricing_config.key = 'reserva'::text) as reserva,
            max(pricing_config.valor) filter (where pricing_config.key = 'embalagem'::text) as embalagem,
            max(pricing_config.valor) filter (where pricing_config.key = 'frete_kg'::text) as frete_kg,
            max(pricing_config.valor) filter (where pricing_config.key = 'frete_min'::text) as frete_min,
            max(pricing_config.valor) filter (where pricing_config.key = 'conv_novo_usado'::text) as conv,
            max(pricing_config.valor_txt) filter (where pricing_config.key = 'condicao_padrao'::text) as cond_padrao
           from pricing_config
        ), resolved as (
         select i.sku, i.lote, i.produto, i.grupo, i.canal_principal, i.destino,
                case i.estado
                    when 'Novo'::tri_estado then 'NOVO_LACRADO'::text
                    when 'Embalagem aberta/avariada'::tri_estado then 'NOVO_CAIXA_AVARIADA'::text
                    when 'Usado'::tri_estado then 'USADO_OK'::text
                    when 'Usado sem teste'::tri_estado then 'SEM_TESTE'::text
                    when 'Avariado'::tri_estado then 'AVARIA_ESTETICA'::text
                    when 'Incompleto'::tri_estado then 'SEM_TESTE'::text
                    when 'Sucata'::tri_estado then 'DEFEITO_PECAS'::text
                    else cfg.cond_padrao
                end as cond_cod,
                case
                    when i.canal_principal ~~* '%shopee%'::text then 'SHOPEE'::text
                    when i.canal_principal ~~* '%mercado livre%'::text then 'ML'::text
                    when i.canal_principal ~~* '%tiktok%'::text then 'TIKTOK'::text
                    when i.canal_principal ~~* '%magalu%'::text then 'MAGALU'::text
                    when i.canal_principal ~~* '%amazon%'::text then 'AMAZON'::text
                    when i.canal_principal ~~* '%b2b%'::text then 'B2B'::text
                    when i.canal_principal ~~* '%olx%'::text or i.canal_principal ~~* '%facebook%'::text or i.canal_principal ~~* '%local%'::text then 'LOCAL'::text
                    else 'ML'::text
                end as canal_cod,
            coalesce(i.preco_ref_novo, g.ancora_novo, i.preco_novo_est) as ref_novo,
            coalesce(i.preco_ref_usado, g.ancora_usado, coalesce(i.preco_ref_novo, g.ancora_novo, i.preco_novo_est) * cfg.conv) as ref_usado,
            coalesce(g.nivel_risco, 'MEDIO'::text) as nivel_risco,
            coalesce(i.peso_real_kg, i.peso_kg, 0::numeric) as peso,
            cfg.margem_sp, cfg.margem_belem, cfg.reserva, cfg.embalagem, cfg.frete_kg, cfg.frete_min,
            i.preco_ref_confianca
           from itens i
             cross join cfg
             left join pricing_grupo g on g.grupo = i.grupo
        ), priced as (
         select r_1.sku, r_1.lote, r_1.produto, r_1.grupo, r_1.canal_principal, r_1.destino, r_1.cond_cod, r_1.canal_cod, r_1.ref_novo, r_1.ref_usado, r_1.nivel_risco, r_1.peso, r_1.margem_sp, r_1.margem_belem, r_1.reserva, r_1.embalagem, r_1.frete_kg, r_1.frete_min, r_1.preco_ref_confianca,
            c.fator as f_cond, c.ancora, rk.fator as f_risco,
                case when c.ancora = 'NOVO'::text then r_1.ref_novo else r_1.ref_usado end as ref_eff,
            cn.take_rate, cn.fixo,
                case when r_1.destino ~~* '%belem%'::text or r_1.destino ~~* '%belém%'::text then r_1.margem_belem else r_1.margem_sp end as margem_min
           from resolved r_1
             left join pricing_factor_condicao c on c.codigo = r_1.cond_cod
             left join pricing_factor_risco rk on rk.nivel = r_1.nivel_risco
             left join pricing_canal cn on cn.codigo = r_1.canal_cod
        ), anun as (
         select p.sku, p.lote, p.produto, p.grupo, p.canal_principal, p.destino, p.cond_cod, p.canal_cod, p.ref_novo, p.ref_usado, p.nivel_risco, p.peso, p.margem_sp, p.margem_belem, p.reserva, p.embalagem, p.frete_kg, p.frete_min, p.preco_ref_confianca, p.f_cond, p.ancora, p.f_risco, p.ref_eff, p.take_rate, p.fixo, p.margem_min,
            round(coalesce(p.ref_eff, 0::numeric) * coalesce(p.f_cond, 0.55) * coalesce(p.f_risco, 0.9), 2) as p_anuncio
           from priced p
        ), rateio as (
         select a.sku, a.lote, a.produto, a.grupo, a.canal_principal, a.destino, a.cond_cod, a.canal_cod, a.ref_novo, a.ref_usado, a.nivel_risco, a.peso, a.margem_sp, a.margem_belem, a.reserva, a.embalagem, a.frete_kg, a.frete_min, a.preco_ref_confianca, a.f_cond, a.ancora, a.f_risco, a.ref_eff, a.take_rate, a.fixo, a.margem_min, a.p_anuncio,
            sum(a.p_anuncio) over (partition by a.lote) as soma_base_lote,
                case when a.canal_cod = any (array['LOCAL'::text, 'B2B'::text]) then 0::numeric else round(greatest(a.frete_min, a.peso * a.frete_kg), 2) end as frete
           from anun a
        )
 select r.sku, r.lote, r.produto, r.grupo, r.canal_cod, r.destino, r.cond_cod, r.ancora, r.nivel_risco, r.f_cond, r.f_risco, r.ref_novo, r.ref_usado, r.ref_eff, r.preco_ref_confianca, r.p_anuncio,
    round(coalesce(lc.custo_total, 0::numeric) * r.p_anuncio / nullif(r.soma_base_lote, 0::numeric), 2) as custo_proporcional,
    r.frete, r.take_rate, r.fixo, r.margem_min,
    round((round(coalesce(lc.custo_total, 0::numeric) * r.p_anuncio / nullif(r.soma_base_lote, 0::numeric), 2) + r.frete + r.embalagem + r.fixo) / nullif(1::numeric - r.take_rate - r.reserva - r.margem_min, 0::numeric), 2) as p_piso,
    round(r.p_anuncio - round(coalesce(lc.custo_total, 0::numeric) * r.p_anuncio / nullif(r.soma_base_lote, 0::numeric), 2) - r.frete - r.embalagem - r.fixo - r.p_anuncio * (r.take_rate + r.reserva), 2) as lucro_liquido,
        case when r.p_anuncio > 0::numeric then round((r.p_anuncio - round(coalesce(lc.custo_total, 0::numeric) * r.p_anuncio / nullif(r.soma_base_lote, 0::numeric), 2) - r.frete - r.embalagem - r.fixo - r.p_anuncio * (r.take_rate + r.reserva)) / r.p_anuncio, 4) else 0::numeric end as margem_liquida,
    r.p_anuncio >= round((round(coalesce(lc.custo_total, 0::numeric) * r.p_anuncio / nullif(r.soma_base_lote, 0::numeric), 2) + r.frete + r.embalagem + r.fixo) / nullif(1::numeric - r.take_rate - r.reserva - r.margem_min, 0::numeric), 2) as viavel
   from rateio r
     left join pricing_lote_custo lc on lc.lote = r.lote;
