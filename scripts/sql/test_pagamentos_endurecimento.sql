-- Reforço da trava de pagamentos (20261124130000). Roda depois de test_pagamentos_sacola.sql, no mesmo banco.
\set QUIET on
create temp table res (teste text, ok boolean, detalhe text);
grant all on res to authenticated;
grant select, insert, update, delete on itens, reservas, orcamentos to authenticated;
insert into itens (sku, produto, status, preco_ideal) values ('H1','H','PRONTO',100),('H2','I','PRONTO',50);
insert into orcamentos (codigo, slug, status, itens, total, validade, origem, cliente_nome) values
  ('HX-1','hx1','ABERTA','[{"sku":"H1","preco":100}]',100, now()+interval '1 day','whatsapp','Ze'),
  ('HX-2','hx2','ABERTA','[{"sku":"H2","preco":50}]',50, now()+interval '1 day','whatsapp','Bia');
insert into reservas (sku, canal, origem_tipo, origem_ref, status, expira_em) values
  ('H1','whatsapp','sacola','HX-1','ATIVA', now()+interval '1 day'),('H2','whatsapp','sacola','HX-2','ATIVA', now()+interval '1 day');

set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"vendedor@nogaria.com.br"}', false) \gset
do $$ declare m text; begin
  begin perform baixar_venda('H1', 100, 'WhatsApp', 'HX-1', 'Ze', null, null, 'vendedor'); exception when others then m := sqlerrm; end;
  insert into res values ('baixar_venda direto com saldo: recusado', m like '%a receber%', m);
  m := null; begin perform baixar_vendas('[{"sku":"H1","valor":100}]'::jsonb, 'WhatsApp', 'HX-1', 'Ze', 'vendedor'); exception when others then m := sqlerrm; end;
  insert into res values ('baixar_vendas direto com saldo: recusado', m like '%a receber%', m);
  m := null; begin update orcamentos set status='ENTREGUE' where codigo='HX-1'; exception when others then m := sqlerrm; end;
  insert into res values ('ABERTA → ENTREGUE com saldo: recusado', m like '%falta receber%', m);
  update orcamentos set total = 1 where codigo='HX-1';
  m := null; begin update orcamentos set status='VENDIDO' where codigo='HX-1'; exception when others then m := sqlerrm; end;
  insert into res values ('total adulterado não zera o saldo', m like '%falta receber R$ 100%', m);
  m := null; begin perform baixar_venda('H1', 100, 'WhatsApp', 'HX-1', 'Ze', null, null, 'vendedor'); exception when others then m := sqlerrm; end;
  insert into res values ('total adulterado: baixa direta também recusada', m like '%a receber%', m);
  update orcamentos set total = 100 where codigo='HX-1';
  m := null; begin update orcamentos set liberada_com_saldo_por='x', liberada_com_saldo_em=now() where codigo='HX-1'; exception when others then m := sqlerrm; end;
  insert into res values ('não-gestor não forja liberação com saldo', m like '%pagamento_registrar%', m);
  m := null; begin update orcamentos set valor_pago = 100 where codigo='HX-1'; exception when others then m := sqlerrm; end;
  insert into res values ('não-gestor não edita valor_pago', m like '%pagamento_registrar%', m);
  m := null; begin insert into orcamentos (codigo,slug,status,itens,validade,origem,valor_pago) values ('HX-I','hxi','ABERTA','[]',now()+interval '1 day','whatsapp',10); exception when others then m := sqlerrm; end;
  insert into res values ('não-gestor não cria sacola já "paga"', m like '%Pagamento só se registra%', m);
  perform pagamento_registrar((select id from orcamentos where codigo='HX-2'), 20, 'Pix', null, null, null, 'kh1', null, 'falsificado@x');
  insert into res values ('autor do pagamento vem do JWT', (select registrado_por from orcamento_pagamentos where chave='kh1') = 'vendedor@nogaria.com.br', null);
end $$;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"barbaranogueira@nogaria.com.br"}', false) \gset
do $$ begin
  perform pagamento_estornar((select id from orcamento_pagamentos where chave='kh1'), 'teste de autoria', 'falsificado@x');
  insert into res values ('autor do estorno vem do JWT', (select estornado_por from orcamento_pagamentos where chave='kh1') = 'barbaranogueira@nogaria.com.br', null);
  update orcamentos set liberada_com_saldo_por = 'ajuste' where codigo='HX-1';
  insert into res values ('gestor ajusta a auditoria', (select liberada_com_saldo_por from orcamentos where codigo='HX-1') = 'ajuste', null);
  update orcamentos set liberada_com_saldo_por = null where codigo='HX-1';
end $$;
reset role;
select set_config('request.jwt.claims', '', false) \gset

do $$ declare i1 uuid; begin
  select id into i1 from orcamentos where codigo='HX-1';
  perform pagamento_registrar(i1, 100, 'Pix', null, null, null, 'kh2', null, 'b');
  update reservas set expira_em = now() + interval '1 hour' where origem_ref='HX-1' and status='ATIVA';
  insert into res values ('reserva de sacola paga segue sem prazo', (select expira_em from reservas where origem_ref='HX-1' and status='ATIVA') is null, null);
  update orcamentos set validade = now() + interval '1 hour' where codigo='HX-1';
  insert into res values ('validade de sacola paga não encurta', (select validade from orcamentos where codigo='HX-1') > now() + interval '5 years', null);
  insert into res values ('sacola sem pagamento mantém o prazo normal', (select expira_em from reservas where origem_ref='HX-2' and status='ATIVA') < now() + interval '3 days', null);
end $$;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"vendedor@nogaria.com.br"}', false) \gset
do $$ begin
  perform baixar_venda('H1', 100, 'WhatsApp', 'HX-1', 'Ze', null, null, 'vendedor');
  insert into res values ('quitada: baixa direta por não-gestor passa', (select status from itens where sku='H1') = 'VENDIDO', null);
end $$;
reset role;
select case when ok then 'PASS' else 'FAIL' end || ' | ' || teste || coalesce(' | ' || detalhe, '') from res;
