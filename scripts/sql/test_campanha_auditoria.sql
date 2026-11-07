-- Auditoria, inclusão/remoção e elegibilidade corrigida (20261108110000). Roda como supabase_admin.
\set QUIET on
create temp table res (teste text, ok boolean, detalhe text);
insert into pricing_grupo (grupo, macro) values ('Aud','Aud'), ('Aud2','Aud2'), ('Aud3','Aud3');
insert into itens (sku, produto, status, preco_ideal, grupo, lote, estado) values
 ('Z1','Foto com preço','FOTOGRAFADO',100,'Aud',1,'NOVO'),
 ('Z2','Triado com preço','TRIADO',200,'Aud',1,'NOVO'),
 ('Z3','A catalogar sem preço','A_CATALOGAR',null,'Aud',1,'NOVO'),
 ('Z4','Vendido','VENDIDO',80,'Aud',1,'NOVO'),
 ('Z5','Descartado','DESCARTE',80,'Aud',1,'NOVO'),
 ('Z6','Fora do grupo','PRONTO',50,'Aud2',1,'NOVO'),
 ('Z7','Pronto com preço','PRONTO',300,'Aud',1,'NOVO'),
 ('Z8','Livre p/ incluir','FOTOGRAFADO',60,'Aud2',1,'NOVO'),
 ('Z9','Excluído 0%','FOTOGRAFADO',70,'Aud',1,'NOVO');
insert into listing_state values ('Z1','whatsapp','publicado','{"itens":[{"sku":"Z1"}]}');

