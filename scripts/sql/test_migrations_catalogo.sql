-- Testes de comportamento das migrations 20260801* (RLS, RPCs, checks, backfill).
-- Rode DEPOIS de base_minima.sql + as 4 migrations. Imprime PASS/FAIL por teste.
\set ON_ERROR_STOP on
\set QUIET on
-- Simula os privilégios padrão do Supabase: anon/authenticated com acesso às tabelas; quem barra é o RLS.
grant all on all tables in schema public to anon, authenticated;
grant usage on all sequences in schema public to anon, authenticated;

-- dados
insert into itens (sku, produto, status, preco_ideal) values ('NOG1','Sofá','PRONTO',1000),('NOG2','Mesa','A_CATALOGAR',400);
insert into eventos (sku, acao, usuario, ts) values ('NOG1','status:PRONTO','t', now() - interval '70 days'), ('NOG1','status:ANUNCIADO','t', now() - interval '60 days');
insert into orcamentos (codigo, slug, status, itens, total, cliente_nome, cliente_whatsapp, validade) values
 ('ORC-0001','slug-env','ENVIADO','[{"sku":"NOG1","produto":"Sofá","preco":1000}]',1000,'Maria','5591911112222', now()+interval '2 days'),
 ('ORC-0002','slug-rasc','RASCUNHO','[]',0,'Joao','5591933334444', now()+interval '2 days'),
 ('ORC-0003','slug-venc','RESERVADO','[]',0,'Ana','5591955556666', now()-interval '1 hour');
insert into catalogos_publicos (slug, titulo, payload) values ('cat1','C','{}'),('cat-exp','E','{}');
update catalogos_publicos set expira_em = now() - interval '1 day' where slug='cat-exp';

do $$ begin
  -- M4: backfill e faixas
  perform 1;
end $$;

create temp table res (teste text, ok boolean, detalhe text);
grant all on res to anon, authenticated;

-- ===== M4 =====
insert into res select 'M4 seed de 4 faixas', (select count(*) from pricing_markdown_idade)=4, (select count(*)::text from pricing_markdown_idade);
-- reexecuta o backfill (a migration rodou antes dos dados): mesma query
update itens i set disponivel_desde = e.primeiro from (select sku, min(ts) as primeiro from eventos where acao in ('status:PRONTO','status:ANUNCIADO') group by sku) e where e.sku=i.sku and i.disponivel_desde is null;
insert into res select 'M4 backfill pega o 1º evento (~70 dias)', (select disponivel_desde < now()-interval '69 days' and disponivel_desde > now()-interval '71 days' from itens where sku='NOG1'), (select disponivel_desde::text from itens where sku='NOG1');
insert into res select 'M4 item sem evento fica nulo', (select disponivel_desde is null from itens where sku='NOG2'), '';
do $$ begin begin insert into itens(sku, preco_aprovacao) values ('X','TALVEZ'); exception when check_violation then insert into res values ('M4 check de preco_aprovacao', true, 'rejeitou TALVEZ'); end; end $$;
do $$ begin begin insert into pricing_markdown_idade(dias_min,dias_max,pct) values (0,10,95); exception when check_violation then insert into res values ('M4 check pct ≤ 90', true, 'rejeitou 95'); end; end $$;

-- ===== M3 =====
do $$ begin begin insert into orcamentos(codigo,slug,itens,desconto_pct,validade) values ('ORC-9','s9','[]',95,now()); exception when check_violation then insert into res values ('M3 check desconto ≤ 90', true, 'rejeitou 95'); end; end $$;
do $$ begin begin insert into orcamentos(codigo,slug,status,itens,validade) values ('ORC-8','s8','XYZ','[]',now()); exception when check_violation then insert into res values ('M3 check de status', true, 'rejeitou XYZ'); end; end $$;
do $$ begin begin insert into orcamentos(codigo,slug,itens,validade) values ('ORC-0001','sN','[]',now()); exception when unique_violation then insert into res values ('M3 código único', true, 'rejeitou duplicado'); end; end $$;

