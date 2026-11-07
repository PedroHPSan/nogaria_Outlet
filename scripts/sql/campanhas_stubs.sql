-- Stubs do que as migrations de campanhas esperam de migrations anteriores (que não reaplicam do zero).
alter table itens add column if not exists grupo text, add column if not exists lote integer;
create table canais (codigo text primary key, nome text not null);
insert into canais values ('whatsapp','Grupo WhatsApp'),('instagram','Instagram'),('direto','Venda direta');
create table pricing_grupo (grupo text primary key, macro text not null default 'Diversos');
insert into pricing_grupo values ('Vestuário','Moda e Acessórios'),('Calçados','Calçados'),('Ferramentas','Ferramentas e Construção');
create or replace function public.catalogo_categoria(p_grupo text)
returns table (grupo text, macro text) language sql stable security definer set search_path = public as $$
  select coalesce(g.grupo, 'Diversos (não classificado)'), coalesce(g.macro, 'Diversos')
    from (select 1) _ left join pricing_grupo g on lower(g.grupo) = lower(trim(coalesce(p_grupo, ''))) $$;
-- F3: catálogo publicado e disponibilidade (stubs de 20261102170000 / 20261102310000)
create table listing_state (sku text, canal text, estado text, payload jsonb, primary key (sku, canal));
create function item_disponivel(p_sku text) returns boolean language sql stable as
  $$ select coalesce((select status::text not in ('VENDIDO','ENTREGUE','DESCARTE') from itens where sku = p_sku), false) $$;
create function canal_ativo(p_canal text) returns boolean language sql stable as $$ select true $$;
-- F4: colunas/funções que o feed e a /i usam
alter table itens add column if not exists titulo_anuncio text, add column if not exists tamanho text;
create function catalogo_elegibilidade(p_sku text) returns table (motivos text[]) language sql stable as $$ select array[]::text[] $$;