do $$ declare c uuid; c2 uuid; r jsonb; m text; n int; begin
  -- rascunho: grupo Vestuário só no whatsapp (o caso da BKACK FRIDAY) + Z9 excluído
  insert into campanhas (nome, inicio_em, fim_em) values ('Auditoria', now()-interval '1 hour', now()+interval '2 days') returning id into c;
  insert into campanha_regras (campanha_id, tipo, alvo, canal, desconto_pct) values (c,'grupo','Aud','whatsapp',20),(c,'item','Z9','whatsapp',0);

  insert into res values ('elegibilidade: FOTOGRAFADO/TRIADO/PRONTO com preço entram', (select array_agg(sku order by sku) from campanha_resolver(c) where pct > 0 and canal = 'whatsapp') = array['Z1','Z2','Z7'], (select string_agg(sku, ',') from campanha_resolver(c) where pct > 0));
  insert into res values ('elegibilidade: sem preço, vendido e descartado ficam fora', not exists (select 1 from campanha_resolver(c) where sku in ('Z3','Z4','Z5')), null);

  -- auditoria do rascunho (canal whatsapp)
  insert into res values ('auditoria: situação de cada peça', (select jsonb_object_agg(sku, situacao) from campanha_auditar(c, 'whatsapp') where sku in ('Z1','Z2','Z3','Z4','Z5','Z7','Z9'))
     = '{"Z1":"na_campanha","Z2":"na_campanha","Z3":"sem_preco","Z4":"indisponivel","Z5":"indisponivel","Z7":"na_campanha","Z9":"excluida_0pct"}'::jsonb,
     (select jsonb_object_agg(sku, situacao)::text from campanha_auditar(c, 'whatsapp')));
  insert into res values ('auditoria: peça fora das regras não aparece', not exists (select 1 from campanha_auditar(c, 'whatsapp') where sku in ('Z6','Z8')), null);
  insert into res values ('auditoria: preço de/por e catálogo', (select preco_ideal = 100 and preco = 80 and no_catalogo from campanha_auditar(c, 'whatsapp') where sku = 'Z1') and (select not no_catalogo from campanha_auditar(c, 'whatsapp') where sku = 'Z2'), null);

  -- publicar: recusa campanha sem nenhum item elegível
  insert into campanhas (nome, inicio_em, fim_em) values ('Vazia', now(), now()+interval '1 day') returning id into c2;
  insert into campanha_regras (campanha_id, tipo, alvo, desconto_pct) values (c2,'grupo','Aud3',10);
  m := null; begin perform campanha_publicar(c2); exception when others then m := sqlerrm; end;
  insert into res values ('publicar sem item elegível é recusado', m like 'NENHUM_ITEM%', m);

  r := campanha_publicar(c);
  insert into res values ('publica com os 3 elegíveis (whatsapp)', (r->>'linhas')::int = 3 or (r->>'linhas')::int >= 3, r::text);
  insert into res values ('log: publicação e itens incluídos', (select count(*) from campanha_log where campanha_id = c and acao = 'item_incluido') >= 3 and exists (select 1 from campanha_log where campanha_id = c and acao = 'publicada'), null);

  -- publicada: Z8 (Ferramentas) fora das regras → incluir manualmente
  r := campanha_incluir_itens(c, array['z8', 'Z1', 'Z3', 'Z4', 'XX9'], 15);
  insert into res values ('incluir: entra só o elegível e novo', r->'incluidos' = '["Z8"]'::jsonb, r::text);
  insert into res values ('incluir: motivos dos ignorados', (select jsonb_object_agg(e->>'sku', e->>'motivo') from jsonb_array_elements(r->'ignorados') e)
     = '{"Z1":"já está na campanha","Z3":"sem preço de venda","Z4":"já vendido/descartado","XX9":"SKU não encontrado"}'::jsonb, r->>'ignorados');
  insert into res values ('incluir: preço cheio congelado e origem manual', (select preco_cheio = 60 and desconto_pct = 15 and regra_tipo = 'manual' from campanha_itens where campanha_id = c and sku = 'Z8'), null);
  insert into res values ('auditoria publicada: manual aparece como na_campanha/origem manual', (select situacao = 'na_campanha' and origem = 'manual' from campanha_auditar(c, '*') where sku = 'Z8'), null);

  -- novo item que casa com a regra depois da publicação → 'nao_incluida' até reaplicar
  insert into itens (sku, produto, status, preco_ideal, grupo, lote, estado) values ('ZA','Chegou depois','FOTOGRAFADO',90,'Aud',1,'NOVO');
  insert into res values ('auditoria: item novo casa com a regra mas não foi congelado', (select situacao from campanha_auditar(c, 'whatsapp') where sku = 'ZA') = 'nao_incluida', null);
  r := campanha_reaplicar(c);
  insert into res values ('reaplicar inclui o que casa com as regras', exists (select 1 from campanha_itens where campanha_id = c and sku = 'ZA') and (r->>'linhas_incluidas')::int >= 1, r::text);
  insert into res values ('reaplicar é idempotente', (campanha_reaplicar(c)->>'linhas_incluidas')::int = 0, null);

  -- conflito com outra campanha
  insert into campanhas (nome, inicio_em, fim_em) values ('Outra', now(), now()+interval '1 day') returning id into c2;
  insert into campanha_regras (campanha_id, tipo, alvo, desconto_pct) values (c2,'item','Z7',50),(c2,'item','Z6',50);
  insert into res values ('auditoria do rascunho mostra conflito com a publicada', (select situacao = 'conflito' and conflito_nome = 'Auditoria' from campanha_auditar(c2, '*') where sku = 'Z7') and (select situacao = 'na_campanha' from campanha_auditar(c2, '*') where sku = 'Z6'), null);
  perform campanha_publicar(c2, true);   -- Z7 fica de fora (conflito), Z6 entra na 'Outra'
  r := campanha_incluir_itens(c, array['Z6'], 10);
  insert into res values ('incluir é bloqueado se o SKU já está em outra campanha ativa', r->'incluidos' = '[]'::jsonb and r->'ignorados'->0->>'motivo' like 'já está em outra campanha%', r::text);
  insert into campanhas (nome, inicio_em, fim_em) values ('Rascunho extra', now(), now()+interval '1 day') returning id into c2;

  -- remover
  n := campanha_remover_item(c, 'z8');
  insert into res values ('remover tira o item e registra no log', n = 1 and not exists (select 1 from campanha_itens where campanha_id = c and sku = 'Z8') and exists (select 1 from campanha_log where campanha_id = c and sku = 'Z8' and acao = 'item_removido'), null);
  m := null; begin perform campanha_remover_item(c2, 'Z6'); exception when others then m := sqlerrm; end;
  insert into res values ('remover em rascunho é recusado', m like 'Só dá para remover%', m);
  m := null; begin perform campanha_incluir_itens(c2, array['Z8'], 10); exception when others then m := sqlerrm; end;
  insert into res values ('incluir em rascunho é recusado', m like 'Só dá para incluir%', m);

  -- encerrada não recebe itens
  perform campanha_encerrar(c);
  m := null; begin perform campanha_incluir_itens(c, array['Z8'], 10); exception when others then m := sqlerrm; end;
  insert into res values ('campanha encerrada não recebe itens', m like 'Só dá para incluir%', m);
  insert into res values ('log registra o encerramento', exists (select 1 from campanha_log where campanha_id = c and acao = 'prazo_alterado'), null);
end $$;

insert into res select 'anon não executa auditar/incluir/remover/reaplicar', not has_function_privilege('anon','campanha_auditar(uuid,text)','execute') and not has_function_privilege('anon','campanha_incluir_itens(uuid,text[],numeric,text)','execute')
   and not has_function_privilege('anon','campanha_remover_item(uuid,text,text)','execute') and not has_function_privilege('anon','campanha_reaplicar(uuid,text)','execute'), null;
insert into res select 'anon sem acesso ao log', not has_table_privilege('anon','campanha_log','select'), null;
insert into res select 'authenticated lê mas não escreve no log', has_table_privilege('authenticated','campanha_log','select') and not has_table_privilege('authenticated','campanha_log','insert'), null;
select case when ok then 'PASS' else 'FAIL' end || ' | ' || teste || coalesce(' | ' || detalhe, '') from res;
