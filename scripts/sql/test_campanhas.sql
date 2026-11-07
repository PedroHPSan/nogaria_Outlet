-- Comportamento do núcleo de campanhas (20261107150000). Roda como supabase_admin.
\set QUIET on
create temp table res (teste text, ok boolean, detalhe text);
insert into itens (sku, produto, status, preco_ideal, grupo, lote, estado) values
 ('A1','Camisa','PRONTO',100,'Vestuário','L1','NOVO'),
 ('A2','Tênis','PRONTO',200,'Calçados','L1','NOVO'),
 ('A3','Furadeira','ANUNCIADO',300,'Ferramentas','L2','USADO'),
 ('A4','Sem preço','PRONTO',null,'Vestuário','L1','NOVO'),
 ('A5','Vendido','VENDIDO',100,'Vestuário','L1','NOVO'),
 ('A6','Camisa 2','PRONTO',99.99,'Vestuário','L3','NOVO');
create function pe(p_sku text, p_canal text default 'whatsapp', p_em timestamptz default now()) returns record language sql as
 $$ select (precos_efetivos(array[p_sku], p_canal, p_em)) $$;
create function preco(p_sku text, p_canal text default 'whatsapp', p_em timestamptz default now()) returns numeric language sql as
 $$ select preco from precos_efetivos(array[p_sku], p_canal, p_em) $$;

