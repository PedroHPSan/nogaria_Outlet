-- Migration 20261102150000_whatsapp_base.sql (roda como supabase_admin).
\set QUIET on
create temp table res (teste text, ok boolean, detalhe text);
grant all on res to authenticated;
grant select on contatos_whatsapp, mensagens_whatsapp to authenticated;
insert into contatos_whatsapp (wa_id, nome) values ('5591', 'Ana');
insert into mensagens_whatsapp (wa_message_id, wa_id, direcao, texto) values ('wamid.1','5591','in','oi');
do $$ declare ok boolean := false; begin
  begin insert into mensagens_whatsapp (wa_message_id, wa_id, direcao) values ('wamid.1','5591','in'); exception when unique_violation then ok := true; end;
  insert into res values ('wamid repetido recusado (idempotência)', ok, null);
  ok := false;
  begin insert into mensagens_whatsapp (wa_id, direcao) values ('5591','sideways'); exception when check_violation then ok := true; end;
  insert into res values ('direcao inválida recusada', ok, null);
end $$;
-- código de pedido: vínculo ao primeiro número e rate limit de tentativas inválidas
insert into contatos_whatsapp (wa_id) values ('5592'), ('5593');
insert into interesses (codigo, sku) values ('A1B2C', 'NOG-1'), ('D3E4F', 'NOG-2');
create temp table r1 as select whatsapp_reivindicar_codigo('5591','a1b2c') as r;
insert into res select 'código novo vincula ao número', (select r->>'status' from r1)='ok' and (select wa_id from interesses where codigo='A1B2C')='5591', null;
insert into res select 'mesmo número de novo: ok, não é nova', (whatsapp_reivindicar_codigo('5591','A1B2C')->>'nova')='false', null;
insert into res select 'outro número é recusado (ja_usado)', (whatsapp_reivindicar_codigo('5592','A1B2C')->>'status')='ja_usado', null;
select whatsapp_reivindicar_codigo('5593','ZZZZZ') from generate_series(1,5);
insert into res select '5 tentativas inválidas bloqueiam', (whatsapp_reivindicar_codigo('5593','D3E4F')->>'status')='bloqueado', null;
insert into res select 'bloqueado não vincula o código', (select wa_id from interesses where codigo='D3E4F') is null, null;
insert into res select 'authenticated não executa a RPC', not has_function_privilege('authenticated','whatsapp_reivindicar_codigo(text,text)','execute'), null;

set role authenticated;
insert into res select 'authenticated lê contatos e mensagens', (select count(*) from contatos_whatsapp)=3 and (select count(*) from mensagens_whatsapp)=1, null;
do $$ declare ok boolean := false; begin
  begin insert into contatos_whatsapp (wa_id) values ('x'); exception when insufficient_privilege then ok := true; end;
  insert into res values ('authenticated não escreve contatos', ok, null);
end $$;
reset role;
select case when ok then 'PASS' else 'FAIL' end || ' | ' || teste || coalesce(' | ' || detalhe, '') from res;
