-- N1: migration 20261102200000_guarda_status.sql (roda como supabase_admin; usa `set role` para simular a API).
\set QUIET on
create temp table res (teste text, ok boolean, detalhe text);
grant all on res to authenticated, anon;
insert into itens (sku, produto, status) values
  ('G1','A','PRONTO'),('G2','B','TRIADO'),('G3','C','VENDIDO'),('G4','D','PRONTO'),('G5','E','PRONTO'),('G6','F','ENTREGUE'),('G7','G','PRONTO');
grant select, insert, update on itens, eventos to authenticated, anon;

-- trigger: a API não escreve status final nem sai dele
set role authenticated;
do $$ declare m text; begin
  begin update itens set status = 'VENDIDO' where sku = 'G1'; exception when others then m := sqlerrm; end;
  insert into res values ('UPDATE direto para VENDIDO é recusado', m like '%só por RPC%', m); m := null;
  begin update itens set status = 'DESCARTE' where sku = 'G1'; exception when others then m := sqlerrm; end;
  insert into res values ('UPDATE direto para DESCARTE é recusado', m like '%só por RPC%', m); m := null;
  begin update itens set status = 'PRONTO' where sku = 'G3'; exception when others then m := sqlerrm; end;
  insert into res values ('UPDATE direto saindo de VENDIDO é recusado', m like '%só por RPC%', m); m := null;
  begin insert into itens (sku, produto, status) values ('GX','x','VENDIDO'); exception when others then m := sqlerrm; end;
  insert into res values ('INSERT direto como VENDIDO é recusado', m like '%só pode ser definido por RPC%', m); m := null;
  begin update itens set status = 'PRECIFICADO' where sku = 'G2'; exception when others then m := 'ERRO: ' || sqlerrm; end;
  insert into res values ('etapa comum (TRIADO→PRECIFICADO) continua direta', m is null, m); m := null;
  begin insert into itens (sku, produto) values ('GY','y'); exception when others then m := 'ERRO: ' || sqlerrm; end;
  insert into res values ('INSERT comum (A_CATALOGAR) continua direto', m is null, m);
end $$;
set role anon;
do $$ begin
  begin update itens set status = 'VENDIDO' where sku = 'G4'; exception when others then null; end;
end $$;
reset role;
insert into res select 'anon não consegue vender direto (RLS ou trava)', (select status::text from itens where sku='G4')='PRONTO', null;
update itens set status = 'VENDIDO' where sku = 'G4';
insert into res select 'admin/service role passa (migrations e scripts)', (select status::text from itens where sku='G4')='VENDIDO', null;
update itens set status = 'PRONTO' where sku = 'G4';

-- mover_etapa
set role authenticated;
select mover_etapa('G2', 'TESTADO', 'ana@x', 'Triado');
reset role;
insert into res select 'mover_etapa move e registra o evento com "de <etapa>"', (select status::text from itens where sku='G2')='TESTADO'
  and exists (select 1 from eventos where sku='G2' and acao='status:TESTADO' and detalhe='de Triado' and usuario='ana@x'), null;
set role authenticated;
do $$ declare m text; begin
  begin perform mover_etapa('G1', 'VENDIDO', 'ana@x'); exception when others then m := sqlerrm; end;
  insert into res values ('mover_etapa recusa VENDIDO como destino', m like '%baixar_venda%', m); m := null;
  begin perform mover_etapa('G3', 'PRONTO', 'ana@x'); exception when others then m := sqlerrm; end;
  insert into res values ('mover_etapa recusa sair de VENDIDO', m like '%reabrir_estoque%', m); m := null;
  begin perform mover_etapa('G1', 'XYZ', 'ana@x'); exception when others then m := sqlerrm; end;
  insert into res values ('mover_etapa recusa etapa inválida', m like '%inválida%', m);
end $$;
reset role;

-- reserva ativa bloqueia ANUNCIADO e DESCARTE
insert into reservas (sku, canal, origem_tipo, origem_ref, expira_em) values ('G4','whatsapp','sacola','ORC-G4', now() + interval '1 day');
set role authenticated;
do $$ declare m text; begin
  begin perform mover_etapa('G4', 'ANUNCIADO', 'ana@x'); exception when others then m := sqlerrm; end;
  insert into res values ('item reservado não vira ANUNCIADO', m like '%reservado%', m); m := null;
  begin perform marcar_anunciado('G4', 'ana@x'); exception when others then m := sqlerrm; end;
  insert into res values ('marcar_anunciado também recusa reservado', m like '%reservado%', m); m := null;
  begin perform mover_etapa('G4', 'DESCARTE', 'ana@x'); exception when others then m := sqlerrm; end;
  insert into res values ('item reservado não vai para DESCARTE', m like '%reservado%', m);
