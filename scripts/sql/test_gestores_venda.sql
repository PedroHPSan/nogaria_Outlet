-- Permissionamento de vendas (20261116100000_gestores_venda.sql). Roda como supabase_admin; o JWT de cada usuário é
-- simulado com set_config('request.jwt.claims') + set role authenticated. Precisa de itens, orcamentos e reservas.
\set QUIET on
-- liberar_reserva igual à de produção (SECURITY DEFINER), caso a base de teste não tenha
create or replace function public.liberar_reserva(p_origem_tipo text, p_origem_ref text, p_sku text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update reservas set status = 'LIBERADA'
   where status = 'ATIVA' and origem_tipo = p_origem_tipo and origem_ref is not distinct from p_origem_ref
     and (p_sku is null or sku = p_sku);
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.liberar_reserva(text, text, text) to authenticated;

alter table orcamentos drop constraint if exists orcamentos_status_check; -- base de teste antiga não tem ABERTA
create temp table res (teste text, ok boolean, detalhe text);
grant all on res to authenticated;
grant select, insert, update, delete on itens, reservas, orcamentos to authenticated;
insert into itens (sku, produto, status, preco_ideal) values ('P1','A','PRONTO',100),('P2','B','PRONTO',null),('P3','C','PRONTO',100),('P4','D','PRONTO',10),('P5','E','PRONTO',10);
insert into orcamentos (codigo, slug, status, itens, validade) values
  ('SAC-1','s1','ABERTA','[{"sku":"P1"}]', now()+interval '1 day'),
  ('SAC-2','s2','ABERTA','[{"sku":"P3"}]', now()+interval '1 day'),
  ('SAC-3','s3','ABERTA','[]', now()+interval '1 day');
insert into reservas (sku, canal, origem_tipo, origem_ref, status, expira_em) values
  ('P1','whatsapp','sacola','SAC-1','ATIVA', now()+interval '1 day'),
  ('P3','whatsapp','sacola','SAC-2','ATIVA', now()+interval '1 day'),
  ('P2','whatsapp','carrinho_wa','wa:1','ATIVA', now()+interval '1 day'),
  ('P4','whatsapp','carrinho_wa','wa:2','ATIVA', now()-interval '1 hour'),
  ('P5','whatsapp','carrinho_wa','wa:3','ATIVA', now()+interval '1 hour');

-- operador comum
select set_config('request.jwt.claims', '{"role":"authenticated","email":"aline@nogaria.com.br"}', false);
set role authenticated;
do $$ declare m text; begin
  insert into res values ('operador: pode_gerir_venda() = false', not pode_gerir_venda(), null);
  begin update itens set preco_ideal = 90 where sku = 'P1'; exception when others then m := sqlerrm; end;
  insert into res values ('operador NÃO troca preço já definido', m like '%só Bárbara e Valentina%', m); m := null;
  begin update itens set preco_ideal = 50 where sku = 'P2'; exception when others then m := 'ERRO: ' || sqlerrm; end;
  insert into res values ('operador define o PRIMEIRO preço (vazio)', m is null, m); m := null;
  begin update itens set produto = 'A2', preco_ideal = 100 where sku = 'P1'; exception when others then m := 'ERRO: ' || sqlerrm; end;
  insert into res values ('operador salva a ficha sem mudar o preço', m is null, m); m := null;
  begin perform liberar_reserva('sacola', 'SAC-1', 'P1'); exception when others then m := sqlerrm; end;
  insert into res values ('operador NÃO tira item da sacola (RPC SECURITY DEFINER)', m like '%cancelar a separação%', m); m := null;
  begin update reservas set status = 'LIBERADA' where sku = 'P2'; exception when others then m := sqlerrm; end;
  insert into res values ('operador NÃO libera reserva do bot direto', m like '%cancelar a separação%', m); m := null;
  begin delete from reservas where sku = 'P2'; exception when others then m := sqlerrm; end;
  insert into res values ('operador NÃO apaga reserva ativa', m like '%cancelar a separação%', m); m := null;
  begin update orcamentos set status = 'CANCELADO' where codigo = 'SAC-1'; exception when others then m := sqlerrm; end;
  insert into res values ('operador NÃO cancela sacola com reserva', m like '%cancelar a separação%', m); m := null;
  begin update orcamentos set status = 'CANCELADO' where codigo = 'SAC-3'; exception when others then m := 'ERRO: ' || sqlerrm; end;
  insert into res values ('operador cancela orçamento SEM reserva', m is null, m); m := null;
  begin update reservas set status = 'CONFIRMADA' where sku = 'P3'; exception when others then m := 'ERRO: ' || sqlerrm; end;
  insert into res values ('venda (ATIVA→CONFIRMADA) segue livre', m is null, m); m := null;
  begin update reservas set status = 'EXPIRADA' where sku = 'P2'; exception when others then m := sqlerrm; end;
  insert into res values ('operador NÃO expira reserva antes do prazo', m like '%cancelar a separação%', m); m := null;
  begin update reservas set expira_em = now() - interval '1 minute' where sku = 'P2'; exception when others then m := sqlerrm; end;
  insert into res values ('operador NÃO vence o prazo na hora', m like '%cancelar a separação%', m); m := null;
  begin update reservas set origem_ref = 'SAC-X' where sku = 'P1'; exception when others then m := sqlerrm; end;
  insert into res values ('operador NÃO troca a sacola dona da reserva', m like '%cancelar a separação%', m); m := null;
  begin update reservas set sku = 'P9' where sku = 'P1'; exception when others then m := sqlerrm; end;
  insert into res values ('operador NÃO troca o SKU da reserva', m like '%cancelar a separação%', m); m := null;
  begin update reservas set status = 'ATIVA' where sku = 'P3'; exception when others then m := sqlerrm; end;
  insert into res values ('operador NÃO sai de status final (CONFIRMADA)', m like '%cancelar a separação%', m); m := null;
  begin update reservas set expira_em = now() + interval '3 days' where sku = 'P1'; exception when others then m := 'ERRO: ' || sqlerrm; end;
  insert into res values ('operador renova o prazo para o futuro', m is null, m); m := null;
  begin update reservas set status = 'EXPIRADA' where sku = 'P4'; exception when others then m := 'ERRO: ' || sqlerrm; end;
  insert into res values ('operador expira reserva já vencida (reservas_expirar)', m is null, m); m := null;
  begin update reservas set origem_tipo = 'sacola', origem_ref = 'SAC-9', expira_em = now() + interval '2 days' where sku = 'P5';
  exception when others then m := 'ERRO: ' || sqlerrm; end;
  insert into res values ('operador assume reserva do bot na sacola (N8)', m is null, m); m := null;
  begin insert into gestores_venda (email) values ('aline@nogaria.com.br'); exception when others then m := sqlerrm; end;
  insert into res values ('operador NÃO se inclui em gestores_venda', m is not null, m); m := null;
  begin update orcamentos set validade = now() - interval '1 minute' where codigo = 'SAC-1'; exception when others then m := sqlerrm; end;
  insert into res values ('operador NÃO vence a validade da sacola com reserva', m like '%encurtar o prazo%', m); m := null;
  begin update orcamentos set validade = now() + interval '1 hour' where codigo = 'SAC-1'; exception when others then m := sqlerrm; end;
  insert into res values ('operador NÃO encurta a validade para poucas horas', m like '%encurtar o prazo%', m); m := null;
  begin update orcamentos set validade = now() + interval '1 day' where codigo = 'SAC-1'; exception when others then m := 'ERRO: ' || sqlerrm; end;
  insert into res values ('operador ajusta validade para 1 dia (renovar/re-separar)', m is null, m); m := null;
  begin update orcamentos set validade = now() - interval '1 day' where codigo = 'SAC-3'; exception when others then m := 'ERRO: ' || sqlerrm; end;
  insert into res values ('operador mexe na validade de orçamento SEM reserva', m is null, m); m := null;
  begin delete from itens where sku = 'P2'; exception when others then m := sqlerrm; end;
  insert into res values ('operador NÃO apaga item', m like '%excluir um item%', m); m := null;
  begin update reservas set expira_em = now() + interval '1 minute' where sku = 'P2'; exception when others then m := sqlerrm; end;
  insert into res values ('operador NÃO encurta reserva para 1 minuto', m like '%cancelar a separação%', m); m := null;
  begin update orcamentos set codigo = 'SAC-1X' where codigo = 'SAC-1'; exception when others then m := sqlerrm; end;
  insert into res values ('operador NÃO renomeia sacola com reserva', m like '%cancelar a separação%', m); m := null;
  begin delete from orcamentos where codigo = 'SAC-1'; exception when others then m := sqlerrm; end;
  insert into res values ('operador NÃO apaga sacola com reserva', m like '%cancelar a separação%', m); m := null;
  begin delete from orcamentos where codigo = 'SAC-3'; exception when others then m := 'ERRO: ' || sqlerrm; end;
  insert into res values ('operador apaga orçamento SEM reserva (rollback do separar)', m is null, m); m := null;
  begin update itens set sku = 'P1Z' where sku = 'P1'; exception when others then m := sqlerrm; end;
  insert into res values ('operador NÃO renomeia SKU de item precificado', m like '%trocar o SKU%', m); m := null;
  insert into itens (sku, produto, status) values ('P6','F','PRONTO');
  begin update itens set sku = 'P6Z' where sku = 'P6'; exception when others then m := 'ERRO: ' || sqlerrm; end;
  insert into res values ('operador renomeia SKU de item sem preço (atribuir lote)', m is null, m);
end $$;
reset role;

-- gestora (Valentina)
select set_config('request.jwt.claims', '{"role":"authenticated","email":"Financeiro@nogaria.com.br"}', false);
set role authenticated;
do $$ declare m text; begin
  insert into res values ('gestora: pode_gerir_venda() = true (e-mail sem caixa)', pode_gerir_venda(), null);
  begin update itens set preco_ideal = 90 where sku = 'P1'; exception when others then m := 'ERRO: ' || sqlerrm; end;
  insert into res values ('gestora troca preço', m is null, m); m := null;
  begin update orcamentos set status = 'CANCELADO' where codigo = 'SAC-1'; perform liberar_reserva('sacola', 'SAC-1');
  exception when others then m := 'ERRO: ' || sqlerrm; end;
  insert into res values ('gestora cancela sacola e libera', m is null and (select status from reservas where sku='P1')='LIBERADA', m); m := null;
  begin update reservas set status = 'LIBERADA' where sku = 'P2'; exception when others then m := 'ERRO: ' || sqlerrm; end;
  insert into res values ('gestora libera reserva do bot', m is null, m);
end $$;
reset role;

-- service_role / cron (sem JWT de usuário) passam
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
update itens set preco_ideal = 80 where sku = 'P1';
select set_config('request.jwt.claims', '', false);
update itens set preco_ideal = 70 where sku = 'P1';
insert into res select 'service_role e cron trocam preço', (select preco_ideal from itens where sku='P1') = 70, null;

-- cron: sacola com validade vencida mas reserva no prazo NÃO solta a reserva; a vencida solta
insert into itens (sku, produto, status) values ('P7','G','PRONTO'),('P8','H','PRONTO');
insert into orcamentos (codigo, slug, status, itens, validade) values
  ('SAC-7','s7','ABERTA','[{"sku":"P7"}]', now()-interval '1 minute'),
  ('SAC-8','s8','ABERTA','[{"sku":"P8"}]', now()-interval '1 minute');
insert into reservas (sku, canal, origem_tipo, origem_ref, status, expira_em) values
  ('P7','whatsapp','sacola','SAC-7','ATIVA', now()+interval '2 days'),
  ('P8','whatsapp','sacola','SAC-8','ATIVA', now()-interval '1 minute');
select set_config('request.jwt.claims', '', false);
select sacolas_expirar();
insert into res select 'cron: sacola forjada vencida NÃO solta reserva no prazo', (select status from reservas where sku='P7')='ATIVA', null;
insert into res select 'cron: reserva vencida da sacola é solta', (select status from reservas where sku='P8')='LIBERADA', null;

select case when ok then 'PASS' else 'FAIL' end as r, teste, detalhe from res;
