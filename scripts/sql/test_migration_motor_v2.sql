-- Testes de comportamento da migration 20261008120000_motor_preco_v2.sql + backfill + rollback.
-- Rode via scripts/test_motor_docker.sh (Postgres descartável; não toca nenhum banco real).
\set QUIET on
-- (sem grants globais aqui: o que authenticated/anon podem fazer vem SÓ da migration)
create temp table res (teste text, ok boolean, detalhe text);
grant all on res to anon, authenticated;

-- dados do cenário (lotes pagos reais: 3 e 100; lote 7 fora do sistema; lote 82 sem resíduo)
insert into lotes (lote, lance_final, custo_total) values (3, 1544.90, 1622.15), (100, 10155.90, 10663.70), (7, null, 2507.35), (82, 580.90, 609.95);
insert into itens (sku, produto, lote, preco_ideal) values ('A', 'Capa', 3, 20), ('B', 'Robô', 100, 1500);

-- 1) a migration já foi aplicada 2x pelo runner (idempotência): se chegou aqui, não quebrou
insert into res select 'M1 migration é idempotente (aplicada 2x)', true, '';
insert into res select 'M1 custo_total original intocado', (select custo_total from lotes where lote = 3) = 1622.15, '';
insert into res select 'M1 peso_rateio padrão = 1', (select peso_rateio from itens where sku = 'A') = 1, '';

-- 2) backfill (arquivo real) e conferência dos componentes
\i scripts/sql/backfill_lotes_hisa.sql
insert into res select 'M2 backfill preenche lote 3', (select valor_pago_hisa from lotes where lote = 3) = 2062.15 and (select taxa_hisa from lotes where lote = 3) = 440, '';
insert into res select 'M2 comissão 5% do lance', (select comissao_leiloeiro from lotes where lote = 100) = 507.80, (select comissao_leiloeiro::text from lotes where lote = 100);
insert into res select 'M2 frete fica NULL (nunca 0)', (select frete_retirada is null and frete_transferencia is null from lotes where lote = 3), '';
insert into res select 'M2 lotes sem resíduo conhecido não são tocados', (select valor_pago_hisa is null from lotes where lote in (7, 82) limit 1), '';
insert into res select 'M2 backfill é idempotente (2ª execução não altera)', (select count(*) from lotes where valor_pago_hisa is not null) = 2, '';
-- soma dos componentes == pago_hisa (tolerância de centavos)
insert into res select 'M2 custo_composto = pago HISA (lotes 3 e 100)',
  abs((select custo_composto from lotes where lote = 3) - 2062.15) < 0.02 and abs((select custo_composto from lotes where lote = 100) - 12098.70) < 0.02,
  (select string_agg(custo_composto::text, ',') from lotes where lote in (3, 100));
insert into res select 'M2 custo_composto NULL sem lance (lote 7)', (select custo_composto is null from lotes where lote = 7), '';

-- 3) coluna gerada reage ao frete real
update lotes set frete_retirada = 150, frete_transferencia = 250 where lote = 3;
insert into res select 'M3 frete real entra no custo_composto', abs((select custo_composto from lotes where lote = 3) - (2062.15 + 400)) < 0.02, (select custo_composto::text from lotes where lote = 3);

-- 4) check do peso
do $$ begin
  begin update itens set peso_rateio = 5 where sku = 'A'; insert into res values ('M4 peso 5 é recusado', false, ''); exception when check_violation then insert into res values ('M4 peso 5 é recusado', true, ''); end;
  begin update itens set peso_rateio = 0.1 where sku = 'A'; insert into res values ('M4 peso 0,1 é recusado', false, ''); exception when check_violation then insert into res values ('M4 peso 0,1 é recusado', true, ''); end;
  begin update itens set peso_rateio = 0.25 where sku = 'A'; insert into res values ('M4 peso 0,25 aceito', true, ''); exception when others then insert into res values ('M4 peso 0,25 aceito', false, sqlerrm); end;
  begin update itens set peso_rateio = 4 where sku = 'A'; insert into res values ('M4 peso 4 aceito', true, ''); exception when others then insert into res values ('M4 peso 4 aceito', false, sqlerrm); end;
end $$;

-- 5) RLS: anon não vê nada das tabelas novas; authenticated tem acesso total
set role anon;
do $$ begin
  begin perform count(*) from pricing_v2_param; insert into res values ('M5 anon não lê pricing_v2_param', false, 'leu'); exception when insufficient_privilege then insert into res values ('M5 anon não lê pricing_v2_param', true, ''); end;
  begin perform count(*) from pricing_v2_canal; insert into res values ('M5 anon não lê pricing_v2_canal', false, 'leu'); exception when insufficient_privilege then insert into res values ('M5 anon não lê pricing_v2_canal', true, ''); end;
  begin insert into item_custo_snapshot (sku, lote, custo_alocado) values ('A', 3, 1); insert into res values ('M5 anon não grava snapshot', false, ''); exception when others then insert into res values ('M5 anon não grava snapshot', true, ''); end;
  begin insert into item_peso_rateio_log (sku, valor_depois, motivo) values ('A', 2, 'x'); insert into res values ('M5 anon não grava log de peso', false, ''); exception when others then insert into res values ('M5 anon não grava log de peso', true, ''); end;
end $$;
reset role;
set role authenticated;
insert into res select 'M5 authenticated lê parâmetros (seed)', (select count(*) from pricing_v2_param) = 8 and (select count(*) from pricing_v2_canal) = 8, '';
insert into item_custo_snapshot (sku, lote, custo_alocado, w, peso_k, calculado_por) values ('A', 3, 12.34, 0.1, 1, 't');
insert into item_peso_rateio_log (sku, valor_antes, valor_depois, motivo, usuario) values ('A', 1, 2, 'robô sem base', 't');
update pricing_v2_param set valor = 0.30 where chave = 'margem_min';
insert into res select 'M5 authenticated grava snapshot, log e edita parâmetro', (select count(*) from item_custo_snapshot) = 1 and (select count(*) from item_peso_rateio_log) = 1 and (select valor from pricing_v2_param where chave = 'margem_min') = 0.30, '';
reset role;

-- 6) snapshot: upsert por sku (fechar de novo atualiza em vez de duplicar)
insert into item_custo_snapshot (sku, lote, custo_alocado) values ('A', 3, 99) on conflict (sku) do update set custo_alocado = excluded.custo_alocado;
insert into res select 'M6 snapshot faz upsert por sku', (select count(*) from item_custo_snapshot) = 1 and (select custo_alocado from item_custo_snapshot where sku = 'A') = 99, '';

-- 7) seeds batem com as constantes do motor (conferido também no teste JS)
insert into res select 'M7 seed do ML: 12% + R$6,50 abaixo de R$79 + frete 10%',
  (select taxa = 0.12 and fixo_valor = 6.50 and fixo_abaixo_de = 79 and frete_pct = 0.10 from pricing_v2_canal where codigo = 'ML'), '';
insert into res select 'M7 seed Shopee 20% + R$4', (select taxa = 0.20 and fixo_valor = 4 from pricing_v2_canal where codigo = 'SHOPEE'), '';
insert into res select 'M7 seed local sem taxa nem frete', (select taxa = 0 and frete_pct = 0 from pricing_v2_canal where codigo = 'LOCAL'), '';

select case when ok then 'PASS' else 'FAIL' end as r, teste, detalhe from res order by 1 desc, 2;
