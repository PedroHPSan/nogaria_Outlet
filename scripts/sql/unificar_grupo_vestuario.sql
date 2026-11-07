-- Correção de DADOS (F1b dos custos): peças de roupa gravadas como "Loja de roupa(s)" não existem em pricing_grupo; só "Vestuário"
-- existe (âncora 90). Efeito do erro: preco_sugerido nulo, p_anuncio 0 e custo do lote sem rateio em vw_precificacao.
-- *** NÃO EXECUTADO — revisar o PREVIEW e só então rodar o UPDATE (com OK do Pedro/Bárbara). ***
-- Backup: create schema if not exists backup_cat; create table backup_cat.itens_grupo_vestuario as
--         select sku, grupo, upd_by from itens where lower(trim(grupo)) in ('loja de roupa','loja de roupas');

-- 1) PREVIEW
select lote, grupo, count(*) as pecas from itens where lower(trim(grupo)) in ('loja de roupa', 'loja de roupas') group by 1, 2 order by 1, 2;

-- 2) UPDATE (idempotente; registra em eventos)
-- begin;
-- with alvo as (select sku, grupo from itens where lower(trim(grupo)) in ('loja de roupa', 'loja de roupas')),
--      up as (update itens i set grupo = 'Vestuário', upd_by = 'unificar-grupo-vestuario' from alvo a where i.sku = a.sku returning i.sku, a.grupo as antes)
-- insert into eventos (sku, acao, usuario, detalhe) select sku, 'grupo:corrigido', 'unificar-grupo-vestuario', antes || ' → Vestuário' from up;
-- commit;
