-- Comportamento da migration 20261102120000_omnichannel_base.sql.
-- Rode DEPOIS de base_minima.sql + orcamentos + sacolas + interesses (stub) + publicar_amazon + a migration.
\set QUIET on
grant all on all tables in schema public to anon, authenticated;
create temp table res (teste text, ok boolean, detalhe text);
grant all on res to anon, authenticated;

insert into itens (sku, produto, status, preco_ideal) values ('S1','Fone','PRONTO',100),('S2','Cabo','PRONTO',50);

insert into res select 'canais semeados', (select count(*) from canais) = 8, null;

-- reserva ativa: projeta em itens e bloqueia a segunda
insert into reservas (sku, canal, origem_tipo, origem_ref, expira_em) values ('S1','whatsapp','sacola','ORC-1', now() + interval '2 days');
insert into res select 'reserva de sacola projeta reservado_por_orc',
  (select reservado_por_orc from itens where sku='S1') = 'ORC-1' and (select reservado_ate from itens where sku='S1') > now(), null;
do $$ declare ok boolean := false; begin
  begin insert into reservas (sku, canal, origem_tipo) values ('S1','amazon','pedido_amazon'); exception when unique_violation then ok := true; end;
  insert into res values ('segunda reserva ATIVA no mesmo SKU recusada', ok, null);
end $$;

-- liberar: some a projeção e permite nova reserva
update reservas set status = 'LIBERADA' where sku = 'S1' and status = 'ATIVA';
insert into res select 'liberar limpa a projeção', (select reservado_ate from itens where sku='S1') is null
  and (select reservado_por_orc from itens where sku='S1') is null, null;
insert into reservas (sku, canal, origem_tipo, origem_ref) values ('S1','amazon','pedido_amazon','A-1');
insert into res select 'reserva de marketplace sem prazo esconde o item (sem sacola)',
  (select reservado_ate from itens where sku='S1') > now() + interval '1 year'
  and (select reservado_por_orc from itens where sku='S1') is null, null;

-- idempotência de pedidos e eventos
insert into pedidos_canal (canal, external_id, valor) values ('amazon','111-1',50);
do $$ declare ok boolean := false; begin
  begin insert into pedidos_canal (canal, external_id) values ('amazon','111-1'); exception when unique_violation then ok := true; end;
  insert into res values ('pedido duplicado (canal+external_id) recusado', ok, null);
  ok := false;
  insert into webhook_eventos (canal, external_id, payload) values ('ml','e1','{}');
  begin insert into webhook_eventos (canal, external_id, payload) values ('ml','e1','{}'); exception when unique_violation then ok := true; end;
  insert into res values ('webhook repetido recusado', ok, null);
  ok := false;
  insert into integracao_jobs (tipo, idem_key) values ('noop','k1');
  begin insert into integracao_jobs (tipo, idem_key) values ('noop','k1'); exception when unique_violation then ok := true; end;
  insert into res values ('job com mesma idem_key recusado', ok, null);
end $$;

insert into res select 'vw_pedidos_unificados lê pedidos_canal', count(*) = 1, null from vw_pedidos_unificados where canal = 'amazon';

-- jobs/inbox invisíveis ao app (sem policy)
set role authenticated;
insert into res select 'authenticated não lê integracao_jobs', count(*) = 0, null from integracao_jobs;
insert into res select 'authenticated não lê webhook_eventos', count(*) = 0, null from webhook_eventos;
reset role;

select case when ok then 'PASS' else 'FAIL' end || ' | ' || teste || coalesce(' | ' || detalhe, '') from res;
