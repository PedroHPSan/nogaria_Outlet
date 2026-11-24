-- Regras de acesso gestor × operador (20261124150000). Roda depois dos testes de pagamentos, no mesmo banco.
\set QUIET on
create temp table res (teste text, ok boolean, detalhe text);
grant all on res to authenticated, anon;
insert into itens (sku, produto, status, preco_ideal) values ('A1','A','PRONTO',100),('A2','B','PRONTO',100),('A3','C','PRONTO',50);
insert into campanhas (id, status, inicio_em, fim_em) values ('00000000-0000-0000-0000-00000000000a','PUBLICADA', now()-interval '1 day', now()+interval '1 day'), ('00000000-0000-0000-0000-00000000000b','RASCUNHO', null, null);
insert into campanha_itens (campanha_id, sku, canal, preco_cheio, desconto_pct) values ('00000000-0000-0000-0000-00000000000a','A2','whatsapp',100,20), ('00000000-0000-0000-0000-00000000000b','A3','*',50,60);
insert into itens (sku, produto, status, preco_ideal) values ('A4','sem preço','PRONTO',null),('A5','promo velha','PRONTO',100),('A6','vendido','PRONTO',100);
insert into campanhas (id, status, inicio_em, fim_em) values ('00000000-0000-0000-0000-00000000000c','PUBLICADA', now()-interval '6 days', now()-interval '3 days');
insert into campanha_itens (campanha_id, sku, canal, preco_cheio, desconto_pct) values ('00000000-0000-0000-0000-00000000000c','A5','whatsapp',100,50);
insert into orcamentos (codigo, slug, status, itens, total, validade, origem, cliente_nome) values
  ('OP-1','op1','ABERTA','[{"sku":"A1","preco":100}]',100, now()+interval '1 day','whatsapp','Ana');
insert into reservas (sku, canal, origem_tipo, origem_ref, status, expira_em) values ('A1','whatsapp','sacola','OP-1','ATIVA', now()+interval '1 day');

-- anon: só o catálogo público
do $$ begin
  insert into res values ('anon sem escrita em orcamentos', not has_table_privilege('anon','orcamentos','select,insert,update,delete'), null);
  insert into res values ('anon sem leitura de itens', not has_table_privilege('anon','itens','select'), null);
  insert into res values ('anon lê o catálogo público', has_table_privilege('anon','catalogos_publicos','select'), null);
  insert into res values ('anon não escreve no catálogo público', not has_table_privilege('anon','catalogos_publicos','insert,update,delete'), null);
  insert into res values ('reservas: authenticated lê mas não escreve', has_table_privilege('authenticated','reservas','select') and not has_table_privilege('authenticated','reservas','insert,update,delete'), null);
end $$;

