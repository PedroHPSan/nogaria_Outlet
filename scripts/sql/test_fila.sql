-- Migration 20261102180000_fila_publicacao.sql (roda como supabase_admin).
\set QUIET on
create temp table res (teste text, ok boolean, detalhe text);
grant all on res to authenticated;
insert into itens (sku, produto, status) values ('F1','A','PRONTO'),('F2','B','PRONTO'),('F3','C','PRONTO'),('F4','D','PRONTO');
select set_config('request.jwt.claims', '{"email":"ana@x"}', false);
set role authenticated;

create temp table ids (nome text, id uuid);
grant all on ids to authenticated;
insert into ids select 'feed', publicacao_criar('instagram','feed',array['F1'],'{"legenda":"oi","midias":["https://x/ig/a.jpg"]}');
insert into ids select 'car', publicacao_criar('instagram','carrossel',array['F2','F3'],'{"legenda":"oi","midias":["https://x/ig/a.jpg","https://x/ig/b.jpg"]}');

-- validações do rascunho
do $$ declare m text; begin
  begin perform publicacao_criar('instagram','feed',array['F1'],'{"legenda":"x","midias":["https://x/a.png"]}'); exception when others then m := sqlerrm; end;
  insert into res values ('mídia que não é JPEG recusada', m like '%JPEG%', m); m := null;
  begin perform publicacao_criar('instagram','carrossel',array['F1'],'{"legenda":"x","midias":["https://x/a.jpg"]}'); exception when others then m := sqlerrm; end;
  insert into res values ('carrossel com 1 mídia recusado', m like '%quantidade%', m); m := null;
  begin perform publicacao_criar('instagram','feed',array['F1'],'{"legenda":"x","midias":["https://x/a.jpg","https://x/b.jpg"]}'); exception when others then m := sqlerrm; end;
  insert into res values ('feed com 2 mídias recusado', m like '%quantidade%', m); m := null;
  begin perform publicacao_criar('instagram','feed',array['F1'], jsonb_build_object('legenda', repeat('a',2201), 'midias', jsonb_build_array('https://x/a.jpg'))); exception when others then m := sqlerrm; end;
  insert into res values ('legenda acima de 2.200 recusada', m like '%2.200%', m); m := null;
  begin perform publicacao_criar('instagram','feed',array['NAO-EXISTE'],'{"legenda":"x","midias":["https://x/a.jpg"]}'); exception when others then m := sqlerrm; end;
  insert into res values ('SKU inexistente recusado', m like '%SKU%', m); m := null;
  begin perform publicacao_criar('tiktok','feed',array['F1'],'{"legenda":"x","midias":["https://x/a.jpg"]}'); exception when others then m := sqlerrm; end;
  insert into res values ('canal desconhecido recusado', m like '%canal%', m);
end $$;

-- escrita direta na tabela não passa (só pelas RPCs)
do $$ declare n integer := 0; begin
  begin update publicacoes set status = 'publicado'; get diagnostics n = row_count; exception when others then n := 0; end;
  insert into res values ('UPDATE direto em publicacoes não altera nada', n = 0, n::text);
end $$;

-- aprovar: publica já (job) e não aprova duas vezes
select publicacao_aprovar(id) from ids where nome = 'feed';
reset role;
insert into res select 'aprovar enfileira o job ig.publicar', exists (select 1 from integracao_jobs j join ids on j.idem_key = 'pub:' || ids.id where ids.nome='feed' and j.tipo='ig.publicar'), null;
insert into res select 'aprovar grava aprovador', (select aprovado_por from publicacoes p join ids on ids.id=p.id where nome='feed')='ana@x'
  and (select status from publicacoes p join ids on ids.id=p.id where nome='feed')='aprovado', null;
set role authenticated;
do $$ declare m text; begin
  begin perform publicacao_aprovar((select id from ids where nome='feed')); exception when others then m := sqlerrm; end;
  insert into res values ('aprovar de novo recusado', m like '%só rascunho%', m);
end $$;

-- item vendido bloqueia a aprovação; cancelar libera o fluxo
reset role;
update itens set status = 'VENDIDO' where sku = 'F3';
set role authenticated;
do $$ declare m text; begin
  begin perform publicacao_aprovar((select id from ids where nome='car')); exception when others then m := sqlerrm; end;
  insert into res values ('item vendido bloqueia a aprovação', m like 'F3%indisponível%', m);
end $$;
select publicacao_cancelar(id) from ids where nome = 'car';
reset role;
insert into res select 'cancelar muda o status', (select status from publicacoes p join ids on ids.id=p.id where nome='car')='cancelado', null;

