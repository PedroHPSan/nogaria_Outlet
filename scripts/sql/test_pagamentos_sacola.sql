-- Pagamentos da sacola (20261124120000_pagamentos_sacola.sql). Roda como supabase_admin; o JWT de cada usuário é
-- simulado com set_config('request.jwt.claims') + set role authenticated.
\set QUIET on
alter table orcamentos drop constraint if exists orcamentos_status_check;
alter table orcamentos add constraint orcamentos_status_check
  check (status in ('RASCUNHO','ENVIADO','RESERVADO','ABERTA','VENDIDO','ENTREGUE','CANCELADO','EXPIRADO'));
create temp table res (teste text, ok boolean, detalhe text);
grant all on res to authenticated;
grant select, insert, update, delete on itens, orcamentos to authenticated;
grant select on reservas to authenticated;
grant select on orcamento_pagamentos, orcamento_parcelas to authenticated;

insert into itens (sku, produto, status, preco_ideal) values ('Z1','A','PRONTO',100),('Z2','B','PRONTO',40),('Z3','C','PRONTO',60),('Z4','D','PRONTO',10);
insert into orcamentos (codigo, slug, status, itens, total, validade, origem, cliente_nome) values
  ('PG-1','pg1','ABERTA','[{"sku":"Z1","preco":100},{"sku":"Z2","preco":40}]',140, now()+interval '1 day','whatsapp','Cleuma'),
  ('PG-2','pg2','ABERTA','[{"sku":"Z3","preco":60}]',60, now()+interval '1 day','whatsapp','Ana'),
  ('PG-X','pgx','EXPIRADO','[]',10, now()-interval '1 day','whatsapp','Velha'),
  ('PG-B2','pgb2','ABERTA','[]',10, now()+interval '1 day','orcamento','Direta');
insert into reservas (sku, canal, origem_tipo, origem_ref, status, expira_em) values
  ('Z1','whatsapp','sacola','PG-1','ATIVA', now()+interval '1 day'),('Z2','whatsapp','sacola','PG-1','ATIVA', now()+interval '1 day'),
  ('Z3','whatsapp','sacola','PG-2','ATIVA', now()+interval '1 day');

do $$ declare m text; o orcamentos; i1 uuid; i2 uuid; pid uuid; begin
  select id into i1 from orcamentos where codigo='PG-1';
  select id into i2 from orcamentos where codigo='PG-2';

  -- parcial: não baixa itens, congela o prazo, soma em valor_pago
  o := pagamento_registrar(i1, 50, 'Pix', 'sinal', null, null, 'k1', null, 'barbara');
  insert into res values ('parcial: sacola continua ABERTA', o.status='ABERTA', o.status);
  insert into res values ('parcial: valor_pago = 50', o.valor_pago = 50, o.valor_pago::text);
  insert into res values ('parcial: validade deixa de vencer', o.validade > now()+interval '5 years', o.validade::text);
  insert into res values ('parcial: reservas sem prazo', (select count(*) from reservas where origem_ref='PG-1' and status='ATIVA' and expira_em is null)=2, null);
  insert into res values ('parcial: itens seguem reservados (projeção)', (select count(*) from itens where reservado_por_orc='PG-1' and reservado_ate > now()+interval '5 years')=2, null);

  -- idempotência pela chave
  o := pagamento_registrar(i1, 50, 'Pix', 'sinal', null, null, 'k1', null, 'barbara');
  insert into res values ('chave repetida não duplica', (select count(*) from orcamento_pagamentos where chave='k1')=1 and o.valor_pago=50, o.valor_pago::text);

  -- acima do saldo e valores inválidos
  begin perform pagamento_registrar(i1, 100, 'Pix', null, null, null, 'k2', null, 'b'); exception when others then m := sqlerrm; end;
  insert into res values ('valor acima do saldo recusado', m like 'Valor maior que o saldo%', m);
  m := null; begin perform pagamento_registrar(i1, 0, 'Pix', null, null, null, 'k3', null, 'b'); exception when others then m := sqlerrm; end;
  insert into res values ('valor zero recusado', m is not null, m);
  m := null; begin perform pagamento_registrar(i1, 10, 'Cheque', null, null, null, 'k4', null, 'b'); exception when others then m := sqlerrm; end;
  insert into res values ('forma inválida recusada', m is not null, m);
  m := null; begin perform pagamento_registrar((select id from orcamentos where codigo='PG-X'), 5, 'Pix', null, null, null, 'k5', null, 'b'); exception when others then m := sqlerrm; end;
  insert into res values ('sacola EXPIRADA não recebe pagamento', m like '%não recebe pagamento%', m);
  m := null; begin perform pagamento_registrar((select id from orcamentos where codigo='PG-B2'), 5, 'Pix', null, null, null, 'k6', null, 'b'); exception when others then m := sqlerrm; end;
  insert into res values ('orçamento comum (não WhatsApp) recusa', m like '%WhatsApp%', m);

  -- cartão: líquido pela taxa
  o := pagamento_registrar(i1, 40, 'Crédito', null, 3, 4.5, 'k7', null, 'b');
  insert into res values ('crédito: líquido = valor − taxa', (select valor_liquido from orcamento_pagamentos where chave='k7') = 38.20 and (select parcelas_cartao from orcamento_pagamentos where chave='k7')=3, null);
  insert into res values ('soma dos pagamentos ativos', o.valor_pago = 90 and o.forma_pagamento = 'Crédito', o.valor_pago::text);
