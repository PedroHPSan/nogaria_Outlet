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
set role authenticated;
insert into res select 'authenticated lê contatos e mensagens', (select count(*) from contatos_whatsapp)=1 and (select count(*) from mensagens_whatsapp)=1, null;
do $$ declare ok boolean := false; begin
  begin insert into contatos_whatsapp (wa_id) values ('x'); exception when insufficient_privilege then ok := true; end;
  insert into res values ('authenticated não escreve contatos', ok, null);
end $$;
reset role;
select case when ok then 'PASS' else 'FAIL' end || ' | ' || teste || coalesce(' | ' || detalhe, '') from res;
