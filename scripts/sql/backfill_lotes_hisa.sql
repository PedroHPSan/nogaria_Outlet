-- Backfill da composição do custo dos lotes (fonte: LOTES_PAGOS.pdf / HISA, informado pelo Pedro).
-- *** NÃO EXECUTADO — rodar só DEPOIS da migration 20261008120000 e da validação da Bárbara. ***
-- Faça backup antes:  create table _bkp_lotes_20261008 as select * from lotes;
-- comissão = 5% do lance; taxa_hisa = resíduo (pago − lance − 5%); frete fica NULL (sem dado, nunca 0).
-- Só preenche onde ainda está vazio (idempotente). Lotes 1, 7, 74, 75, 82 ficam fora (sem resíduo conhecido).
begin;
update lotes set valor_pago_hisa=2062.15, comissao_leiloeiro=77.25, taxa_hisa=440.00 where lote=3 and valor_pago_hisa is null;
update lotes set valor_pago_hisa=2891.15, comissao_leiloeiro=104.25, taxa_hisa=702.00 where lote=12 and valor_pago_hisa is null;
update lotes set valor_pago_hisa=1615.90, comissao_leiloeiro=56.00, taxa_hisa=440.00 where lote=42 and valor_pago_hisa is null;
update lotes set valor_pago_hisa=1179.35, comissao_leiloeiro=42.45, taxa_hisa=288.00 where lote=43 and valor_pago_hisa is null;
update lotes set valor_pago_hisa=1395.40, comissao_leiloeiro=51.50, taxa_hisa=314.00 where lote=52 and valor_pago_hisa is null;
update lotes set valor_pago_hisa=1382.80, comissao_leiloeiro=50.90, taxa_hisa=314.00 where lote=68 and valor_pago_hisa is null;
update lotes set valor_pago_hisa=1380.70, comissao_leiloeiro=50.80, taxa_hisa=314.00 where lote=69 and valor_pago_hisa is null;
update lotes set valor_pago_hisa=1028.45, comissao_leiloeiro=38.55, taxa_hisa=219.00 where lote=71 and valor_pago_hisa is null;
update lotes set valor_pago_hisa=1893.10, comissao_leiloeiro=69.20, taxa_hisa=440.00 where lote=83 and valor_pago_hisa is null;
update lotes set valor_pago_hisa=1639.00, comissao_leiloeiro=57.10, taxa_hisa=440.00 where lote=89 and valor_pago_hisa is null;
update lotes set valor_pago_hisa=1451.05, comissao_leiloeiro=54.15, taxa_hisa=314.00 where lote=90 and valor_pago_hisa is null;
update lotes set valor_pago_hisa=1177.25, comissao_leiloeiro=42.34, taxa_hisa=288.00 where lote=91 and valor_pago_hisa is null;
update lotes set valor_pago_hisa=1883.65, comissao_leiloeiro=68.75, taxa_hisa=440.00 where lote=92 and valor_pago_hisa is null;
update lotes set valor_pago_hisa=1046.30, comissao_leiloeiro=39.40, taxa_hisa=219.00 where lote=95 and valor_pago_hisa is null;
update lotes set valor_pago_hisa=12098.70, comissao_leiloeiro=507.80, taxa_hisa=1435.00 where lote=100 and valor_pago_hisa is null;
update lotes set valor_pago_hisa=18409.50, comissao_leiloeiro=787.60, taxa_hisa=1870.00 where lote=103 and valor_pago_hisa is null;
update lotes set valor_pago_hisa=2514.70, comissao_leiloeiro=98.80, taxa_hisa=440.00 where lote=105 and valor_pago_hisa is null;
update lotes set valor_pago_hisa=5273.35, comissao_leiloeiro=209.44, taxa_hisa=875.00 where lote=110 and valor_pago_hisa is null;
update lotes set valor_pago_hisa=13156.05, comissao_leiloeiro=558.14, taxa_hisa=1435.00 where lote=111 and valor_pago_hisa is null;
update lotes set valor_pago_hisa=9408.10, comissao_leiloeiro=389.19, taxa_hisa=1235.00 where lote=112 and valor_pago_hisa is null;
update lotes set valor_pago_hisa=11363.20, comissao_leiloeiro=482.30, taxa_hisa=1235.00 where lote=116 and valor_pago_hisa is null;
update lotes set valor_pago_hisa=14023.35, comissao_leiloeiro=599.45, taxa_hisa=1435.00 where lote=119 and valor_pago_hisa is null;
update lotes set valor_pago_hisa=11668.75, comissao_leiloeiro=496.85, taxa_hisa=1235.00 where lote=120 and valor_pago_hisa is null;
update lotes set valor_pago_hisa=3984.20, comissao_leiloeiro=156.30, taxa_hisa=702.00 where lote=121 and valor_pago_hisa is null;
update lotes set valor_pago_hisa=9566.65, comissao_leiloeiro=396.75, taxa_hisa=1235.00 where lote=122 and valor_pago_hisa is null;
update lotes set valor_pago_hisa=13591.80, comissao_leiloeiro=578.89, taxa_hisa=1435.00 where lote=123 and valor_pago_hisa is null;
update lotes set valor_pago_hisa=15196.20, comissao_leiloeiro=655.30, taxa_hisa=1435.00 where lote=125 and valor_pago_hisa is null;
-- Conferência: a soma dos componentes deve bater com o pago_hisa (diferença de centavos pelo arredondamento da comissão).
select lote, valor_pago_hisa, round(lance_final + comissao_leiloeiro + taxa_hisa, 2) as soma, valor_pago_hisa - round(lance_final + comissao_leiloeiro + taxa_hisa, 2) as dif from lotes where valor_pago_hisa is not null order by lote;
commit;
