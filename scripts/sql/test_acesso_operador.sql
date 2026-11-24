-- Regras de acesso gestor × operador (20261124150000). Roda depois dos testes de pagamentos, no mesmo banco.
\set QUIET on
create temp table res (teste text, ok boolean, detalhe text);
grant all on res to authenticated, anon;
insert into itens (sku, produto, status, preco_ideal) values ('A1','A','PRONTO',100),('A2','B','PRONTO',100),('A3','C','PRONTO',50);
insert into campanha_itens (campanha_id, sku, preco_cheio, desconto_pct) values (gen_random_uuid(),'A2',100,20);
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
end $$;
reset role;
select case when ok then 'PASS' else 'FAIL' end || ' | ' || teste || coalesce(' | ' || detalhe, '') from res;
