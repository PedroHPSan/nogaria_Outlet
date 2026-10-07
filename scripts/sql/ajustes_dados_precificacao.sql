-- Ajustes de DADOS do motor de preço — *** NÃO EXECUTADO, aguarda validação de Pedro e Bárbara. ***
-- Backup antes:  create table _bkp_pricing_grupo_20261008 as select * from pricing_grupo;
-- 1) Smartphone: âncora de usado (R$ 1.700) maior que a de novo (R$ 1.300) — erro de dado que infla o preço de usado.
--    Proposta: usado = 60% do novo (convNovoUsado do motor) = R$ 780. REVISAR o valor de novo antes (R$ 1.300 parece baixo).
update pricing_grupo set ancora_usado = round(ancora_novo * 0.60) where grupo = 'Smartphone' and ancora_usado > ancora_novo;
-- 2) Conferência de outros grupos com usado > novo:
select grupo, ancora_novo, ancora_usado from pricing_grupo where ancora_usado > ancora_novo;