do $$ declare c1 uuid; c2 uuid; c3 uuid; r jsonb; m text; d text; n int; begin
  -- C1: 10% geral · 30% Vestuário · A1 15% · A6 0% (exclui) · instagram: 50% geral
  insert into campanhas (nome, inicio_em, fim_em) values ('Semana', now()-interval '1 hour', now()+interval '2 days') returning id into c1;
  insert into campanha_regras (campanha_id, tipo, alvo, canal, desconto_pct) values
    (c1,'geral',null,null,10),(c1,'grupo','Vestuário',null,30),(c1,'item','A1',null,15),(c1,'item','A6',null,0),(c1,'geral',null,'instagram',50);

  -- rascunho não aplica
  insert into res values ('rascunho não aplica preço', preco('A1') = 100, null);
  insert into res values ('simulação funciona no rascunho', (select count(*) from campanha_simular(c1,'*')) = 4, null);   -- A1 A2 A3 + A6 (0% = excluído, aparece com preço cheio)
  r := campanha_publicar(c1);
  insert into res values ('publica e grava linhas', (r->>'linhas')::int > 0, r::text);
  insert into res values ('item vence grupo vence geral (A1=15%)', preco('A1') = 85, preco('A1')::text);
  insert into res values ('grupo vence geral (A2 é Calçados → geral 10%)', preco('A2') = 180, preco('A2')::text);
  insert into res values ('geral aplica (A3 10%)', preco('A3') = 270, preco('A3')::text);
  insert into res values ('0% exclui o item', preco('A6') = 99.99, preco('A6')::text);
  insert into res values ('canal específico (instagram 50%)', preco('A2','instagram') = 100, preco('A2','instagram')::text);
  insert into res values ('canal sem regra cai no geral (direto)', preco('A2','direto') = 180, preco('A2','direto')::text);
  insert into res values ('item de canal: A1 instagram, regra item (15%) > geral canal', preco('A1','instagram') = 85, preco('A1','instagram')::text);
  insert into res values ('sem preço e vendido ficam fora', not exists (select 1 from campanha_itens where sku in ('A4','A5')), null);
  insert into res values ('preco_cheio congelado', (select preco_cheio from campanha_itens where sku='A2' and canal='*') = 200, null);
  update itens set preco_ideal = 400 where sku = 'A2';
  insert into res values ('mudar preco_ideal não altera a promo', preco('A2') = 180 and (select preco_cheio from precos_efetivos(array['A2']) ) = 200, preco('A2')::text);
  update itens set preco_ideal = 200 where sku = 'A2';

  -- bordas [inicio, fim)
  insert into res values ('antes do início: sem promo', preco('A3','whatsapp', now()-interval '2 hours') = 300, null);
  insert into res values ('no fim exato: sem promo', preco('A3','whatsapp', (select fim_em from campanhas where id=c1)) = 300, null);
  insert into res values ('no início exato: com promo', preco('A3','whatsapp', (select inicio_em from campanhas where id=c1)) = 270, null);
  insert into res values ('campanha_id/fim expostos', (select campanha_id = c1 and campanha_fim is not null from precos_efetivos(array['A3'])), null);

  -- guardas
  m := null; begin update campanhas set status='PUBLICADA' where id = c1; exception when others then m := sqlerrm; end;
  insert into res values ('publicada não muda por UPDATE direto', m is not null, m);
  m := null; begin insert into campanhas (nome,inicio_em,fim_em,status) values ('Fraude',now(),now()+interval '1 day','PUBLICADA'); exception when others then m := sqlerrm; end;
  insert into res values ('não nasce publicada por INSERT', m is not null, m);
  m := null; begin delete from campanha_regras where campanha_id = c1; exception when others then m := sqlerrm; end;
  insert into res values ('regra de publicada imutável', m is not null, m);
  m := null; begin delete from campanhas where id = c1; exception when others then m := sqlerrm; end;
  insert into res values ('publicada não apaga por DELETE', m is not null and exists (select 1 from campanha_itens where campanha_id = c1), m);
  insert into campanhas (nome, inicio_em, fim_em) values ('Rasc', now(), now()+interval '1 day') returning id into c3;
  m := null; begin update campanha_regras set campanha_id = c3 where campanha_id = c1; exception when others then m := sqlerrm; end;
  insert into res values ('regra não sai de campanha publicada (UPDATE campanha_id)', m is not null and m like 'Regras só%', m);
  m := null; begin update campanha_regras set campanha_id = (select id from campanhas where status='RASCUNHO' limit 1) where campanha_id = c1; exception when others then m := sqlerrm; end;
  insert into res values ('regra não sai de campanha publicada (UPDATE campanha_id)', m is not null, m);
  m := null; begin update campanha_regras set campanha_id = c1 where false; insert into campanha_regras (campanha_id,tipo,alvo,desconto_pct) values (c1,'item','A3',5); exception when others then m := sqlerrm; end;
  insert into res values ('regra não entra em campanha publicada (INSERT)', m is not null, m);
  delete from campanhas where id = c3;
  insert into res values ('rascunho pode ser apagado', not exists (select 1 from campanhas where id = c3), null);
  m := null; begin perform campanha_publicar(c1); exception when others then m := sqlerrm; end;
  insert into res values ('não republica', m like 'Só rascunho%', m);

  -- C2: conflito de SKU com C1 (mesmo período) — A1 e A3 em C1
  insert into campanhas (nome, inicio_em, fim_em) values ('Outra', now(), now()+interval '1 day') returning id into c2;
  insert into campanha_regras (campanha_id, tipo, alvo, desconto_pct) values (c2,'item','A1',20),(c2,'item','A2',5),(c2,'item','A6',25);
  insert into res values ('simulação mostra conflito', (select conflito_campanha = c1 from campanha_simular(c2,'*') where sku='A1'), null);
  m := null; d := null;
  begin perform campanha_publicar(c2); exception when others then get stacked diagnostics d = pg_exception_detail; m := sqlerrm; end;
  insert into res values ('SKU em outra campanha ativa: recusa', m = 'CONFLITO_SKU' and d like '%A1%', m||' '||coalesce(d,''));
  -- C1 já cobre A1,A2,A3 com pct>0 → conflita A1 e A2; A6 (0% em C1) é livre
  r := campanha_publicar(c2, true);
  insert into res values ('ignorar conflitos publica o restante', (r->>'skus_ignorados')::int = 2 and exists (select 1 from campanha_itens where campanha_id=c2 and sku='A6'), r::text);
  insert into res values ('SKU excluído (0%) em C1 recebe a promo de C2', preco('A6') = 74.99 or preco('A6') = 75, preco('A6')::text);
  insert into res values ('SKUs em conflito ficam com C1', preco('A1') = 85, preco('A1')::text);

  -- C3: período que não cruza → mesmo SKU liberado
  insert into campanhas (nome, inicio_em, fim_em) values ('Futura', now()+interval '10 days', now()+interval '12 days') returning id into c3;
  insert into campanha_regras (campanha_id, tipo, alvo, desconto_pct) values (c3,'item','A1',40);
  r := campanha_publicar(c3);
  insert into res values ('período disjunto não conflita', (r->>'skus_ignorados')::int = 0, r::text);
  insert into res values ('futura agendada vale só no período', preco('A1','whatsapp', now()+interval '11 days') = 60 and preco('A1') = 85, null);

  -- encerrar antes do prazo / cancelar agendada
  perform campanha_encerrar(c1);
  insert into res values ('encerrar: promo some na hora', preco('A3') = 300, preco('A3')::text);
  insert into res values ('encerrar guarda fim_previsto', (select fim_previsto is not null and fim_em <= now() from campanhas where id=c1), null);
  perform campanha_encerrar(c3);
  insert into res values ('encerrar agendada cancela', (select status from campanhas where id=c3) = 'CANCELADA' and preco('A1','whatsapp', now()+interval '11 days') = 100, null);

  -- arredondamento
  insert into res values ('arredondar centavos', campanha_arredondar(89.994,'centavos') = 89.99, null);
  insert into res values ('arredondar inteiro', campanha_arredondar(89.6,'inteiro') = 90, null);
  insert into res values ('arredondar ,90', campanha_arredondar(89.6,'vitrine_90') = 88.90, null);
  -- validações de tabela
  m := null; begin insert into campanhas (nome,inicio_em,fim_em) values ('xx',now(),now()+interval '1 day'); exception when others then m := sqlerrm; end;
  insert into res values ('nome curto recusado', m is not null, null);
  m := null; begin insert into campanhas (nome,inicio_em,fim_em) values ('Invertida',now(),now()-interval '1 day'); exception when others then m := sqlerrm; end;
  insert into res values ('fim antes do início recusado', m is not null, null);
  m := null; begin insert into campanha_regras (campanha_id,tipo,alvo,desconto_pct) select id,'geral','x',10 from campanhas limit 1; exception when others then m := sqlerrm; end;
  insert into res values ('geral com alvo recusado', m is not null, null);
end $$;

-- privilégios
insert into res select 'anon não executa precos_efetivos', not has_function_privilege('anon','precos_efetivos(text[],text,timestamptz)','execute'), null;
insert into res select 'anon não executa publicar', not has_function_privilege('anon','campanha_publicar(uuid,boolean,text)','execute'), null;
insert into res select 'anon sem acesso às tabelas', not has_table_privilege('anon','campanhas','select') and not has_table_privilege('anon','campanha_itens','select'), null;
insert into res select 'authenticated não escreve em campanha_itens', not has_table_privilege('authenticated','campanha_itens','insert'), null;
insert into res select 'authenticated lê campanha_itens', has_table_privilege('authenticated','campanha_itens','select'), null;
select case when ok then 'PASS' else 'FAIL' end || ' | ' || teste || coalesce(' | ' || detalhe, '') from res;
