-- Migration 20261102170000_catalogo_meta.sql (roda como supabase_admin).
\set QUIET on
create temp table res (teste text, ok boolean, detalhe text);
grant all on res to anon, authenticated;
insert into itens (sku, produto, status) values ('M1','Tênis','PRONTO'),('M2','Bolsa','PRONTO'),('M3','Cinto','VENDIDO'),('M4','Lenço','PRONTO');
create or replace function public.t_pl(p_sku text, p_preco numeric default 100) returns jsonb language sql as $$
  select jsonb_build_object('titulo','x','itens', jsonb_build_array(jsonb_build_object('sku',p_sku,'produto','P','preco',p_preco,'foto','https://x/f.jpg')))
$$;
grant execute on function public.t_pl(text, numeric) to authenticated;

-- publicar: só item disponível, 1 item, mesmo SKU, com preço
set role authenticated;
select catalogo_meta_publicar('M1', public.t_pl('M1'));
reset role;
insert into res select 'publicar cria listing_state whatsapp publicado', (select estado from listing_state where sku='M1' and canal='whatsapp')='publicado'
  and (select url_publica from listing_state where sku='M1' and canal='whatsapp')='/i/M1', null;
do $$ declare m text; begin
  begin perform catalogo_meta_publicar('M3', public.t_pl('M3')); exception when others then m := sqlerrm; end;
  insert into res values ('item vendido não publica', m like '%indisponível%', m); m := null;
  begin perform catalogo_meta_publicar('M2', public.t_pl('M1')); exception when others then m := sqlerrm; end;
  insert into res values ('payload com outro SKU recusado', m like '%payload inválido%', m); m := null;
  begin perform catalogo_meta_publicar('M2', public.t_pl('M2', 0)); exception when others then m := sqlerrm; end;
  insert into res values ('payload sem preço recusado', m like '%payload inválido%', m);
end $$;

-- anônimo: só vê o que está publicado; não enumera
set role anon;
insert into res select 'anon vê item publicado e disponível', (item_publico('M1')->>'disponivel')='true', null;
insert into res select 'anon não vê item não publicado (M2 existe, não publicado)', item_publico('M2') is null, null;
insert into res select 'anon não vê item inexistente', item_publico('ZZZ') is null, null;
insert into res select 'anon não lê o feed', not has_function_privilege('anon','catalogo_meta_feed()','execute'), null;
reset role;

-- disponibilidade ao vivo: reserva e venda derrubam a disponibilidade; liberar volta
insert into reservas (sku, canal, origem_tipo, origem_ref, expira_em) values ('M1','whatsapp','sacola','ORC-9', now()+interval '1 day');
set role anon;
insert into res select 'item reservado aparece indisponível', (item_publico('M1')->>'disponivel')='false', null;
reset role;
update reservas set status='LIBERADA' where sku='M1';
set role anon;
insert into res select 'liberar volta a disponível', (item_publico('M1')->>'disponivel')='true', null;
reset role;
update itens set status='VENDIDO' where sku='M1';
set role anon;
insert into res select 'item vendido continua na página como indisponível', (item_publico('M1')->>'disponivel')='false', null;
reset role;
insert into res select 'feed inclui vendido como indisponível', exists (select 1 from catalogo_meta_feed() where sku='M1' and not disponivel), null;

-- retirar: some da página e do feed
select catalogo_meta_retirar('M1');
set role anon;
insert into res select 'retirado some da página', item_publico('M1') is null, null;
reset role;
insert into res select 'retirado some do feed', not exists (select 1 from catalogo_meta_feed() where sku='M1'), null;
insert into res select 'authenticated não executa o feed', not has_function_privilege('authenticated','catalogo_meta_feed()','execute'), null;

select case when ok then 'PASS' else 'FAIL' end || ' | ' || teste || coalesce(' | ' || detalhe, '') from res;