end $$;

-- trava de saldo: usuário comum não baixa com saldo; gestor sim
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"vendedor@nogaria.com.br"}', false);
do $$ declare m text; begin
  begin update orcamentos set status='VENDIDO' where codigo='PG-1'; exception when others then m := sqlerrm; end;
  insert into res values ('não-gestor não baixa com saldo', m like '%falta receber R$ 50%', m);
  insert into res values ('sacola continua ABERTA após recusa', (select status from orcamentos where codigo='PG-1') = 'ABERTA', null);
  m := null;
  begin perform pagamento_estornar((select id from orcamento_pagamentos where chave='k1'), 'erro de digitação', 'vendedor'); exception when others then m := sqlerrm; end;
  insert into res values ('não-gestor não estorna', m like '%podem estornar%', m);
end $$;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"barbaranogueira@nogaria.com.br"}', false);
do $$ declare m text; begin
  update orcamentos set status='VENDIDO' where codigo='PG-1';
  insert into res values ('gestor libera com saldo', (select status from orcamentos where codigo='PG-1') = 'VENDIDO', null);
  insert into res values ('liberação com saldo fica registrada', (select liberada_com_saldo_por from orcamentos where codigo='PG-1') = 'barbaranogueira@nogaria.com.br', null);
end $$;
reset role;
select set_config('request.jwt.claims', '', false);

do $$ declare o orcamentos; i1 uuid; i2 uuid; m text; pid uuid; begin
  select id into i1 from orcamentos where codigo='PG-1';
  select id into i2 from orcamentos where codigo='PG-2';
  -- fiado: segue recebendo depois de VENDIDO, até zerar o saldo
  o := pagamento_registrar(i1, 50, 'Dinheiro', null, null, null, 'k8', null, 'b');
  insert into res values ('fiado: pagamento após VENDIDO quita', o.valor_pago = 140 and o.status = 'VENDIDO', o.valor_pago::text);
  m := null; begin perform pagamento_registrar(i1, 1, 'Pix', null, null, null, 'k9', null, 'b'); exception when others then m := sqlerrm; end;
  insert into res values ('quitada não aceita mais', m like 'Valor maior que o saldo%', m);

  -- quitação integral por usuário comum
  o := pagamento_registrar(i2, 60, 'Pix', null, null, null, 'k10', null, 'b');
  insert into res values ('quitar de uma vez', o.valor_pago = 60 and o.status='ABERTA', null);
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"vendedor@nogaria.com.br"}', false);
  set role authenticated;
  update orcamentos set status='VENDIDO' where codigo='PG-2';
  reset role;
  perform set_config('request.jwt.claims', '', false);
  insert into res values ('quitada: usuário comum baixa sem gestor', (select status from orcamentos where codigo='PG-2') = 'VENDIDO' and (select liberada_com_saldo_por from orcamentos where codigo='PG-2') is null, null);
end $$;

