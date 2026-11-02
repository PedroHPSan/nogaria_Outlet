-- Migration 20261102160000_whatsapp_envio.sql (roda como supabase_admin).
\set QUIET on
create temp table res (teste text, ok boolean, detalhe text);
grant all on res to authenticated;
grant select on orcamentos, integracao_jobs to authenticated;

insert into orcamentos (codigo, slug, status, origem, itens, validade, cliente_whatsapp)
  values ('ORC-W1','w1','ABERTA','whatsapp','[]'::jsonb, now()+interval '3 days','5591988887777'),
         ('ORC-W2','w2','ABERTA','whatsapp','[]'::jsonb, now()+interval '3 days', null);

set role authenticated;
select whatsapp_enviar('sacola','ORC-W1','cobranca');
select whatsapp_enviar('sacola','ORC-W1','cobranca');
reset role;
insert into res select 'enviar é idempotente por (sacola, evento)', (select count(*) from integracao_jobs where idem_key='wa:sacola:ORC-W1:cobranca')=1, null;

do $$ declare m text; begin
  begin perform whatsapp_enviar('sacola','ORC-W2','cobranca'); exception when others then m := sqlerrm; end;
  insert into res values ('sacola sem WhatsApp recusada', m like '%sem WhatsApp%', m);
  m := null;
  begin perform whatsapp_enviar('sacola','ORC-W1','spam'); exception when others then m := sqlerrm; end;
  insert into res values ('evento desconhecido recusado', m like '%inválido%', m);
  m := null;
  begin perform whatsapp_enviar('sacola','NAO-EXISTE','pago'); exception when others then m := sqlerrm; end;
  insert into res values ('sacola inexistente recusada', m like '%não encontrada%', m);
end $$;

insert into res select 'authenticated não enfileira job arbitrário', not has_function_privilege('authenticated','enfileirar_job(text,jsonb,text,timestamptz)','execute'), null;
insert into res select 'authenticated executa whatsapp_enviar', has_function_privilege('authenticated','whatsapp_enviar(text,text,text)','execute'), null;

-- situação: job na fila → sem mensagem; depois com mensagem entregue
insert into res select 'envios: job pendente sem mensagem', exists (select 1 from whatsapp_envios('sacola','ORC-W1') where evento='cobranca' and job_status='pendente' and msg_status is null), null;
insert into mensagens_whatsapp (wa_message_id, wa_id, direcao, tipo, status, ref_tipo, ref, evento, template)
  values ('wamid.T1','5591988887777','out','template','delivered','sacola','ORC-W1','cobranca','cobranca_sacola');
insert into res select 'envios: status da mensagem aparece', exists (select 1 from whatsapp_envios('sacola','ORC-W1') where evento='cobranca' and msg_status='delivered'), null;

select case when ok then 'PASS' else 'FAIL' end || ' | ' || teste || coalesce(' | ' || detalhe, '') from res;
