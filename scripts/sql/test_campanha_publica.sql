-- Página pública /promo (20261107160000). Roda como supabase_admin; o anon é testado com SET ROLE.
\set QUIET on
create temp table res (teste text, ok boolean, detalhe text);
insert into itens (sku, produto, status, preco_ideal, grupo, lote, estado) values
 ('P1','Camisa','PRONTO',100,'Vestuário',1,'NOVO'),
 ('P2','Tênis','PRONTO',200,'Calçados',1,'NOVO'),
 ('P3','Sem foto','PRONTO',300,'Ferramentas',1,'NOVO'),
 ('P4','Vendido depois','PRONTO',50,'Vestuário',1,'NOVO'),
 ('P5','Excluído no whatsapp','PRONTO',80,'Vestuário',1,'NOVO'),
 ('P6','Campanha velha','PRONTO',60,'Vestuário',1,'NOVO');
insert into listing_state values
 ('P1','whatsapp','publicado','{"contato":{"whatsapp":"5511999990000"},"og":{"imagem":"https://x/p1.jpg"},"itens":[{"sku":"P1","produto":"Camisa","preco":100,"foto":"https://x/p1.jpg"}]}'),
 ('P2','whatsapp','publicado','{"contato":{"whatsapp":"5511999990000"},"og":{"imagem":"https://x/p2.jpg"},"itens":[{"sku":"P2","produto":"Tênis","preco":200,"foto":"https://x/p2.jpg"}]}'),
 ('P4','whatsapp','publicado','{"contato":{"whatsapp":"5511999990000"},"itens":[{"sku":"P4","produto":"Vendido depois","preco":50}]}'),
 ('P5','whatsapp','publicado','{"contato":{"whatsapp":"5511999990000"},"itens":[{"sku":"P5","produto":"X","preco":80}]}'),
 ('P6','whatsapp','publicado','{"contato":{"whatsapp":"5511999990000"},"itens":[{"sku":"P6","produto":"Velha","preco":60}]}');
-- P3 não está no catálogo (sem foto pública)

do $$ declare ativa uuid; fut uuid; velha uuid; rasc uuid; r jsonb; s_ativa text; s_fut text; s_velha text; s_rasc text; begin
  insert into campanhas (nome, inicio_em, fim_em) values ('Ativa PP', now()-interval '1 hour', now()+interval '2 days') returning id, slug into ativa, s_ativa;
  insert into campanha_regras (campanha_id, tipo, alvo, canal, desconto_pct) values
    (ativa,'item','P1',null,30),(ativa,'item','P2',null,30),(ativa,'item','P4',null,30),(ativa,'item','P5',null,0),(ativa,'item','P1','instagram',50);
  r := campanha_publicar(ativa);
  update itens set status = 'VENDIDO' where sku = 'P4';

  r := campanha_publica(s_ativa);
  insert into res values ('ativa: estado', r->>'estado' = 'ativa', r->>'estado');
  insert into res values ('ativa: traz agora do servidor', (r->>'agora')::timestamptz between now()-interval '5 seconds' and now()+interval '5 seconds', null);
  insert into res values ('ativa: só itens do catálogo e com desconto (P1,P2,P4)', (select array_agg(e->>'sku' order by e->>'sku') from jsonb_array_elements(r->'itens') e) = array['P1','P2','P4'], r->'itens'::text);
  insert into res values ('preço riscado e promo (P1 100→70)', (select (e->>'preco_cheio')::numeric = 100 and (e->>'preco')::numeric = 70 and (e->>'desconto_pct')::numeric = 30 from jsonb_array_elements(r->'itens') e where e->>'sku'='P1'), null);
  insert into res values ('canal instagram não vaza para o whatsapp', (select (e->>'preco')::numeric = 70 from jsonb_array_elements(r->'itens') e where e->>'sku'='P1'), null);
  insert into res values ('vendido aparece indisponível', (select (e->>'disponivel')::boolean = false from jsonb_array_elements(r->'itens') e where e->>'sku'='P4'), null);
  insert into res values ('contato do catálogo vem junto', r->'contato'->>'whatsapp' = '5511999990000', null);

  -- agendada: sem promo exposta, preço atual
  insert into campanhas (nome, inicio_em, fim_em) values ('Futura PP', now()+interval '5 days', now()+interval '7 days') returning id, slug into fut, s_fut;
  insert into campanha_regras (campanha_id, tipo, alvo, desconto_pct) values (fut,'item','P2',40);
  perform campanha_publicar(fut);
  r := campanha_publica(s_fut);
  insert into res values ('agendada: estado', r->>'estado' = 'agendada', null);
  insert into res values ('agendada: sem preço promocional exposto', (select e->>'preco_cheio' is null and e->>'desconto_pct' is null and (e->>'preco')::numeric = 200 from jsonb_array_elements(r->'itens') e where e->>'sku'='P2'), r::text);

  -- encerrada há pouco: mostra preço cheio atual; há mais de 7 dias: some
  insert into campanhas (nome, inicio_em, fim_em) values ('Velha PP', now()-interval '10 days', now()+interval '1 day') returning id, slug into velha, s_velha;
  insert into campanha_regras (campanha_id, tipo, alvo, desconto_pct) values (velha,'item','P6',10);
  perform campanha_publicar(velha);
  perform campanha_encerrar(velha);
  r := campanha_publica(s_velha);
  insert into res values ('encerrada: estado', r->>'estado' = 'encerrada', null);
  perform set_config('campanhas.rpc','1',true);   -- recua as datas simulando o tempo passado (o guard bloqueia UPDATE direto)
  update campanhas set fim_em = now() - interval '8 days', inicio_em = now() - interval '12 days' where id = velha;
  perform set_config('campanhas.rpc','',true);
  insert into res values ('encerrada há >7 dias: indisponível', campanha_publica(s_velha) is null, null);

  -- rascunho e slug inexistente
  insert into campanhas (nome, inicio_em, fim_em) values ('Rasc PP', now(), now()+interval '1 day') returning slug into s_rasc;
  insert into res values ('rascunho: indisponível', campanha_publica(s_rasc) is null and campanha_og(s_rasc) is null, null);
  insert into res values ('slug inexistente: null', campanha_publica('naoexiste') is null, null);

  -- og: sem preço
  r := campanha_og(s_ativa);
  insert into res values ('og: título e imagem', r->'og'->>'titulo' = 'Ativa PP' and r->'og'->>'imagem' like 'https://x/p%', r::text);
  insert into res values ('og: descrição com % e prazo, sem preço', r->'og'->>'descricao' like 'Até 50% OFF · oferta válida até %' and r->'og'->>'descricao' not like '%R$%', r->'og'->>'descricao');
end $$;

-- anon: só executa as duas RPCs públicas
insert into res select 'anon executa campanha_publica', has_function_privilege('anon','campanha_publica(text)','execute'), null;
insert into res select 'anon executa campanha_og', has_function_privilege('anon','campanha_og(text)','execute'), null;
insert into res select 'anon continua sem precos_efetivos', not has_function_privilege('anon','precos_efetivos(text[],text,timestamptz)','execute'), null;
select slug as s_ativa from campanhas where nome = 'Ativa PP' \gset
set role anon;
select campanha_publica(:'s_ativa') is not null as anon_ok \gset
reset role;
insert into res values ('anon chama campanha_publica de verdade', :'anon_ok', null);
select case when ok then 'PASS' else 'FAIL' end || ' | ' || teste || coalesce(' | ' || detalhe, '') from res;