-- operador
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"isabela@nogaria.com.br"}', false) \gset
do $$ declare m text; begin
  begin update reservas set status = 'CONFIRMADA' where origem_ref = 'OP-1'; exception when others then m := sqlerrm; end;
  insert into res values ('operador não confirma reserva direto', m like '%permission denied%', m);
  m := null; begin insert into orcamentos (codigo,slug,status,itens,validade,origem) values ('OP-V','opv','VENDIDO','[]',now()+interval '1 day','whatsapp'); exception when others then m := sqlerrm; end;
  insert into res values ('operador não cria sacola já VENDIDA', m like '%só pode nascer ABERTA%', m);
  m := null; begin insert into orcamentos (codigo,slug,status,itens,validade,origem,desconto_pct) values ('OP-D','opd','ABERTA','[{"sku":"A3","preco":50}]',now()+interval '1 day','whatsapp',30); exception when others then m := sqlerrm; end;
  insert into res values ('operador não dá desconto', m like '%dão desconto%', m);
  m := null; begin insert into orcamentos (codigo,slug,status,itens,validade,origem) values ('OP-P','opp','ABERTA','[{"sku":"A1","preco":10}]',now()+interval '1 day','whatsapp'); exception when others then m := sqlerrm; end;
  insert into res values ('operador não cria sacola com preço abaixo do piso', m like '%abaixo do mínimo%', m);
  m := null; begin update orcamentos set itens = '[{"sku":"A1","preco":1}]' where codigo='OP-1'; exception when others then m := sqlerrm; end;
  insert into res values ('operador não derruba o preço de item da sacola', m like '%abaixo do mínimo%', m);
  -- preço de campanha (20% off de 100 = 80) é aceito; item novo ao preço de tabela também
  update orcamentos set itens = '[{"sku":"A1","preco":100},{"sku":"A2","preco":80},{"sku":"A3","preco":50}]' where codigo='OP-1';
  insert into res values ('preço de campanha e de tabela aceitos', (select jsonb_array_length(itens) from orcamentos where codigo='OP-1') = 3, null);
  insert into res values ('total recalculado dos itens', (select total from orcamentos where codigo='OP-1') = 230, (select total::text from orcamentos where codigo='OP-1'));
  update orcamentos set total = 1 where codigo='OP-1';
  insert into res values ('total adulterado volta ao valor dos itens', (select total from orcamentos where codigo='OP-1') = 230, (select total::text from orcamentos where codigo='OP-1'));
  m := null; begin update orcamentos set desconto_pct = 50 where codigo='OP-1'; exception when others then m := sqlerrm; end;
  insert into res values ('operador não muda desconto', m like '%mudam o desconto%', m);
  m := null; begin update orcamentos set status = 'RASCUNHO' where codigo='OP-1'; exception when others then m := sqlerrm; end;
  insert into res values ('ABERTA → RASCUNHO recusado', m like '%não é permitida%', m);
  m := null; begin update orcamentos set status = 'EXPIRADO' where codigo='OP-1'; exception when others then m := sqlerrm; end;
  insert into res values ('operador não expira sacola na mão', m like '%não é permitida%', m);

  m := null; begin update orcamentos set itens = itens || '[{"sku":"A3","preco":21}]'::jsonb where codigo='OP-1' and false; exception when others then m := sqlerrm; end;
  -- rascunho de campanha (60% off) NÃO baixa o piso do A3 (50 → piso 49)
  m := null; begin insert into orcamentos (codigo,slug,status,itens,validade,origem) values ('OP-R','opr','ABERTA','[{"sku":"A3","preco":21}]',now()+interval '1 day','whatsapp'); exception when others then m := sqlerrm; end;
  insert into res values ('campanha em rascunho não baixa o piso', m like '%abaixo do mínimo%', m);

  m := null; begin insert into orcamentos (codigo,slug,status,itens,validade,origem) values ('OP-V2','opv2','ABERTA','[{"sku":"A5","preco":40}]',now()+interval '1 day','whatsapp'); exception when others then m := sqlerrm; end;
  insert into res values ('campanha publicada mas já encerrada há dias não baixa o piso', m like '%abaixo do mínimo%', m);
  m := null; begin insert into orcamentos (codigo,slug,status,itens,validade,origem) values ('OP-S','ops','ABERTA','[{"sku":"A4","preco":5}]',now()+interval '1 day','whatsapp'); exception when others then m := sqlerrm; end;
  insert into res values ('item sem preço de tabela: recusado (fecha fechado)', m like '%sem preço de venda%', m);
  m := null; begin insert into orcamentos (codigo,slug,status,itens,validade,origem) values ('OP-X','opx','ABERTA','[{"sku":"NAO-EXISTE","preco":5}]',now()+interval '1 day','whatsapp'); exception when others then m := sqlerrm; end;
  insert into res values ('SKU inexistente: recusado', m like '%inexistente ou sem preço%', m);
  m := null; begin insert into orcamentos (codigo,slug,status,itens,validade,origem) values ('OP-J','opj','ABERTA','{}',now()+interval '1 day','whatsapp'); exception when others then m := sqlerrm; end;
  insert into res values ('itens que não é lista: recusado', m like '%inválidos%', m);
  m := null; begin update orcamentos set origem = 'orcamento' where codigo='OP-1'; exception when others then m := sqlerrm; end;
  insert into res values ('operador não troca a origem', m like '%mudam a origem%', m);
  m := null; begin update orcamentos set itens = '[{"sku":"A2","preco":80},{"sku":"A3","preco":50}]' where codigo='OP-1'; exception when others then m := sqlerrm; end;
  insert into res values ('operador não tira do JSON item que segue reservado', m like '%reservado ou já vendido%', m);
  m := null; begin insert into campanhas (status) values ('PUBLICADA'); exception when others then m := sqlerrm; end;
  insert into res values ('operador não cria campanha', m like '%Campanhas: só%', m);
  m := null; begin update campanha_itens set desconto_pct = 90 where sku='A2'; exception when others then m := sqlerrm; end;
  insert into res values ('operador não muda desconto de campanha', m like '%Campanhas: só%', m);
  update campanha_itens set preco_cheio = 120 where sku='A2';
  insert into res values ('cascata de preço_cheio continua livre', (select preco_cheio from campanha_itens where sku='A2') = 120, null);
  update campanha_itens set preco_cheio = 100 where sku='A2';
end $$;
reset role;
select set_config('request.jwt.claims', '', false) \gset

-- gestor
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"barbaranogueira@nogaria.com.br"}', false) \gset
do $$ begin
  update orcamentos set desconto_pct = 10 where codigo='OP-1';
  insert into res values ('gestor dá desconto e o total acompanha', (select total from orcamentos where codigo='OP-1') = 207, (select total::text from orcamentos where codigo='OP-1'));
  update orcamentos set itens = '[{"sku":"A1","preco":10}]', desconto_pct = 0 where codigo='OP-1';
  insert into res values ('gestor muda preço livremente', (select total from orcamentos where codigo='OP-1') = 10, null);
  insert into campanhas (status) values ('RASCUNHO');
  insert into res values ('gestor cria campanha', (select count(*) from campanhas) = 4, null);
