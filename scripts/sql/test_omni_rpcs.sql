-- Comportamento da migration 20261102130000_omnichannel_rpcs.sql (roda como supabase_admin).
\set QUIET on
create temp table res (teste text, ok boolean, detalhe text);
insert into itens (sku, produto, status, preco_ideal) values
  ('R1','A','PRONTO',10),('R2','B','PRONTO',10),('R3','C','PRONTO',10),('R4','D','PRONTO',10),('R5','E','VENDIDO',10);

-- reservar_item
select reservar_item('R1','whatsapp','sacola','ORC-A', now()+interval '2 days','t@x');
insert into res select 'reservar projeta em itens', (select reservado_por_orc from itens where sku='R1')='ORC-A', null;
select reservar_item('R1','whatsapp','sacola','ORC-A', now()+interval '3 days','t@x');
insert into res select 'mesma origem renova (1 reserva ativa)', (select count(*) from reservas where sku='R1' and status='ATIVA')=1, null;
do $$ declare m text; begin
  begin perform reservar_item('R1','amazon','pedido_amazon','A-1'); exception when others then m := sqlerrm; end;
  insert into res values ('outra origem recusada com motivo', m like '%R1%já separado em ORC-A%', m);
  m := null;
  begin perform reservar_item('R5','whatsapp','sacola','ORC-B'); exception when others then m := sqlerrm; end;
  insert into res values ('vendido não reserva', m like '%fora de estoque%', m);
end $$;

-- reservar_itens é tudo ou nada
do $$ declare m text; begin
  begin perform reservar_itens(array['R2','R1'],'whatsapp','sacola','ORC-C'); exception when others then m := sqlerrm; end;
  insert into res values ('reservar_itens falha no conflito', m is not null, m);
  insert into res values ('reservar_itens não deixa R2 reservado', (select count(*) from reservas where sku='R2')=0, null);
end $$;

-- expiração libera
update reservas set expira_em = now() - interval '1 minute' where sku='R1';
select reservar_item('R1','amazon','pedido_amazon','A-1');
insert into res select 'reserva vencida deixa outra origem reservar', (select origem_ref from reservas where sku='R1' and status='ATIVA')='A-1', null;
select liberar_reserva('pedido_amazon','A-1');
insert into res select 'liberar limpa projeção', (select reservado_ate from itens where sku='R1') is null, null;

-- baixar_venda
do $$ declare m text; begin
  perform reservar_item('R3','whatsapp','sacola','ORC-D', now()+interval '2 days');
  begin perform baixar_venda('R3', 10, 'Amazon', 'OUTRO-1', null, null, null, 't@x'); exception when others then m := sqlerrm; end;
  insert into res values ('venda de item reservado por outra origem recusada', m like '%reservado por ORC-D%', m);
  perform baixar_venda('R3', 10, 'WhatsApp', 'ORC-D', 'Ana', null, null, 't@x');
  insert into res values ('baixa grava venda e canal', (select status='VENDIDO' and canal_codigo='whatsapp' and valor_vendido=10 and pedido_ref='ORC-D' from itens where sku='R3'), null);
  insert into res values ('reserva vira CONFIRMADA e projeção limpa', (select status from reservas where sku='R3')='CONFIRMADA' and (select reservado_ate from itens where sku='R3') is null, null);
  insert into res values ('1 evento de venda', (select count(*) from eventos where sku='R3' and acao='status:VENDIDO')=1, null);
  m := null;
  begin perform baixar_venda('R3', 10, 'Amazon', null); exception when others then m := sqlerrm; end;
  insert into res values ('revenda recusada', m like '%já vendido%', m);
end $$;

-- baixar_vendas: sem venda parcial
do $$ declare m text; begin
  begin perform baixar_vendas('[{"sku":"R4","valor":5},{"sku":"R3","valor":5}]'::jsonb, 'Amazon', 'P-1'); exception when others then m := sqlerrm; end;
  insert into res values ('lote com item vendido falha', m is not null, m);
  insert into res values ('lote não deixa R4 vendido', (select status from itens where sku='R4')='PRONTO', null);
  perform baixar_vendas('[{"sku":"R4","valor":5},{"sku":"R2","valor":7}]'::jsonb, 'Amazon', 'P-2', 'Zé', 't@x');
  insert into res values ('lote ok vende os dois', (select count(*) from itens where pedido_ref='P-2' and status='VENDIDO')=2, null);
end $$;

-- grants
insert into res select 'anon não executa baixar_venda', not has_function_privilege('anon','baixar_venda(text,numeric,text,text,text,numeric,numeric,text)','execute'), null;
insert into res select 'authenticated executa reservar_item', has_function_privilege('authenticated','reservar_item(text,text,text,text,timestamptz,text)','execute'), null;

select case when ok then 'PASS' else 'FAIL' end || ' | ' || teste || coalesce(' | ' || detalhe, '') from res;