-- estorno (gestor) e retorno ao prazo normal
insert into orcamentos (codigo, slug, status, itens, total, validade, origem) values ('PG-3','pg3','ABERTA','[{"sku":"Z4","preco":10}]',10, now()+interval '1 day','whatsapp');
insert into reservas (sku, canal, origem_tipo, origem_ref, status, expira_em) values ('Z4','whatsapp','sacola','PG-3','ATIVA', now()+interval '1 day');
do $$ declare o orcamentos; id3 uuid; pid uuid; m text; begin
  select id into id3 from orcamentos where codigo='PG-3';
  perform pagamento_registrar(id3, 4, 'Pix', null, null, null, 'k11', null, 'b');
  select id into pid from orcamento_pagamentos where chave='k11';
  begin perform pagamento_estornar(pid, 'x', 'b'); exception when others then m := sqlerrm; end;  -- admin (sem JWT) conta como gestor, mas motivo curto
  insert into res values ('estorno exige motivo', m like '%motivo%', m);
  o := pagamento_estornar(pid, 'valor digitado errado', 'pedro');
  insert into res values ('estorno zera valor_pago', o.valor_pago is null, coalesce(o.valor_pago::text,'null'));
  insert into res values ('estorno de tudo devolve prazo de 48 h', o.validade < now()+interval '3 days' and o.validade > now()+interval '40 hours', o.validade::text);
  insert into res values ('estorno devolve prazo às reservas', (select expira_em from reservas where origem_ref='PG-3' and status='ATIVA') < now()+interval '3 days', null);
  insert into res values ('estorno guarda quem e por quê', (select estornado_por||'/'||estorno_motivo from orcamento_pagamentos where id=pid) = 'pedro/valor digitado errado', null);
  m := null; begin perform pagamento_estornar(pid, 'de novo', 'b'); exception when others then m := sqlerrm; end;
  insert into res values ('estorno duplo recusado', m like '%já foi estornado%', m);
  insert into res values ('estorno não apaga a linha', (select count(*) from orcamento_pagamentos where id=pid)=1, null);
end $$;

-- cron de vencimento: sacola com pagamento ativo não expira; sem pagamento expira
insert into orcamentos (codigo, slug, status, itens, total, validade, origem) values
  ('PG-4','pg4','ABERTA','[{"sku":"Z4","preco":10}]',10, now()+interval '1 day','whatsapp'),('PG-5','pg5','ABERTA','[{"sku":"Z4","preco":10}]',10, now()+interval '1 day','whatsapp');
do $$ declare i4 uuid; begin
  select id into i4 from orcamentos where codigo='PG-4';
  perform pagamento_registrar(i4, 3, 'Pix', null, null, null, 'k12', null, 'b');
  update orcamentos set validade = now() - interval '1 hour' where codigo in ('PG-4','PG-5');   -- admin: simula vencimento forçado
  perform sacolas_expirar();
  insert into res values ('cron não expira sacola com pagamento', (select status from orcamentos where codigo='PG-4') = 'ABERTA', null);
  insert into res values ('cron expira sacola sem pagamento', (select status from orcamentos where codigo='PG-5') = 'EXPIRADO', null);
end $$;

-- plano de parcelas
do $$ declare i3 uuid; n integer; m text; begin
  select id into i3 from orcamentos where codigo='PG-3';
  begin perform plano_parcelas_definir(i3, '[{"valor":4,"vencimento":"2026-12-01"},{"valor":4,"vencimento":"2027-01-01"}]'); exception when others then m := sqlerrm; end;
  insert into res values ('plano com soma errada recusado', m like 'As parcelas somam%', m);
  n := plano_parcelas_definir(i3, '[{"valor":5,"vencimento":"2027-01-01"},{"valor":5,"vencimento":"2026-12-01"}]');
  insert into res values ('plano grava e numera por vencimento', n = 2 and (select vencimento::text from orcamento_parcelas where orcamento_id=i3 and numero=1) = '2026-12-01', null);
  n := plano_parcelas_definir(i3, '[]');
  insert into res values ('lista vazia apaga o plano', n = 0 and (select count(*) from orcamento_parcelas where orcamento_id=i3) = 0, null);
end $$;

-- backfill idempotente: sacola antiga com valor_pago ganha 1 pagamento, 2ª execução não duplica
insert into orcamentos (codigo, slug, status, itens, total, validade, origem, valor_pago, forma_pagamento, pago_em) values
  ('PG-OLD','pgold','ENTREGUE','[]',70, now(), 'whatsapp', 70, 'Pix', now() - interval '3 days');
\i /tmp/pagamentos_sacola.sql
do $$ begin
  insert into res values ('backfill cria 1 pagamento da sacola antiga', (select count(*) from orcamento_pagamentos p join orcamentos o on o.id=p.orcamento_id where o.codigo='PG-OLD')=1, null);
  insert into res values ('backfill mantém valor_pago', (select valor_pago from orcamentos where codigo='PG-OLD')=70, null);
end $$;

insert into res select 'anon não executa pagamento_registrar', not has_function_privilege('anon','pagamento_registrar(uuid,numeric,text,text,integer,numeric,text,timestamptz,text)','execute'), null;
insert into res select 'authenticated não escreve direto nos pagamentos', not has_table_privilege('authenticated','orcamento_pagamentos','insert'), null;

select case when ok then 'PASS' else 'FAIL' end || ' | ' || teste || coalesce(' | ' || detalhe, '') from res;
