-- Stubs do que as migrations de campanhas esperam de migrations anteriores (que não reaplicam do zero).
alter table itens add column if not exists grupo text, add column if not exists lote text;
create table canais (codigo text primary key, nome text not null);
insert into canais values ('whatsapp','Grupo WhatsApp'),('instagram','Instagram'),('direto','Venda direta');
create table pricing_grupo (grupo text primary key, macro text not null default 'Diversos');
insert into pricing_grupo values ('Vestuário','Moda e Acessórios'),('Calçados','Calçados'),('Ferramentas','Ferramentas e Construção');
create or replace function public.catalogo_categoria(p_grupo text)
returns table (grupo text, macro text) language sql stable security definer set search_path = public as $$
  select coalesce(g.grupo, 'Diversos (não classificado)'), coalesce(g.macro, 'Diversos')
    from (select 1) _ left join pricing_grupo g on lower(g.grupo) = lower(trim(coalesce(p_grupo, ''))) $$;