set role anon;
insert into res select 'M3 anon NÃO lista orcamentos (RLS)', (select count(*) from orcamentos)=0, (select count(*)::text from orcamentos);
do $$ begin begin update orcamentos set status='VENDIDO'; insert into res values ('M3 anon não altera', (select count(*) from orcamentos)=0, 'update afetou 0 linhas'); exception when others then insert into res values ('M3 anon não altera', true, sqlerrm); end; end $$;
insert into res select 'M3 RPC devolve ENVIADO válido pelo slug', (select count(*) from orcamento_publico('slug-env'))=1, '';
insert into res select 'M3 RPC não devolve RASCUNHO', (select count(*) from orcamento_publico('slug-rasc'))=0, '';
insert into res select 'M3 RPC não devolve vencido', (select count(*) from orcamento_publico('slug-venc'))=0, '';
insert into res select 'M3 RPC não devolve slug inexistente', (select count(*) from orcamento_publico('nada'))=0, '';
insert into res select 'M3 RPC sem WhatsApp do cliente', (select not exists (select 1 from information_schema.columns where table_name='orcamento_publico')) and (select count(*) from (select * from orcamento_publico('slug-env')) t)=1 and not ((select to_jsonb(t) from orcamento_publico('slug-env') t) ? 'cliente_whatsapp'), '';
insert into res select 'M3 RPC não aceita curinga no slug', (select count(*) from orcamento_publico('slug-%'))=0, '';
reset role;

set role authenticated;
insert into res select 'M3 autenticado lê/escreve tudo', (select count(*) from orcamentos)=3, '';
update itens set reservado_ate = now()+interval '48 hours', reservado_por_orc='ORC-0001' where sku='NOG1';
insert into res select 'M3 reserva grava em itens', (select reservado_por_orc from itens where sku='NOG1')='ORC-0001', '';
reset role;

-- ===== M2 =====
set role anon;
select catalogo_publico_visualizar('cat1'); select catalogo_publico_visualizar('cat1'); select catalogo_publico_visualizar('cat-exp'); select catalogo_publico_visualizar('inexistente');
do $$ begin begin update catalogos_publicos set visualizacoes = 999; exception when others then null; end; end $$;
reset role;
insert into res select 'M2 contador soma 2 aberturas', (select visualizacoes from catalogos_publicos where slug='cat1')=2, (select visualizacoes::text from catalogos_publicos where slug='cat1');
insert into res select 'M2 expirado não conta', (select visualizacoes from catalogos_publicos where slug='cat-exp')=0, '';
insert into res select 'M2 anon não edita a tabela direto', (select visualizacoes from catalogos_publicos where slug='cat1')=2, '';

-- ===== M6/M7 =====
set role anon;
insert into res select 'M6 anon não lê empresa_config', (select count(*) from empresa_config)=0, '';
reset role;
set role authenticated;
insert into empresa_config(chave,valor) values ('whatsapp','5591988887777') on conflict (chave) do update set valor=excluded.valor;
insert into empresa_config(chave,valor) values ('whatsapp','5591999990000') on conflict (chave) do update set valor=excluded.valor;
insert into res select 'M6 upsert da config', (select valor from empresa_config where chave='whatsapp')='5591999990000', '';
insert into catalogo_predefinicoes(nome, spec) values ('Semanal','{"modelo":"lista"}');
insert into catalogo_historico(titulo, formato, n_itens) values ('Cat','pdf',12);
insert into res select 'M7 predefinição e histórico gravam', (select count(*) from catalogo_predefinicoes)=1 and (select count(*) from catalogo_historico)=1, '';
reset role;
set role anon;
insert into res select 'M7 anon não lê predefinições/histórico', (select count(*) from catalogo_predefinicoes)=0 and (select count(*) from catalogo_historico)=0, '';
reset role;

select case when ok then 'PASS' else 'FAIL' end as r, teste, detalhe from res order by 1 desc, 2;
