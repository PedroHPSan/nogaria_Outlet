-- Preço ao vivo (20261110110000): campanha acompanha a ficha; /i, /p, /c, € e feed com o preço atual. Roda como supabase_admin.
\set QUIET on
create temp table res (teste text, ok boolean, detalhe text);
insert into itens (sku, produto, status, preco_ideal, grupo, lote, estado) values
 ('V1','Em campanha','PRONTO',29.07,'Vestuário',1,'NOVO'),
 ('V2','Fora de campanha','PRONTO',100,'Vestuário',1,'NOVO'),
 ('V3','Vendida','PRONTO',80,'Vestuário',1,'NOVO'),
 ('V4','Campanha encerrada','PRONTO',60,'Vestuário',1,'NOVO');
insert into listing_state select sku, 'whatsapp', 'publicado',
  jsonb_build_object('itens', jsonb_build_array(jsonb_build_object('sku', sku, 'produto', produto, 'preco', preco_ideal, 'foto', 'https://x/'||sku||'.jpg')))
  from itens where sku in ('V1','V2');
insert into catalogos_publicos (slug, titulo, payload) values
 ('vivop','P', '{"euro":true,"itens":[{"sku":"V1","preco":29.07},{"sku":"V2","preco":100}]}'),
 ('vivosem','P sem preço', '{"itens":[{"sku":"V2","preco":null}]}'),
 ('vivoc','C', '{"versao":2,"secoes":[{"titulo":"A","cards":[{"sku":"V1","preco":29.07},{"sku":"V2","preco":100}]}]}');
insert into cotacoes (taxa, em, fonte) values (6.0, now(), 'teste');

do $$ declare c1 uuid; c2 uuid; r jsonb; n int; begin
  insert into campanhas (nome, inicio_em, fim_em) values ('Viva', now()-interval '1 hour', now()+interval '1 day') returning id into c1;
  insert into campanha_regras (campanha_id, tipo, alvo, canal, desconto_pct) values (c1,'item','V1','whatsapp',20),(c1,'item','V3',null,20);
  perform campanha_publicar(c1);
  insert into campanhas (nome, inicio_em, fim_em) values ('Velha', now()-interval '2 hour', now()+interval '1 day') returning id into c2;
  insert into campanha_regras (campanha_id, tipo, alvo, desconto_pct) values (c2,'item','V4',10);
  perform campanha_publicar(c2);
  perform campanha_encerrar(c2);

  insert into res values ('antes: promo sobre o preço da publicação', (select preco from precos_efetivos(array['V1'],'whatsapp')) = 23.26, null);

  -- a equipe muda o preço na ficha
  update itens set preco_ideal = 57 where sku = 'V1';
  insert into res values ('campanha: "de" acompanha a ficha', (select bool_and(preco_cheio = 57) from campanha_itens where sku='V1' and campanha_id = c1), (select string_agg(canal||'='||preco_cheio, ',') from campanha_itens where sku='V1'));
  insert into res values ('campanha: preço efetivo = 57 − 20%', (select preco from precos_efetivos(array['V1'],'whatsapp')) = 45.60, (select preco::text from precos_efetivos(array['V1'],'whatsapp')));
  insert into res values ('campanha: log preco_atualizado', exists (select 1 from campanha_log where sku='V1' and acao='preco_atualizado' and (detalhe->>'de')::numeric = 29.07 and (detalhe->>'para')::numeric = 57), null);
  select count(*) into n from campanha_log where sku='V1' and acao='preco_atualizado';
  update itens set produto = 'outro nome' where sku = 'V1';
  update itens set preco_ideal = 57 where sku = 'V1';
  insert into res values ('sem mudança de preço não regrava', (select count(*) from campanha_log where sku='V1' and acao='preco_atualizado') = n, null);
  update itens set preco_ideal = null where sku = 'V1';
  insert into res values ('preço apagado não zera a campanha', (select bool_and(preco_cheio = 57) from campanha_itens where sku='V1'), null);
  update itens set preco_ideal = 57 where sku = 'V1';

  update itens set status = 'VENDIDO' where sku = 'V3';
  update itens set preco_ideal = 999 where sku = 'V3';
  insert into res values ('peça vendida mantém o "de" da venda', (select bool_and(preco_cheio = 80) from campanha_itens where sku='V3'), null);
  update itens set preco_ideal = 70 where sku = 'V4';
  insert into res values ('campanha encerrada não é reescrita', (select bool_and(preco_cheio = 60) from campanha_itens where sku='V4'), null);

  -- /i
  r := item_publico('V1');
  insert into res values ('/i: payload com o preço da ficha', (r->'payload'->'itens'->0->>'preco')::numeric = 57 and (r->'promo'->>'preco')::numeric = 45.60 and (r->'promo'->>'preco_cheio')::numeric = 57, r::text);
  update itens set preco_ideal = 120 where sku = 'V2';
  r := item_publico('V2');
  insert into res values ('/i: fora de campanha segue a ficha', (r->'payload'->'itens'->0->>'preco')::numeric = 120 and r->'promo' = 'null'::jsonb and r->'payload'->'itens'->0->>'foto' = 'https://x/V2.jpg', r::text);

  -- /p
  r := oferta_precos('vivop');
  insert into res values ('/p: precos = preço cheio atual de todas', (r->'precos'->>'V1')::numeric = 57 and (r->'precos'->>'V2')::numeric = 120, r::text);
  insert into res values ('/p: itens segue só com promo', (select array_agg(k) from jsonb_object_keys(r->'itens') k) = array['V1'] and (r->'itens'->'V1'->>'preco')::numeric = 45.60, r::text);
  r := oferta_precos('vivosem');
  insert into res values ('/p: link sem preço não expõe preço', r->'precos' = '{}'::jsonb, r::text);
  r := oferta_precos('naoexiste');
  insert into res values ('/p: slug inválido → vazio', r->'itens' = '{}'::jsonb and r->'precos' = '{}'::jsonb, r::text);
  -- /c
  r := oferta_precos('vivoc');
  insert into res values ('/c: precos e promo pelos cards das seções', (r->'precos'->>'V2')::numeric = 120 and (r->'itens'->'V1'->>'preco')::numeric = 45.60, r::text);

  -- €
  r := registrar_interesse('vivop', 'V2', 'pt');
  insert into res values ('€: sem promo usa o preço atual (120), não o snapshot (100)', (select brl_base from interesses where sku='V2' and slug='vivop') = 120, null);
  r := registrar_interesse('vivop', 'V1', 'pt');
  insert into res values ('€: com promo usa 45,60', (select brl_base from interesses where sku='V1' and slug='vivop') = 45.60, null);

  -- feed
  insert into res values ('feed: price = "de" atual e promo recalculada',
    (select (payload#>>'{itens,0,promo,preco_cheio}')::numeric = 57 and (payload#>>'{itens,0,promo,preco}')::numeric = 45.60 from catalogo_meta_feed() where sku='V1'),
    (select payload#>>'{itens,0,promo}' from catalogo_meta_feed() where sku='V1'));
end $$;
select case when ok then 'PASS' else 'FAIL' end, teste, coalesce(detalhe, '') from res;
