-- Comportamento da migration 20261028120000_sacolas_whatsapp.sql (checks, RPC pública, fluxo).
-- Rode DEPOIS de base_minima.sql + 20260801130000_orcamentos + a migration das sacolas.
\set QUIET on
grant all on all tables in schema public to anon, authenticated;
create temp table res (teste text, ok boolean, detalhe text);
grant all on res to anon, authenticated;

insert into itens (sku, produto, status, preco_ideal) values
  ('S1','Fone','PRONTO',100),('S2','Cabo','PRONTO',50),('S3','Mouse','PRONTO',70),('S4','Teclado','PRONTO',90);
insert into catalogos_publicos (slug, titulo, payload) values
  ('of1','Oferta','{"itens":[{"sku":"S1"},{"sku":"S2"},{"sku":"S3"},{"sku":"S4"}]}');

-- checks
do $$ declare ok1 boolean := true; ok2 boolean := true; ok3 boolean := false; begin
  begin insert into orcamentos (codigo,slug,status,itens,validade,origem) values ('T-A','t-a','ABERTA','[]',now()+interval '3 days','whatsapp'); exception when others then ok1 := false; end;
  begin insert into orcamentos (codigo,slug,status,itens,validade) values ('T-E','t-e','ENTREGUE','[]',now()+interval '1 day'); exception when others then ok2 := false; end;
  begin insert into orcamentos (codigo,slug,status,itens,validade) values ('T-X','t-x','LIXO','[]',now()+interval '1 day'); exception when check_violation then ok3 := true; end;
  insert into res values ('status ABERTA aceito', ok1, null), ('status ENTREGUE aceito', ok2, null), ('status inválido recusado', ok3, null);
  ok3 := false;
  begin insert into orcamentos (codigo,slug,status,itens,validade,origem) values ('T-O','t-o','ABERTA','[]',now(),'zap'); exception when check_violation then ok3 := true; end;
  insert into res values ('origem inválida recusada', ok3, null);
  insert into res select 'origem padrão = orcamento', origem = 'orcamento', origem from orcamentos where codigo = 'T-E';
end $$;

-- oferta_indisponiveis: reserva ativa esconde; reserva vencida não; vendido esconde
update itens set reservado_ate = now() + interval '2 days', reservado_por_orc = 'T-A' where sku = 'S1';
update itens set reservado_ate = now() - interval '1 hour', reservado_por_orc = 'T-OLD' where sku = 'S2';
update itens set status = 'VENDIDO' where sku = 'S3';
set role anon;
insert into res select 'anon vê indisponíveis (reservado ativo + vendido)',
  (select array_agg(s order by s) from oferta_indisponiveis('of1') s) = array['S1','S3'],
  (select string_agg(s, ',' order by s) from oferta_indisponiveis('of1') s);
insert into res select 'slug desconhecido não devolve nada', (select count(*) from oferta_indisponiveis('nao-existe')) = 0, null;
reset role;

-- fluxo: separar (2 itens) → pagar → entregar, como as operações de sacolas.js fazem
insert into orcamentos (codigo,slug,status,itens,total,validade,origem,cliente_nome)
  values ('ORC-F1','f1','ABERTA','[{"sku":"S4","preco":90},{"sku":"S2","preco":50}]',140,now()+interval '3 days','whatsapp','Ana');
update itens set reservado_ate = now() + interval '3 days', reservado_por_orc = 'ORC-F1' where sku in ('S4','S2');
insert into res select 'orcamento_publico não expõe sacola ABERTA', count(*) = 0, null from orcamento_publico('f1');
update itens set status='VENDIDO', valor_vendido = 90, canal_venda='WhatsApp', comprador='Ana', pedido_ref='ORC-F1' where sku='S4';
update itens set status='VENDIDO', valor_vendido = 50, canal_venda='WhatsApp', comprador='Ana', pedido_ref='ORC-F1' where sku='S2';
update itens set reservado_ate = null, reservado_por_orc = null where reservado_por_orc = 'ORC-F1';
update orcamentos set status='VENDIDO', pago_em=now(), forma_pagamento='Pix', valor_pago=140 where codigo='ORC-F1';
insert into res select 'pago: itens vendidos no canal WhatsApp e reserva liberada',
  (select count(*) from itens where pedido_ref='ORC-F1' and status='VENDIDO' and canal_venda='WhatsApp' and reservado_ate is null) = 2
  and (select valor_pago from orcamentos where codigo='ORC-F1') = 140, null;
update itens set status='ENTREGUE' where pedido_ref='ORC-F1';
update orcamentos set status='ENTREGUE', entregue_em=now() where codigo='ORC-F1';
insert into res select 'entregue: sacola e itens', (select status from orcamentos where codigo='ORC-F1') = 'ENTREGUE'
  and (select count(*) from itens where pedido_ref='ORC-F1' and status='ENTREGUE') = 2, null;

select case when ok then 'PASS' else 'FAIL' end || ' | ' || teste || coalesce(' | ' || detalhe, '') from res;
