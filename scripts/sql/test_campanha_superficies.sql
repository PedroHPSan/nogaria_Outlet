-- Promo nas superfícies existentes (20261107170000): /i, /p, € e feed da Meta. Roda como supabase_admin.
\set QUIET on
create temp table res (teste text, ok boolean, detalhe text);
insert into itens (sku, produto, status, preco_ideal, grupo, lote, estado) values
 ('S1','Camisa','PRONTO',100,'Vestuário',1,'NOVO'),
 ('S2','Sem promo','PRONTO',100,'Vestuário',1,'NOVO'),
 ('S3','Futura','PRONTO',200,'Calçados',1,'NOVO'),
 ('S4','Zero no whatsapp','PRONTO',50,'Vestuário',1,'NOVO');
insert into listing_state select sku, 'whatsapp', 'publicado',
  jsonb_build_object('contato', jsonb_build_object('whatsapp','5511999990000'), 'itens', jsonb_build_array(jsonb_build_object('sku', sku, 'produto', produto, 'preco', preco_ideal, 'foto', 'https://x/'||sku||'.jpg')))
  from itens where sku in ('S1','S2','S3','S4');
insert into catalogos_publicos (slug, titulo, payload) values
 ('slugp','Oferta P', '{"euro":true,"itens":[{"sku":"S1","preco":100},{"sku":"S2","preco":100}]}');
insert into cotacoes (taxa, em, fonte) values (6.0, now(), 'teste');

do $$ declare c1 uuid; c2 uuid; r jsonb; f jsonb; begin
  insert into campanhas (nome, inicio_em, fim_em) values ('Agora S', now()-interval '1 hour', now()+interval '1 day') returning id into c1;
  insert into campanha_regras (campanha_id, tipo, alvo, canal, desconto_pct) values (c1,'item','S1',null,20),(c1,'item','S4',null,30),(c1,'item','S4','whatsapp',0);
  perform campanha_publicar(c1);
  insert into campanhas (nome, inicio_em, fim_em) values ('Futura S', now()+interval '3 days', now()+interval '5 days') returning id into c2;
  insert into campanha_regras (campanha_id, tipo, alvo, desconto_pct) values (c2,'item','S3',25);
  perform campanha_publicar(c2);

  -- /i
  r := item_publico('S1');
  insert into res values ('/i: promo vigente', (r->'promo'->>'preco')::numeric = 80 and (r->'promo'->>'preco_cheio')::numeric = 100 and (r->>'agora') is not null, r->>'promo');
  insert into res values ('/i: payload intacto', r->'payload'->'itens'->0->>'sku' = 'S1' and (r->>'disponivel')::boolean, null);
  insert into res values ('/i: sem promo → null', item_publico('S2')->'promo' = 'null'::jsonb, null);
  insert into res values ('/i: campanha futura não aparece', item_publico('S3')->'promo' = 'null'::jsonb, null);
  insert into res values ('/i: 0% no whatsapp exclui', item_publico('S4')->'promo' = 'null'::jsonb, null);
  insert into res values ('/i: sku inexistente → null', item_publico('XX') is null, null);

  -- /p
  r := oferta_precos('slugp');
  insert into res values ('/p: só item com promo', (select array_agg(k) from jsonb_object_keys(r->'itens') k) = array['S1'] and (r->'itens'->'S1'->>'preco')::numeric = 80, r::text);
  insert into res values ('/p: slug inválido → itens vazio', jsonb_typeof(oferta_precos('naoexiste')->'itens') is null or oferta_precos('naoexiste') is null or oferta_precos('naoexiste')->'itens' = '{}'::jsonb, null);

  -- € usa o preço promocional (80 × 1,25 = 100)
  r := registrar_interesse('slugp', 'S1', 'pt');
  insert into res values ('€: base promocional (80)', (select brl_base from interesses where sku='S1') = 80, null);
  insert into res values ('€: eur = 80×1,25÷6', (r->>'eur')::numeric = round(80*1.25/6, 2), r->>'eur');
  r := registrar_interesse('slugp', 'S2', 'pt');
  insert into res values ('€: sem promo segue o snapshot (100)', (select brl_base from interesses where sku='S2') = 100, null);

  -- feed
  select payload into f from catalogo_meta_feed() where sku = 'S1';
  insert into res values ('feed: promo ativa', (f->'itens'->0->'promo'->>'preco')::numeric = 80 and (f->'itens'->0->'promo'->>'preco_cheio')::numeric = 100 and (f->'itens'->0->'promo'->>'ativa')::boolean, f->'itens'->0->>'promo');
  insert into res values ('feed: janela no formato da Meta', f->'itens'->0->'promo'->>'janela' ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d-03:00/\d{4}-\d\d-\d\dT\d\d:\d\d-03:00$', f->'itens'->0->'promo'->>'janela');
  insert into res values ('feed: rótulos continuam', f->'itens'->0->'rotulos'->>'macro' = 'Moda e Acessórios', null);
  select payload into f from catalogo_meta_feed() where sku = 'S3';
  insert into res values ('feed: agendada vem com ativa=false', (f->'itens'->0->'promo'->>'ativa')::boolean = false, f->'itens'->0->>'promo');
  select payload into f from catalogo_meta_feed() where sku = 'S2';
  insert into res values ('feed: sem campanha → promo null', f->'itens'->0->'promo' = 'null'::jsonb, null);
  select payload into f from catalogo_meta_feed() where sku = 'S4';
  insert into res values ('feed: 0% no whatsapp → sem promo', f->'itens'->0->'promo' = 'null'::jsonb, f->'itens'->0->>'promo');

  -- encerrar: some de todas as superfícies na hora
  perform campanha_encerrar(c1);
  insert into res values ('encerrada: /i sem promo', item_publico('S1')->'promo' = 'null'::jsonb, null);
  insert into res values ('encerrada: /p sem promo', oferta_precos('slugp')->'itens' = '{}'::jsonb, null);
  select payload into f from catalogo_meta_feed() where sku = 'S1';
  insert into res values ('encerrada: feed sem promo', f->'itens'->0->'promo' = 'null'::jsonb, null);
end $$;

insert into res select 'anon executa oferta_precos', has_function_privilege('anon','oferta_precos(text)','execute'), null;
insert into res select 'anon continua sem o feed', not has_function_privilege('anon','catalogo_meta_feed()','execute'), null;
select case when ok then 'PASS' else 'FAIL' end || ' | ' || teste || coalesce(' | ' || detalhe, '') from res;
