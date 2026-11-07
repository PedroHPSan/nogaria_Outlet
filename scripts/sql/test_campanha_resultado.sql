-- campanha_resultado (20261107190000). Roda como supabase_admin.
\set QUIET on
create temp table res (teste text, ok boolean, detalhe text);
insert into itens (sku, produto, status, preco_ideal, grupo, lote, estado) values
 ('R1','No prazo','PRONTO',100,'Vestuário',1,'NOVO'),
 ('R2','Manteve','PRONTO',200,'Calçados',1,'NOVO'),
 ('R3','Cheio','PRONTO',200,'Calçados',1,'NOVO'),
 ('R4','Em sacola aberta','PRONTO',300,'Ferramentas',1,'NOVO'),
 ('R5','Livre','PRONTO',50,'Ferramentas',1,'NOVO'),
 ('R6','Vendido fora','PRONTO',60,'Vestuário',1,'NOVO'),
 ('R7','Fora da campanha','PRONTO',70,'Vestuário',2,'NOVO');

do $$ declare c uuid; r jsonb; m text; begin
  insert into campanhas (nome, inicio_em, fim_em) values ('Resultado', now()-interval '2 days', now()+interval '2 days') returning id into c;
  insert into campanha_regras (campanha_id, tipo, alvo, desconto_pct) values (c,'item','R1',20),(c,'item','R2',20),(c,'item','R3',20),(c,'item','R4',20),(c,'item','R5',20),(c,'item','R6',20);
  perform campanha_publicar(c);

  insert into campanha_vendas (campanha_id, sku, origem_ref, canal, preco_cheio, preco_promo, valor_vendido, decisao) values
   (c,'R1','S-1','whatsapp',100,80,80,'no_prazo'),
   (c,'R2','S-2','whatsapp',200,160,160,'manteve_promo'),
   (c,'R3','S-3','whatsapp',200,160,200,'preco_cheio');
  update itens set status='VENDIDO', valor_vendido=80, vendido_em=now() where sku='R1';
  update itens set status='VENDIDO', valor_vendido=160, vendido_em=now() where sku='R2';
  update itens set status='VENDIDO', valor_vendido=200, vendido_em=now() where sku='R3';
  update itens set status='VENDIDO', valor_vendido=48, vendido_em=now() where sku='R6';   -- vendido por outro canal, sem ledger
  insert into orcamentos (codigo, slug, status, itens, total, validade) values
   ('S-9','s9','RESERVADO',('[{"sku":"R4","preco":240,"preco_cheio":300,"campanha_id":"'||c||'"}]')::jsonb, 240, now()+interval '1 day'),
   ('S-8','s8','RESERVADO','[{"sku":"R7","preco":70}]'::jsonb, 50, now()+interval '1 day');

  r := campanha_resultado(c);
  insert into res values ('itens na campanha', (r->>'itens_na_campanha')::int = 6, r->>'itens_na_campanha');   -- lote 1: R1..R6
  insert into res values ('no prazo: 1 item, receita 80, desconto 20', (r->'por_decisao'->'no_prazo'->>'itens')::int = 1 and (r->'por_decisao'->'no_prazo'->>'receita')::numeric = 80 and (r->'por_decisao'->'no_prazo'->>'desconto')::numeric = 20, r->'por_decisao'->>'no_prazo');
  insert into res values ('manteve promo: desconto concedido depois do fim (40)', (r->'por_decisao'->'manteve_promo'->>'desconto')::numeric = 40, r->'por_decisao'->>'manteve_promo');
  insert into res values ('preço cheio: sem desconto concedido', (r->'por_decisao'->'preco_cheio'->>'desconto')::numeric = 0 and (r->'por_decisao'->'preco_cheio'->>'receita')::numeric = 200, r->'por_decisao'->>'preco_cheio');
  insert into res values ('sacolas abertas: desconto ainda comprometido (60)', (r->'sacolas_abertas'->>'itens')::int = 1 and (r->'sacolas_abertas'->>'desconto_comprometido')::numeric = 60 and (r->'sacolas_abertas'->>'valor')::numeric = 240, r->>'sacolas_abertas');
  insert into res values ('não vendidos: só R5 está livre (R4 está em sacola)', (r->>'nao_vendidos')::int = 1, r->>'nao_vendidos');
  insert into res values ('fora da sacola: R6 (48)', (r->'fora_da_sacola'->>'itens')::int = 1 and (r->'fora_da_sacola'->>'receita')::numeric = 48, r->>'fora_da_sacola');
  insert into res values ('lista de vendas traz as 3', jsonb_array_length(r->'vendas') = 3 and (r->'vendas'->0->>'produto') is not null, null);
  insert into res values ('campanha inexistente → null', campanha_resultado(gen_random_uuid()) is null, null);
  insert into campanhas (nome, inicio_em, fim_em) values ('Vazia', now(), now()+interval '1 day') returning id into c;
  r := campanha_resultado(c);
  insert into res values ('campanha sem vendas → estruturas vazias', (r->>'itens_na_campanha')::int = 0 and r->'por_decisao' = '{}'::jsonb and (r->>'nao_vendidos')::int = 0 and jsonb_array_length(r->'vendas') = 0, r::text);
end $$;
insert into res select 'anon não executa campanha_resultado', not has_function_privilege('anon','campanha_resultado(uuid)','execute'), null;
select case when ok then 'PASS' else 'FAIL' end || ' | ' || teste || coalesce(' | ' || detalhe, '') from res;