end $$;
reset role;

-- sacola paga: reserva confirmada / item vendido / desconto da sacola
insert into orcamentos (codigo, slug, status, itens, total, validade, origem) values
  ('OP-2','op2','ABERTA','[{"sku":"A6","preco":100}]',100, now()+interval '1 day','whatsapp');
insert into reservas (sku, canal, origem_tipo, origem_ref, status, expira_em) values ('A6','whatsapp','sacola','OP-2','CONFIRMADA', null);
insert into orcamentos (codigo, slug, status, itens, total, validade, origem, desconto_pct) values
  ('OP-3','op3','ABERTA','[{"sku":"A3","preco":50}]',25, now()+interval '1 day','whatsapp', 50);
insert into orcamentos (codigo, slug, status, itens, total, validade, origem) values ('OP-4','op4','VENDIDO','[{"sku":"A3","preco":50}]',50, now()+interval '1 day','whatsapp');
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"aline@nogaria.com.br"}', false) \gset
do $$ declare m text; begin
  begin update orcamentos set itens = '[]' where codigo='OP-2'; exception when others then m := sqlerrm; end;
  insert into res values ('não tira item com reserva CONFIRMADA', m like '%reservado ou já vendido%', m);
  m := null; begin update orcamentos set itens = '[{"sku":"A3","preco":50},{"sku":"A2","preco":100}]' where codigo='OP-3'; exception when others then m := sqlerrm; end;
  insert into res values ('piso considera o desconto da sacola', m like '%abaixo do mínimo%', m);
  m := null; begin perform baixar_venda('A3', 50, 'WhatsApp', 'OP-4', 'x', null, null, 'aline'); exception when others then m := sqlerrm; end;
  insert into res values ('venda sob sacola VENDIDA recusada', m like '%não aceita venda de item%', m);
end $$;
reset role;

-- rodada 4: código imutável, cancelar/excluir só gestor, preço NaN, pedido_ref de item vendido
insert into itens (sku, produto, status, preco_ideal, pedido_ref) values ('A7','x','VENDIDO',100,'OP-4'),('A8','y','VENDIDO',100,null);
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"debora@x.com"}', false) \gset
do $$ declare m text; begin
  begin update orcamentos set codigo = 'OP-ZZ' where codigo='OP-3'; exception when others then m := sqlerrm; end;
  insert into res values ('operador não renomeia o código', m like '%mudam o código%', m);
  m := null; begin update orcamentos set status = 'CANCELADO' where codigo='OP-3'; exception when others then m := sqlerrm; end;
  insert into res values ('operador não cancela sacola', m is not null, m);
  m := null; begin delete from orcamentos where codigo='OP-2'; exception when others then m := sqlerrm; end;
  insert into res values ('operador não exclui sacola com reserva confirmada', m like '%só desfaz a própria sacola%', m);
  m := null; begin update itens set pedido_ref = 'OUTRO' where sku='A7'; exception when others then m := sqlerrm; end;
  insert into res values ('operador não troca o pedido_ref de item vendido sob sacola', m like '%envolve uma sacola%', m);
  m := null; begin insert into orcamentos (codigo,slug,status,itens,validade,origem) values ('OP-N','opn','ABERTA','[{"sku":"A3","preco":"NaN"}]',now()+interval '1 day','whatsapp'); exception when others then m := sqlerrm; end;
  insert into res values ('preço NaN recusado', m like '%preço inválido%', m);

  m := null; begin update itens set pedido_ref = 'OP-4' where sku='A8'; exception when others then m := sqlerrm; end;
  insert into res values ('operador não anexa item vendido (sem ref) a uma sacola', m like '%envolve uma sacola%', m);
  m := null; begin update orcamentos set itens = replace(itens::text, '"preco": 50', '"preco": "50"')::jsonb where codigo='OP-3'; exception when others then m := sqlerrm; end;
  insert into res values ('preço de número para texto igual é recusado', m like '%preço inválido%', m);
  m := null; begin delete from orcamentos where codigo='OP-3'; exception when others then m := sqlerrm; end;
  insert into res values ('operador não exclui sacola de outro/antiga', m like '%só desfaz a própria sacola%', m);
  insert into orcamentos (codigo,slug,status,itens,validade,origem,criado_por) values ('OP-U','opu','ABERTA','[{"sku":"A3","preco":50}]',now()+interval '1 day','whatsapp','debora@x.com');
  delete from orcamentos where codigo='OP-U';
  insert into res values ('operador desfaz a própria sacola nova (undo do separar)', not exists (select 1 from orcamentos where codigo='OP-U'), null);
end $$;
reset role;
select case when ok then 'PASS' else 'FAIL' end || ' | ' || teste || coalesce(' | ' || detalhe, '') from res;
