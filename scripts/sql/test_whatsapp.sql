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

-- whatsapp_reservar: teto, publicação e idempotência
insert into itens (sku, produto, status) select 'P'||g, 'Item '||g, 'PRONTO' from generate_series(1,6) g;
insert into catalogos_publicos (slug, titulo, payload) values ('of-w','Oferta','{"itens":[{"sku":"P1"},{"sku":"P2"},{"sku":"P3"},{"sku":"P4"}]}');
insert into contatos_whatsapp (wa_id) values ('5594');
do $$ declare m text; n integer; begin
  begin perform whatsapp_reservar('5594', array['P5'], 'carrinho_wa', '5594', now()+interval '1 day'); exception when others then m := sqlerrm; end;
  insert into res values ('item fora de oferta pública recusado', m like 'NAO_PUBLICADO%', m);
  select whatsapp_reservar('5594', array['P1','P2'], 'carrinho_wa', '5594', now()+interval '1 day') into n;
  insert into res values ('reserva de itens publicados', n=2, n::text);
  select whatsapp_reservar('5594', array['P1'], 'carrinho_wa', '5594', now()+interval '1 day') into n;
  insert into res values ('SKU já reservado pelo número não renova (0)', n=0, n::text);
  m := null;
  begin perform whatsapp_reservar('5594', array['P3','P4'], 'carrinho_wa', '5594', now()+interval '1 day'); exception when others then m := sqlerrm; end;
  insert into res values ('teto de 3 por número', m = 'LIMITE_RESERVAS', m);
  insert into res values ('estourar o teto não reserva nada', (select count(*) from reservas where criado_por='wa:5594' and status='ATIVA')=2, null);
  select whatsapp_reservar('5594', array['P6'], 'interesse', 'X1', now()+interval '1 day', 3, false) into n;
  insert into res values ('sem exigir publicação (pedido em €) reserva', n=1, n::text);
end $$;
insert into res select 'authenticated não executa whatsapp_reservar', not has_function_privilege('authenticated','whatsapp_reservar(text,text[],text,text,timestamptz,integer,boolean)','execute'), null;

set role authenticated;
insert into res select 'authenticated lê contatos e mensagens', (select count(*) from contatos_whatsapp)>=1 and (select count(*) from mensagens_whatsapp)=1, null;
do $$ declare ok boolean := false; begin
  begin insert into contatos_whatsapp (wa_id) values ('x'); exception when insufficient_privilege then ok := true; end;
  insert into res values ('authenticated não escreve contatos', ok, null);
end $$;
reset role;
select case when ok then 'PASS' else 'FAIL' end || ' | ' || teste || coalesce(' | ' || detalhe, '') from res;