-- agendamento: futuro fica agendado; o cron enfileira quando vence
set role authenticated;
create temp table ag as select publicacao_criar('instagram','feed',array['F4'],'{"legenda":"x","midias":["https://x/a.jpg"]}') as id;
grant all on ag to authenticated;
do $$ declare m text; begin
  begin perform publicacao_agendar((select id from ag), now() - interval '1 day'); exception when others then m := sqlerrm; end;
  insert into res values ('agendar no passado recusado', m like '%passado%', m);
end $$;
select publicacao_agendar((select id from ag), now() + interval '2 days');
select publicacao_aprovar(id) from ag;
reset role;
insert into res select 'agendada no futuro não enfileira', (select status from publicacoes where id=(select id from ag))='agendado'
  and not exists (select 1 from integracao_jobs where idem_key='pub:'||(select id from ag)), null;
update publicacoes set agendado_para = now() - interval '1 minute' where id = (select id from ag);
create temp table venc as select publicacoes_enfileirar_vencidas() as n;
insert into res select 'cron enfileira agendada vencida', (select n from venc)=1 and exists (select 1 from integracao_jobs where idem_key='pub:'||(select id from ag)), null;

-- regra de aprovação própria (por canal)
update canais set config = config || '{"aprovacao_propria": false}' where codigo='instagram';
select set_config('request.jwt.claims', '{"email":"ana@x"}', false);
set role authenticated;
create temp table r2 as select publicacao_criar('instagram','feed',array['F1'],'{"legenda":"x","midias":["https://x/a.jpg"]}') as id;
grant all on r2 to authenticated;
do $$ declare m text; begin
  begin perform publicacao_aprovar((select id from r2)); exception when others then m := sqlerrm; end;
  insert into res values ('sem aprovação própria: criador não aprova', m like '%outra pessoa%', m);
end $$;
select set_config('request.jwt.claims', '{"email":"bia@x"}', false);
do $$ begin perform publicacao_aprovar((select id from r2)); insert into res values ('outra pessoa aprova', true, null);
exception when others then insert into res values ('outra pessoa aprova', false, sqlerrm); end $$;
reset role;
update canais set config = config || '{"aprovacao_propria": true}' where codigo='instagram';

-- E2-1: venda de item publicado → comentário "VENDIDO" e publicação esgotada
insert into listing_state (sku, canal, estado, external_listing_id) values ('F1','instagram','publicado','1789'), ('F2','instagram','publicado','1790');
update publicacoes set status='publicado' where id=(select id from ids where nome='feed');
update itens set status = 'VENDIDO' where sku = 'F1';
insert into res select 'venda enfileira comentário VENDIDO com o media_id', exists (select 1 from integracao_jobs where tipo='ig.comentar_vendido' and idem_key='igv:F1:1789' and payload->>'media_id'='1789'), null;
insert into res select 'publicação com todos os itens vendidos fica esgotada', (select status from publicacoes p join ids on ids.id=p.id where nome='feed')='esgotado', null;
update itens set status = 'ENTREGUE' where sku = 'F1';
insert into res select 'VENDIDO→ENTREGUE não repete o comentário', (select count(*) from integracao_jobs where tipo='ig.comentar_vendido' and idem_key like 'igv:F1:%')=1, null;
update canais set config = config || '{"comentar_vendido": false}' where codigo='instagram';
update itens set status = 'VENDIDO' where sku = 'F2';
insert into res select 'comentar_vendido=false não enfileira', not exists (select 1 from integracao_jobs where idem_key like 'igv:F2:%'), null;

-- reenfileirar publicação com erro
update publicacoes set status='erro', erro='falhou' where id=(select id from r2);
update integracao_jobs set status='morto', tentativas=5 where idem_key='pub:'||(select id from r2);  -- o job nasceu na aprovação
select set_config('request.jwt.claims', '{"email":"ana@x"}', false);
set role authenticated;
select publicacao_reenfileirar((select id from r2));
reset role;
insert into res select 'reenfileirar reabre publicação e job', (select status from publicacoes where id=(select id from r2))='aprovado'
  and (select status||tentativas from integracao_jobs where idem_key='pub:'||(select id from r2))='pendente0', null;

-- token do Instagram invisível ao app
set role authenticated;
insert into res select 'authenticated não lê instagram_oauth', not has_table_privilege('authenticated','instagram_oauth','select') or (select count(*) from instagram_oauth)=0, null;
reset role;

select case when ok then 'PASS' else 'FAIL' end || ' | ' || teste || coalesce(' | ' || detalhe, '') from res;
