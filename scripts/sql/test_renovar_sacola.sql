-- Comportamento da RPC renovar_sacola (20261103110000). Roda como supabase_admin.
\set QUIET on
create temp table res (teste text, ok boolean, detalhe text);
insert into itens (sku, produto, status, preco_ideal) values ('Q1','A','PRONTO',10),('Q2','B','PRONTO',10),('Q3','C','PRONTO',10);
insert into orcamentos (codigo, slug, status, itens, cliente_whatsapp, validade) values
 ('ORC-T1','t1','EXPIRADO','[{"sku":"Q1"},{"sku":"Q2"}]','+55 (11) 99999-0001', now()-interval '1 day'),
 ('ORC-T2','t2','ABERTA','[{"sku":"Q3"}]','5511999990002', now()+interval '1 day'),
 ('ORC-T3','t3','CANCELADO','[{"sku":"Q3"}]',null, now());
do $$ declare m text; o orcamentos; id1 uuid; begin
  select id into id1 from orcamentos where codigo='ORC-T1';
  o := renovar_sacola(id1, 7, 't@x');
  insert into res values ('reabre EXPIRADO -> ABERTA', o.status='ABERTA' and o.validade > now()+interval '6 days', null);
  insert into res values ('reserva os 2 itens', (select count(*) from reservas where origem_ref='ORC-T1' and status='ATIVA')=2, null);
  begin perform renovar_sacola(id1, 5, 't@x'); exception when others then m := sqlerrm; end;
  insert into res values ('prazo inválido recusa', m = 'Prazo inválido.', m);
  m := null;
  begin perform renovar_sacola((select id from orcamentos where codigo='ORC-T3'), 3, 't@x'); exception when others then m := sqlerrm; end;
  insert into res values ('CANCELADO recusa', m is not null, m);
  -- bot de OUTRO cliente segura Q3
  perform reservar_item('Q3','whatsapp','carrinho_wa',null, now()+interval '1 hour','wa:5511888880000');
  m := null;
  begin perform renovar_sacola((select id from orcamentos where codigo='ORC-T2'), 3, 't@x'); exception when others then m := sqlerrm; end;
  insert into res values ('não toma reserva do bot de outro cliente', m like '%outro cliente%', m);
  insert into res values ('reserva do bot intacta', (select count(*) from reservas where sku='Q3' and origem_tipo='carrinho_wa' and status='ATIVA')=1, null);
  -- bot do MESMO cliente pode ser assumido
  update reservas set criado_por='wa:5511999990002' where sku='Q3' and status='ATIVA';
  o := renovar_sacola((select id from orcamentos where codigo='ORC-T2'), 3, 't@x');
  insert into res values ('assume reserva do bot do mesmo cliente', (select origem_tipo from reservas where sku='Q3' and status='ATIVA')='sacola', null);
end $$;
insert into res select 'anon não executa', not has_function_privilege('anon','renovar_sacola(uuid,integer,text)','execute'), null;
select case when ok then 'PASS' else 'FAIL' end || ' | ' || teste || coalesce(' | ' || detalhe, '') from res;
