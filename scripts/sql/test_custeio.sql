-- Custos dos lotes v2 (20261108100000). Roda como supabase_admin.
\set QUIET on
create temp table res (teste text, ok boolean, detalhe text);
insert into lotes (lote, referencia, lance_final, custo_total) values (1, 'Leilão', null, null), (2, 'Roupas', null, null), (3, 'Legado', 500, 525), (4, 'Excecao', null, null);
insert into itens (sku, produto, status, preco_ideal, grupo, lote, peso_kg) values
 ('A1','a1','PRONTO',100,'G1',1,1), ('A2','a2','PRONTO',200,'G1',1,2), ('A3','a3','PRONTO',300,'G2',1,3),
 ('B1','b1','PRONTO',50,'Vestuário',2,null), ('B2','b2','PRONTO',50,'Vestuário',2,null), ('B3','b3','PRONTO',null,'Vestuário',2,null), ('B4','descarte','DESCARTE',50,'Vestuário',2,null),
 ('L1','l1','PRONTO',100,'G1',3,1),
 ('E1','e1','PRONTO',100,'G1',4,1), ('E2','e2','PRONTO',100,'G1',4,1);

do $$ declare r jsonb; m text; v numeric; n int; begin
  -- ratear_centavos: soma exata e desempate estável
  insert into res values ('ratear: 100 em 3 pesos iguais fecha em 100,00', (select sum(valor) from ratear_centavos(100, array['a','b','c'], array[1,1,1])) = 100 and (select max(valor) - min(valor) from ratear_centavos(100, array['a','b','c'], array[1,1,1])) = 0.01, null);
  insert into res values ('ratear: proporcional 1:2 de 650', (select valor from ratear_centavos(650, array['a','b'], array[100,200]) where sku='a') = 216.67 and (select valor from ratear_centavos(650, array['a','b'], array[100,200]) where sku='b') = 433.33, null);
  insert into res values ('ratear: pesos zero viram igual', (select sum(valor) from ratear_centavos(10, array['a','b'], array[0,0])) = 10, null);

  -- lote legado não aparece na fonte única
  insert into res values ('legado: custo_itens_lote vazio', (select count(*) from custo_itens_lote(3)) = 0, null);

  -- Lote 1 (valor do lote): 1000 + 50 comissão; A3 com custo direto 400; extras: frete 90 (igual), 10 só da A1
  perform salvar_custeio_lote(1, 'rateio', 1000, 50, 0,
    '[{"tipo":"frete_retirada","descricao":"frete","valor":90,"regra_rateio":"igual"},{"sku":"A1","tipo":"outros","valor":10}]'::jsonb,
    '{"A3":400}'::jsonb);
  insert into res values ('rpc: lote vira composto/rateio', (select custo_origem = 'composto' and modo_custeio = 'rateio' and lance_final = 1000 from lotes where lote = 1), null);
  insert into res values ('base: pool 650 rateado por valor entre A1/A2', (select base from custo_itens_lote(1) where sku='A1') = 216.67 and (select base from custo_itens_lote(1) where sku='A2') = 433.33, null);
  insert into res values ('base: item com custo direto sai da divisão', (select base = 400 and origem = 'direto' from custo_itens_lote(1) where sku='A3'), null);
  insert into res values ('extra do lote (igual) = 30 por peça', (select count(*) = 3 and min(extras_lote) = 30 and max(extras_lote) = 30 from custo_itens_lote(1)), null);
  insert into res values ('extra da peça só na A1', (select extras_item from custo_itens_lote(1) where sku='A1') = 10 and (select sum(extras_item) from custo_itens_lote(1)) = 10, null);
  insert into res values ('soma dos itens = custo do lote (1150)', (select sum(total) from custo_itens_lote(1)) = 1150 and (select custo_total from lotes where lote = 1) = 1150, (select sum(total) from custo_itens_lote(1))::text);
  insert into res values ('pricing_lote_custo sincronizado', (select custo_total from pricing_lote_custo where lote = 1) = 1150, null);

  -- editar extra por id (não apaga e recria) e remover o que não veio
  select id into n from lote_custos_extra where lote = 1 and sku is null;
  perform salvar_custeio_lote(1, 'rateio', 1000, 50, 0, jsonb_build_array(jsonb_build_object('id', n, 'tipo','frete_retirada','valor',120,'regra_rateio','igual')), '{}'::jsonb);
  insert into res values ('editar extra mantém o id e remove os ausentes', (select count(*) = 1 and min(id) = n and min(valor) = 120 from lote_custos_extra where lote = 1), null);
  insert into res values ('extra editado: total 1050+120+400-400', (select sum(total) from custo_itens_lote(1)) = 1170, (select sum(total) from custo_itens_lote(1))::text);

  -- rpc: validações e atomicidade
  m := null; begin perform salvar_custeio_lote(1, 'xx'); exception when others then m := sqlerrm; end;
  insert into res values ('rpc: modo inválido recusa', m like 'Modo%', m);
  m := null; begin perform salvar_custeio_lote(2, 'rateio', 0); exception when others then m := sqlerrm; end;
  insert into res values ('rpc: rateio sem valor recusa', m like 'Informe o valor%', m);
  m := null; begin perform salvar_custeio_lote(2, 'soma', null, null, null, '[{"tipo":"x","valor":5,"regra_rateio":"invalida"}]'::jsonb, '{"B1":10}'::jsonb); exception when others then m := sqlerrm; end;
  insert into res values ('rpc: erro no meio não deixa estado parcial', m is not null and (select custo_direto from itens where sku='B1') is null and (select custo_origem from lotes where lote = 2) is null, m);
  perform salvar_custeio_lote(2, 'soma', null, null, null, '[]'::jsonb, '{"A1":99}'::jsonb);
  insert into res values ('rpc: custo direto de peça de OUTRO lote é ignorado', (select custo_direto from itens where sku='A1') is null, null);

  -- Lote 2 (roupas, por peça): B1=10, B2=20, B3 sem custo, B4 descartada; extra de transporte 30 por peso → sem peso = igual
  perform salvar_custeio_lote(2, 'soma', null, null, null, '[{"tipo":"frete_retirada","descricao":"transporte","valor":30,"regra_rateio":"igual"},{"sku":"B2","tipo":"impostos","valor":5}]'::jsonb, '{"B1":10,"B2":20,"B4":999}'::jsonb);
  insert into res values ('soma: B3 sem custo direto = sem_custo', (select origem = 'sem_custo' and base = 0 from custo_itens_lote(2) where sku='B3'), null);
  insert into res values ('descarte fora da divisão e do custo do lote', (select count(*) from custo_itens_lote(2)) = 3 and (select custo_total from lotes where lote = 2) = 10 + 20 + 30 + 5, (select custo_total from lotes where lote = 2)::text);
  insert into res values ('extra igual 30 entre 3 peças vendáveis', (select sum(extras_lote) from custo_itens_lote(2)) = 30 and (select max(extras_lote) from custo_itens_lote(2)) = 10, null);

  -- globais
  insert into custos_globais (nome, tipo, valor, base, grupos) values ('Embalagem', 'embalagem', 2, 'por_item', array['Vestuário']);
  insert into res values ('global por_item no escopo do grupo (lote 2)', (select globais from custo_itens_lote(2) where sku='B1') = 2 and (select sum(globais) from custo_itens_lote(1)) = 0, null);
  insert into res values ('global entra no custo_total do lote', (select custo_total from lotes where lote = 2) = 65 + 6, (select custo_total from lotes where lote = 2)::text);
  insert into custos_globais (nome, tipo, valor, base, regra_rateio) values ('Taxa do lote', 'outros', 100, 'por_lote', 'igual');
  insert into res values ('global por_lote dividido (lote 1: 3 peças → 100 fecha)', (select sum(globais) from custo_itens_lote(1)) = 100, (select sum(globais) from custo_itens_lote(1))::text);
  insert into custos_globais (nome, tipo, valor, base) values ('Imposto %', 'impostos', 10, 'pct_custo_lote');
  insert into res values ('global % sobre o custo da peça (B1: 2 embalagem + 33,34 do lote + 10% de 20 = 2)', (select globais from custo_itens_lote(2) where sku='B1') = 2 + 33.34 + 2, (select globais from custo_itens_lote(2) where sku='B1')::text);
  insert into custos_globais (nome, valor, vigencia_inicio) values ('Futuro', 50, current_date + 30);
  insert into custos_globais (nome, valor, vigencia_inicio, vigencia_fim) values ('Vencido', 50, current_date - 60, current_date - 30);
  insert into custos_globais (nome, valor, ativo) values ('Inativo', 50, false);
  insert into res values ('globais fora da vigência/inativos não contam', (select sum(globais) from custo_itens_lote(1)) = 100 + round(0.1 * (select sum(base + extras_lote + extras_item) from custo_itens_lote(1)), 2), (select sum(globais) from custo_itens_lote(1))::text);
  insert into custos_globais_excecao (global_id, lote) select id, 1 from custos_globais where nome = 'Taxa do lote';
  insert into res values ('exceção tira o lote do global', (select sum(globais) from custo_itens_lote(1)) = round(0.1 * (select sum(base + extras_lote + extras_item) from custo_itens_lote(1)), 2), null);
  insert into res values ('global escopado por lote', (select count(*) from custos_globais where lotes is null) >= 3, null);

  -- auditoria
  insert into res values ('auditoria: lotes, extras e custo direto registrados', (select count(distinct tabela) from custo_auditoria) >= 4, (select string_agg(distinct tabela, ',') from custo_auditoria));
  insert into res values ('auditoria: custo direto guarda antes/depois', exists (select 1 from custo_auditoria where tabela = 'itens' and sku = 'B1' and (depois->>'custo_direto')::numeric = 10), null);
  insert into res values ('auditoria: usuário preenchido', not exists (select 1 from custo_auditoria where usuario is null), null);

  -- custo congelado na venda
  select total into v from custo_itens_lote(1) where sku = 'A1';
  update itens set status = 'VENDIDO' where sku = 'A1';
  insert into res values ('venda congela o custo da peça', (select custo_na_venda from itens where sku='A1') = v, v::text);
  perform salvar_custeio_lote(1, 'rateio', 5000, 0, 0, '[]'::jsonb, '{}'::jsonb);
  insert into res values ('mudar o lote depois não altera o custo congelado', (select custo_na_venda from itens where sku='A1') = v, null);
  update itens set status = 'PRONTO' where sku = 'A1'; update itens set status = 'VENDIDO' where sku = 'A1';
  insert into res values ('revendida não recalcula (já congelado)', (select custo_na_venda from itens where sku='A1') = v, null);
  update itens set status = 'VENDIDO' where sku = 'L1';
  insert into res values ('peça de lote legado vendida: custo_na_venda segue nulo', (select custo_na_venda from itens where sku = 'L1') is null, null);
end $$;

insert into res select 'anon sem acesso aos custos', not has_table_privilege('anon','lote_custos_extra','select') and not has_table_privilege('anon','custos_globais','select') and not has_table_privilege('anon','custo_auditoria','select'), null;
insert into res select 'anon não executa as RPCs de custo', not has_function_privilege('anon','custo_itens_lote(integer)','execute') and not has_function_privilege('anon','salvar_custeio_lote(integer,text,numeric,numeric,numeric,jsonb,jsonb)','execute'), null;
insert into res select 'authenticated não escreve na auditoria', has_table_privilege('authenticated','custo_auditoria','select') and not has_table_privilege('authenticated','custo_auditoria','insert'), null;
select case when ok then 'PASS' else 'FAIL' end || ' | ' || teste || coalesce(' | ' || detalhe, '') from res;
