-- Correção de DADOS: acessórios (cabo, carregador, capa, película…) gravados como Smartphone/Notebook.
-- *** NÃO EXECUTADO — revisar o PREVIEW, fazer backup e só então rodar os UPDATEs. ***
-- Efeito do erro: a âncora do Smartphone (R$ 1.300 novo / R$ 1.700 usado, classe A+) inflava o preço de
-- referência, a classe e o rateio do lote (no lote 110, duas capas carregavam R$ 458 cada) e se propagava
-- às unidades-irmãs do desmembramento.
--
-- Backup:  create schema if not exists backup_cat; create table backup_cat.itens_20261008 as
--          select sku, grupo, classe, preco_novo_est, upd_by from itens
--          where grupo in ('Smartphone','Notebook') and produto ~* '<mesmo regex abaixo>';

-- 1) PREVIEW (rodar primeiro): o que mudaria
select sku, grupo as grupo_atual,
       case when produto ~* '(^|[^a-z])(carregador(es)?|cabos? (usb|tipo|lightning|turbo|hdmi|micro|p2)|power ?bank)([^a-z]|$)'
            then 'Carregadores/Acessórios eletrônicos' else 'Acessórios celular/info' end as grupo_novo,
       classe, preco_novo_est, preco_ideal, left(produto, 60) as produto
from itens
where grupo in ('Smartphone', 'Notebook')
  and produto ~* '(^|[^a-z])(capas?|capinhas?|cases?|pel[ií]culas?\w*|hidrogel|carregador(es)?|cabos? (usb|tipo|lightning|turbo|hdmi|micro|p2)|power ?bank)([^a-z]|$)'
  and produto !~* '(^|[^a-z])(smartphone|celular) [a-z0-9 ]*(gb|ram)'   -- aparelho de verdade não entra
order by sku;

-- 2) UPDATE (depois de revisar o preview; mesmas condições)
-- begin;
-- update itens set
--   grupo = case when produto ~* '(^|[^a-z])(carregador(es)?|cabos? (usb|tipo|lightning|turbo|hdmi|micro|p2)|power ?bank)([^a-z]|$)'
--                then 'Carregadores/Acessórios eletrônicos' else 'Acessórios celular/info' end,
--   preco_novo_est = case when preco_novo_est in (1300, 2800) then null else preco_novo_est end,  -- era a "foto" da âncora
--   classe = case when classe in ('A+', 'A', 'B') then 'C' else classe end,                       -- acessório de R$ ~20 é C; D/E (condição) ficam
--   upd_by = 'correcao-categoria-acessorios'
-- where grupo in ('Smartphone', 'Notebook')
--   and produto ~* '(^|[^a-z])(capas?|capinhas?|cases?|pel[ií]culas?\w*|hidrogel|carregador(es)?|cabos? (usb|tipo|lightning|turbo|hdmi|micro|p2)|power ?bank)([^a-z]|$)'
--   and produto !~* '(^|[^a-z])(smartphone|celular) [a-z0-9 ]*(gb|ram)';
-- commit;

-- 3) Itens em 'Diversos (não classificado)' e outros grupos com nome de acessório: usar a tela Conferência →
--    categorização em massa (agora com a sugestão corrigida e troca sem herdar classe/preço-foto).
