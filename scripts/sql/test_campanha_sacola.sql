-- Sacola com promoção + decisão no pagamento + ledger (20261107180000). Roda como supabase_admin.
\set QUIET on
create temp table res (teste text, ok boolean, detalhe text);
insert into itens (sku, produto, status, preco_ideal, grupo, lote, estado) values
 ('K1','Em prazo','PRONTO',100,'Vestuário',1,'NOVO'),
 ('K2','Vence A','PRONTO',200,'Calçados',1,'NOVO'),
 ('K3','Vence B','PRONTO',200,'Calçados',1,'NOVO'),
 ('K4','Vence C','PRONTO',200,'Calçados',1,'NOVO'),
 ('K5','Sem campanha','PRONTO',50,'Ferramentas',1,'NOVO');

create function item_json(p_sku text, p_preco numeric, p_cheio numeric, p_camp uuid) returns jsonb language sql as $$
  select jsonb_build_object('sku', p_sku, 'produto', p_sku, 'preco', p_preco)
         || case when p_camp is null then '{}'::jsonb else jsonb_build_object('preco_cheio', p_cheio, 'preco_promo', p_preco, 'campanha_id', p_camp,
              'campanha_nome', 'Camp', 'entrou_em', now()) end $$;

do $$ declare ca uuid; cb uuid; id1 uuid; id2 uuid; id3 uuid; id4 uuid; id5 uuid; o orcamentos; m text; d text; begin
  insert into campanhas (nome, inicio_em, fim_em) values ('Em prazo', now()-interval '1 hour', now()+interval '2 days') returning id into ca;
  insert into campanha_regras (campanha_id, tipo, alvo, desconto_pct) values (ca,'item','K1',20);
  perform campanha_publicar(ca);
  insert into campanhas (nome, inicio_em, fim_em) values ('Vai acabar', now()-interval '1 hour', now()+interval '2 days') returning id into cb;
  insert into campanha_regras (campanha_id, tipo, alvo, desconto_pct) values (cb,'item','K2',20),(cb,'item','K3',20),(cb,'item','K4',20);
  perform campanha_publicar(cb);

  insert into orcamentos (codigo, slug, status, itens, total, validade) values
   ('S-1','s1','RESERVADO', jsonb_build_array(item_json('K1',80,100,ca), item_json('K5',50,null,null)), 130, now()+interval '1 day') returning id into id1;
  insert into orcamentos (codigo, slug, status, itens, total, validade) values
   ('S-2','s2','RESERVADO', jsonb_build_array(item_json('K2',160,200,cb)), 160, now()+interval '1 day') returning id into id2;
  insert into orcamentos (codigo, slug, status, itens, total, validade) values
   ('S-3','s3','RESERVADO', jsonb_build_array(item_json('K3',160,200,cb)), 160, now()+interval '1 day') returning id into id3;
  insert into orcamentos (codigo, slug, status, itens, total, desconto_pct, validade) values
   ('S-4','s4','RESERVADO', jsonb_build_array(item_json('K4',160,200,cb)), 144, 10, now()+interval '1 day') returning id into id4;

  -- dentro do prazo: nada a decidir, total fecha, item carimbado
  o := sacola_preparar_pagamento(id1, null, 'u@x');
  insert into res values ('no prazo: não pergunta e total = 130', o.total = 130, o.total::text);
  insert into res values ('no prazo: item carimbado no_prazo', (o.itens->0->>'campanha_decisao') = 'no_prazo' and (o.itens->1->>'campanha_decisao') is null, null);

  -- encerra a campanha B: agora é "depois do fim"
  perform campanha_encerrar(cb);
  m := null; d := null;
  begin perform sacola_preparar_pagamento(id2, null, 'u@x'); exception when others then get stacked diagnostics d = pg_exception_detail; m := sqlerrm; end;
  insert into res values ('depois do fim: exige decisão', m = 'DECISAO_CAMPANHA', m);
  insert into res values ('decisão traz promo × cheio atual', d::jsonb->0->>'sku' = 'K2' and (d::jsonb->0->>'preco_promo')::numeric = 160 and (d::jsonb->0->>'preco_cheio_atual')::numeric = 200, d);
  insert into res values ('recusa não altera a sacola', (select total from orcamentos where id = id2) = 160 and (select itens->0 ? 'campanha_decisao' from orcamentos where id = id2) = false, null);

  o := sacola_preparar_pagamento(id2, true, 'u@x');
  insert into res values ('manter promo: preço e total preservados', (o.itens->0->>'preco')::numeric = 160 and o.total = 160 and o.itens->0->>'campanha_decisao' = 'manteve_promo', o.total::text);
  o := sacola_preparar_pagamento(id2, null, 'u@x');
  insert into res values ('decidido não pergunta de novo', o.total = 160, null);

  o := sacola_preparar_pagamento(id3, false, 'u@x');
  insert into res values ('preço cheio: reescreve preço e total (200)', (o.itens->0->>'preco')::numeric = 200 and o.total = 200 and o.itens->0->>'campanha_decisao' = 'preco_cheio', o.total::text);
  insert into res values ('preço cheio: preco_promo preservado para o relatório', (o.itens->0->>'preco_promo')::numeric = 160, null);

  update itens set preco_ideal = 250 where sku = 'K4';   -- o preço cheio ATUAL manda
  o := sacola_preparar_pagamento(id4, false, 'u@x');
  insert into res values ('preço cheio usa o preço atual do item (250) com desconto 10% → 225', (o.itens->0->>'preco')::numeric = 250 and o.total = 225, o.total::text);

  -- ledger: baixa o valor e vira VENDIDO
  update itens set valor_vendido = 80, status = 'VENDIDO' where sku = 'K1';
  update orcamentos set status = 'VENDIDO' where id = id1;
  insert into res values ('ledger: venda no prazo', (select decisao = 'no_prazo' and preco_promo = 80 and preco_cheio = 100 and valor_vendido = 80 and canal = 'whatsapp' from campanha_vendas where sku = 'K1'), null);
  insert into res values ('ledger: item sem campanha não entra', not exists (select 1 from campanha_vendas where sku = 'K5'), null);
  update itens set valor_vendido = 160, status = 'VENDIDO' where sku = 'K2';
  update orcamentos set status = 'VENDIDO' where id = id2;
  insert into res values ('ledger: manteve promo depois do fim', (select decisao = 'manteve_promo' and valor_vendido = 160 and entrou_em is not null from campanha_vendas where sku = 'K2'), null);
  update orcamentos set status = 'VENDIDO' where id = id3;
  insert into res values ('ledger: preço cheio guarda o preço promocional de entrada', (select decisao = 'preco_cheio' and preco_promo = 160 from campanha_vendas where sku = 'K3'), null);

  -- pagamento SEM passar pela RPC (sacola antiga/atalho): fica auditável
  insert into orcamentos (codigo, slug, status, itens, total, validade) values
   ('S-5','s5','RESERVADO', jsonb_build_array(item_json('K4',160,200,cb)), 160, now()+interval '1 day') returning id into id5;
  update orcamentos set status = 'VENDIDO' where id = id5;
  insert into res values ('ledger: sem decisão depois do fim é registrado como sem_decisao', (select decisao = 'sem_decisao' from campanha_vendas where origem_ref = 'S-5'), null);

  -- dado ruim nunca bloqueia a venda
  insert into orcamentos (codigo, slug, status, itens, total, validade) values
   ('S-6','s6','RESERVADO', '[{"sku":"K5","preco":50,"campanha_id":"lixo"}]', 50, now()+interval '1 day');
  m := null; begin update orcamentos set status = 'VENDIDO' where codigo = 'S-6'; exception when others then m := sqlerrm; end;
  insert into res values ('dado inválido não bloqueia a venda', m is null and (select status from orcamentos where codigo='S-6') = 'VENDIDO', m);

  -- sacola já vendida não prepara
  m := null; begin perform sacola_preparar_pagamento(id1, null, 'u@x'); exception when others then m := sqlerrm; end;
  insert into res values ('sacola vendida recusa preparar', m like '%já está VENDIDO%', m);
  m := null; begin perform sacola_preparar_pagamento(gen_random_uuid(), null, 'u@x'); exception when others then m := sqlerrm; end;
  insert into res values ('sacola inexistente', m = 'Sacola não encontrada.', m);
end $$;

insert into res select 'anon não executa sacola_preparar_pagamento', not has_function_privilege('anon','sacola_preparar_pagamento(uuid,boolean,text)','execute'), null;
insert into res select 'anon sem acesso ao ledger', not has_table_privilege('anon','campanha_vendas','select'), null;
insert into res select 'authenticated lê mas não escreve no ledger', has_table_privilege('authenticated','campanha_vendas','select') and not has_table_privilege('authenticated','campanha_vendas','insert'), null;
select case when ok then 'PASS' else 'FAIL' end || ' | ' || teste || coalesce(' | ' || detalhe, '') from res;