end $$;
select marcar_anunciado('G5', 'ana@x');
select mover_etapa('G7', 'DESCARTE', 'ana@x');
reset role;
insert into res select 'marcar_anunciado em item livre funciona', (select status::text from itens where sku='G5')='ANUNCIADO', null;
insert into res select 'DESCARTE por RPC funciona', (select status::text from itens where sku='G7')='DESCARTE', null;

-- marcar_entregue
set role authenticated;
do $$ declare m text; begin
  begin perform marcar_entregue('G1', 'ana@x'); exception when others then m := sqlerrm; end;
  insert into res values ('marcar_entregue recusa item não vendido', m like '%só item VENDIDO%', m);
end $$;
select marcar_entregue('G3', 'ana@x');
select marcar_entregue('G3', 'ana@x');
reset role;
insert into res select 'marcar_entregue carimba entregue_em (e é idempotente)', (select status::text from itens where sku='G3')='ENTREGUE'
  and (select entregue_em from itens where sku='G3') is not null and (select count(*) from eventos where sku='G3' and acao='status:ENTREGUE')=1, null;

-- reabrir_estoque
update itens set valor_vendido = 120, canal_venda = 'Amazon', pedido_ref = 'P-9', comprador = 'Zé', vendido_em = now() where sku = 'G6';
set role authenticated;
do $$ declare m text; begin
  begin perform reabrir_estoque('G6', '   ', 'PRONTO', 'ana@x'); exception when others then m := sqlerrm; end;
  insert into res values ('reabrir exige motivo', m like '%motivo%', m); m := null;
  begin perform reabrir_estoque('G1', 'teste', 'PRONTO', 'ana@x'); exception when others then m := sqlerrm; end;
  insert into res values ('reabrir recusa item não vendido', m like '%só item VENDIDO/ENTREGUE%', m); m := null;
  begin perform reabrir_estoque('G6', 'cliente devolveu', 'VENDIDO', 'ana@x'); exception when others then m := sqlerrm; end;
  insert into res values ('reabrir recusa destino final', m like '%inválida%', m);
end $$;
select reabrir_estoque('G6', 'cliente devolveu', 'PRONTO', 'ana@x');
reset role;
insert into res select 'reabrir devolve ao estoque e zera os dados da venda', (select status::text from itens where sku='G6')='PRONTO'
  and (select valor_vendido from itens where sku='G6') is null and (select pedido_ref from itens where sku='G6') is null
  and (select vendido_em from itens where sku='G6') is null, null;
insert into res select 'reabrir guarda a venda anterior no evento', exists (select 1 from eventos where sku='G6' and detalhe like '%cliente devolveu%' and detalhe like '%P-9%' and detalhe like '%120%'), null;

-- baixar_venda (já existente) continua passando pela trava
select baixar_venda('G1', 99, 'WhatsApp', 'ORC-G1', 'Ana', null, null, 'ana@x');
insert into res select 'baixar_venda continua funcionando com a trava', (select status::text from itens where sku='G1')='VENDIDO', null;

-- permissões
insert into res select 'anon não executa mover_etapa', not has_function_privilege('anon','mover_etapa(text,text,text,text)','execute'), null;
insert into res select 'anon não executa reabrir_estoque', not has_function_privilege('anon','reabrir_estoque(text,text,text,text)','execute'), null;
insert into res select 'authenticated executa as 4 RPCs', has_function_privilege('authenticated','mover_etapa(text,text,text,text)','execute')
  and has_function_privilege('authenticated','marcar_entregue(text,text)','execute')
  and has_function_privilege('authenticated','marcar_anunciado(text,text)','execute')
  and has_function_privilege('authenticated','reabrir_estoque(text,text,text,text)','execute'), null;

select case when ok then 'PASS' else 'FAIL' end || ' | ' || teste || coalesce(' | ' || detalhe, '') from res;
