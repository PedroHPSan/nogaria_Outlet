-- N4: migration 20261102210000_retirada_canais.sql (roda como supabase_admin).
\set QUIET on
create temp table res (teste text, ok boolean, detalhe text);
insert into itens (sku, produto, status) values
  ('X1','A','PRONTO'),('X2','B','PRONTO'),('X3','C','PRONTO'),('X4','D','PRONTO'),('X5','E','PRONTO'),('X6','F','PRONTO');
delete from integracao_jobs;
update canais set config = config || '{"comentar_vendido": true}' where codigo='instagram';  -- testes anteriores deixam false
-- X1: publicado em 4 canais; X2: idem (descarte); X3: sem comentar_vendido; X4: amazon pausada (não retira); X5: só IG com fila; X6: não publicado
insert into listing_state (sku, canal, estado, external_listing_id) values
  ('X1','instagram','publicado','M1'),('X1','whatsapp','publicado',null),('X1','amazon','publicado','A1'),('X1','mercadolivre','publicado','L1'),
  ('X2','instagram','publicado','M2'),('X2','whatsapp','publicado',null),('X2','amazon','publicado','A2'),
  ('X3','instagram','publicado','M3'),('X3','whatsapp','publicado',null),
  ('X4','amazon','pausado','A4'),('X4','whatsapp','nao_publicado',null),
  ('X5','instagram','publicado','M5');
insert into fila_publicacao (canal, tipo, skus, payload, status) values ('instagram','feed',array['X5'],'{"legenda":"x","midias":["https://x/a.jpg"]}','publicado');

-- venda: 1 job por canal publicado (ML sem handler ainda)
select baixar_venda('X1', 99, 'WhatsApp', 'P-1', 'Ana', null, null, 'ana@x');
insert into res select 'venda enfileira os 3 jobs (instagram, catálogo, amazon)',
  (select count(*) from integracao_jobs where payload->>'sku'='X1')=3
  and exists (select 1 from integracao_jobs where tipo='ig.comentar_vendido' and payload->>'sku'='X1' and payload->>'media_id'='M1' and payload->>'motivo'='vendido')
  and exists (select 1 from integracao_jobs where tipo='catalogo.retirar' and payload->>'sku'='X1')
  and exists (select 1 from integracao_jobs where tipo='amazon.quantidade' and payload->>'sku'='X1' and (payload->>'quantidade')::int=0),
  (select string_agg(tipo || ':' || status, ',') from integracao_jobs where payload->>'sku'='X1');
insert into res select 'mercadolivre ainda não gera job (sem handler)', not exists (select 1 from integracao_jobs where payload->>'sku'='X1' and tipo like 'ml.%'), null;

-- VENDIDO → ENTREGUE não repete
select marcar_entregue('X1', 'ana@x');
insert into res select 'VENDIDO→ENTREGUE não enfileira de novo', (select count(*) from integracao_jobs where payload->>'sku'='X1')=3, null;

-- devolução e nova venda geram novos jobs
select reabrir_estoque('X1', 'devolução', 'PRONTO', 'ana@x');
insert into res select 'reabrir_estoque não enfileira retirada', (select count(*) from integracao_jobs where payload->>'sku'='X1')=3, null;
select pg_sleep(0.01);
select baixar_venda('X1', 99, 'WhatsApp', 'P-2', 'Bia', null, null, 'ana@x');
insert into res select 'nova venda depois de reabrir gera novos jobs (idempotência inclui o instante)', (select count(*) from integracao_jobs where payload->>'sku'='X1')=6, null;

-- descarte: mesmo conjunto, motivo indisponivel
select mover_etapa('X2', 'DESCARTE', 'ana@x');
insert into res select 'DESCARTE enfileira com motivo indisponivel', (select count(*) from integracao_jobs where payload->>'sku'='X2')=3
  and not exists (select 1 from integracao_jobs where payload->>'sku'='X2' and payload->>'motivo' <> 'indisponivel'), null;

-- config: comentar_vendido = false corta só o Instagram
update canais set config = config || '{"comentar_vendido": false}' where codigo='instagram';
select baixar_venda('X3', 10, 'WhatsApp', 'P-3', null, null, null, 'ana@x');
insert into res select 'comentar_vendido=false: sem comentário, mas retira o catálogo',
  not exists (select 1 from integracao_jobs where payload->>'sku'='X3' and tipo='ig.comentar_vendido')
  and exists (select 1 from integracao_jobs where payload->>'sku'='X3' and tipo='catalogo.retirar'), null;
update canais set config = config || '{"comentar_vendido": true}' where codigo='instagram';

-- listing pausado/não publicado não gera job
select baixar_venda('X4', 10, 'WhatsApp', 'P-4', null, null, null, 'ana@x');
insert into res select 'listing pausado ou não publicado não gera job', not exists (select 1 from integracao_jobs where payload->>'sku'='X4'), null;

-- fila de publicação esgotada continua funcionando
select baixar_venda('X5', 10, 'WhatsApp', 'P-5', null, null, null, 'ana@x');
insert into res select 'publicação do Instagram vira esgotada quando todos os itens saem', (select status from fila_publicacao where skus = array['X5'])='esgotado', null;

-- item sem nenhum canal: nada
select baixar_venda('X6', 10, 'WhatsApp', 'P-6', null, null, null, 'ana@x');
insert into res select 'item sem canal publicado não gera job', not exists (select 1 from integracao_jobs where payload->>'sku'='X6'), null;

-- troca de trigger
insert into res select 'trigger antigo removido, novo criado', not exists (select 1 from pg_trigger where tgname='trg_itens_vendido_instagram')
  and exists (select 1 from pg_trigger where tgname='trg_itens_retirar_canais'), null;
insert into res select 'função do trigger não é chamável pelo app', not has_function_privilege('authenticated','itens_retirar_canais()','execute'), null;

select case when ok then 'PASS' else 'FAIL' end || ' | ' || teste || coalesce(' | ' || detalhe, '') from res;
