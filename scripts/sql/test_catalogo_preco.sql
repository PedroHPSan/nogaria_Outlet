-- Catálogo da Meta em tempo real (20261110130000): preço certo por SKU + jobs `catalogo.preco` nos gatilhos. Roda como supabase_admin.
\set QUIET on
create temp table res (teste text, ok boolean, detalhe text);
insert into itens (sku, produto, status, preco_ideal, grupo, lote, estado) values
 ('M1','Em campanha','PRONTO',100,'Vestuário',1,'NOVO'),
 ('M2','Fora de campanha','PRONTO',80,'Vestuário',1,'NOVO'),
 ('M3','Campanha agendada','PRONTO',50,'Vestuário',1,'NOVO'),
 ('M4','Não publicada','PRONTO',40,'Vestuário',1,'NOVO');
insert into listing_state select sku, 'whatsapp', 'publicado', '{}'::jsonb from itens where sku in ('M1','M2','M3');

do $$ declare c1 uuid; c3 uuid; r record; n int; j jsonb; begin
  delete from integracao_jobs;
  insert into campanhas (nome, inicio_em, fim_em) values ('Ativa', now()-interval '1 hour', now()+interval '1 day') returning id into c1;
  insert into campanha_regras (campanha_id, tipo, alvo, canal, desconto_pct) values (c1,'item','M1','whatsapp',20);
  perform campanha_publicar(c1);
  insert into campanhas (nome, inicio_em, fim_em) values ('Agendada', now()+interval '1 day', now()+interval '2 day') returning id into c3;
  insert into campanha_regras (campanha_id, tipo, alvo, desconto_pct) values (c3,'item','M3',10);
  perform campanha_publicar(c3);

  -- publicar campanha enfileira o push das peças dela
  insert into res values ('publicar campanha enfileira catalogo.preco', exists (select 1 from integracao_jobs where tipo='catalogo.preco' and payload->'skus' ? 'M1'), null);

  select * into r from catalogo_meta_preco(array['M1']);
  insert into res values ('campanha ativa: price = "de" e sale_price promo', r.price = 100 and r.sale_price = 80 and r.janela like '%-03:00/%-03:00', r::text);
  select * into r from catalogo_meta_preco(array['M2']);
  insert into res values ('fora de campanha: só price, sem promo', r.price = 80 and r.sale_price is null and r.janela is null, r::text);
  select * into r from catalogo_meta_preco(array['M3']);
  insert into res values ('campanha agendada: price = ficha, sale_price com janela', r.price = 50 and r.sale_price = 45 and r.janela is not null, r::text);
  insert into res values ('não publicada no WhatsApp fica de fora', not exists (select 1 from catalogo_meta_preco(array['M4'])), null);

  -- preço mudou na ficha → job; e a campanha acompanha (gatilho do preço ao vivo) → price novo
  delete from integracao_jobs;
  update itens set preco_ideal = 200 where sku = 'M1';
  insert into res values ('mudar preço na ficha enfileira o SKU', exists (select 1 from integracao_jobs where tipo='catalogo.preco' and payload->'skus' ? 'M1'), null);
  select * into r from catalogo_meta_preco(array['M1']);
  insert into res values ('após mudar a ficha: price 200, sale_price 160', r.price = 200 and r.sale_price = 160, r::text);
  delete from integracao_jobs;
  update itens set preco_ideal = 85 where sku = 'M2';
  select count(*) into n from integracao_jobs where tipo='catalogo.preco';
  insert into res values ('peça de fora da campanha também enfileira', n = 1, n::text);
  delete from integracao_jobs;
  update itens set preco_ideal = 40.5 where sku = 'M4';
  insert into res values ('peça não publicada não enfileira', not exists (select 1 from integracao_jobs), null);

  -- tirar da campanha / incluir de volta
  delete from integracao_jobs;
  perform campanha_remover_item(c1, 'M1');
  insert into res values ('remover da campanha enfileira o SKU', exists (select 1 from integracao_jobs where payload->'skus' ? 'M1'), null);
  select * into r from catalogo_meta_preco(array['M1']);
  insert into res values ('após remover: price 200 sem promo', r.price = 200 and r.sale_price is null, r::text);
  delete from integracao_jobs;
  perform campanha_incluir_itens(c1, array['M1'], 20, 'teste');
  insert into res values ('incluir na campanha enfileira o SKU', exists (select 1 from integracao_jobs where payload->'skus' ? 'M1'), null);

  -- encerrar campanha enfileira as peças dela e volta ao preço da ficha
  delete from integracao_jobs;
  perform campanha_encerrar(c1);
  insert into res values ('encerrar campanha enfileira as peças', exists (select 1 from integracao_jobs where payload->'skus' ? 'M1'), null);
  select * into r from catalogo_meta_preco(array['M1']);
  insert into res values ('após encerrar: sem promo', r.sale_price is null and r.price = 200, r::text);

  -- lotes de 200
  delete from integracao_jobs;
  perform catalogo_enfileirar_preco((select array_agg('ZZNAOEXISTE' || g) from generate_series(1, 450) g));
  insert into res values ('SKUs inexistentes no WhatsApp não geram job', not exists (select 1 from integracao_jobs), (select string_agg(left(payload::text,60), ';') from integracao_jobs));
  insert into itens (sku, produto, status, preco_ideal, grupo, lote, estado) select 'LOTEMETA' || g, 'Lote', 'PRONTO', 10, 'Vestuário', 1, 'NOVO' from generate_series(1, 450) g;
  insert into listing_state select 'LOTEMETA' || g, 'whatsapp', 'publicado', '{}'::jsonb from generate_series(1, 450) g;
  perform catalogo_enfileirar_preco((select array_agg('LOTEMETA' || g) from generate_series(1, 450) g));
  select count(*), max(jsonb_array_length(payload->'skus')) into n, j from integracao_jobs;
  insert into res values ('450 peças viram 3 jobs de até 200', n = 3, n::text);
end $$;

select case when ok then 'PASS' else 'FAIL' end || ' ' || teste || coalesce(' [' || detalhe || ']', '') from res;
