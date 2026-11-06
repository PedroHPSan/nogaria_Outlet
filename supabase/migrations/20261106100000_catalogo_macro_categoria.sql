-- Catálogo Meta: macro-categoria + grupo normalizado para montar Product Sets por categoria.
-- Aditivo: itens.grupo e as colunas já enviadas ao feed (id, link, product_type, custom_label_0..2) não mudam.

alter table public.pricing_grupo add column if not exists macro text not null default 'Diversos';

update public.pricing_grupo p set macro = m.macro
  from (values
    ('Vestuário','Moda e Acessórios'),('Relógios/Joias/Óculos','Moda e Acessórios'),
    ('Calçados','Calçados'),
    ('Beleza/Cuidados pessoais','Beleza e Saúde'),('Cosméticos/Perfumaria','Beleza e Saúde'),('Suplementos','Beleza e Saúde'),('Equip. médico/odonto','Beleza e Saúde'),
    ('Decoração/Festas','Casa e Decoração'),('Cama/Mesa/Banho','Casa e Decoração'),('Móveis','Casa e Decoração'),('Cadeira escritório/gamer','Casa e Decoração'),
    ('Organização','Casa e Decoração'),('Limpeza/Embalagens','Casa e Decoração'),('Pet','Casa e Decoração'),
    ('Air fryer/Fritadeira','Cozinha e Eletrodomésticos'),('Eletroportáteis cozinha','Cozinha e Eletrodomésticos'),('Forno elétrico','Cozinha e Eletrodomésticos'),
    ('Micro-ondas','Cozinha e Eletrodomésticos'),('Cooktop','Cozinha e Eletrodomésticos'),('Coifa/Depurador','Cozinha e Eletrodomésticos'),
    ('Utensílios cozinha/mesa','Cozinha e Eletrodomésticos'),('Alimentos/Bebidas','Cozinha e Eletrodomésticos'),('Balanças','Cozinha e Eletrodomésticos'),
    ('Bebedouro/Purificador','Cozinha e Eletrodomésticos'),('Máquina de gelo','Cozinha e Eletrodomésticos'),('Refrigeração','Cozinha e Eletrodomésticos'),
    ('Aspirador','Cozinha e Eletrodomésticos'),('Robô aspirador','Cozinha e Eletrodomésticos'),('Limpeza elétrica','Cozinha e Eletrodomésticos'),
    ('Lavadora alta pressão','Cozinha e Eletrodomésticos'),('Ventilador','Cozinha e Eletrodomésticos'),('Climatizador','Cozinha e Eletrodomésticos'),
    ('Ar-condicionado','Cozinha e Eletrodomésticos'),
    ('Acessórios celular/info','Eletrônicos e Informática'),('Carregadores/Acessórios eletrônicos','Eletrônicos e Informática'),('Caixa de som','Eletrônicos e Informática'),
    ('Fones de ouvido','Eletrônicos e Informática'),('Computador/All-in-One','Eletrônicos e Informática'),('Notebook','Eletrônicos e Informática'),
    ('Monitor','Eletrônicos e Informática'),('Impressora','Eletrônicos e Informática'),('Gabinete PC','Eletrônicos e Informática'),
    ('Periféricos informática','Eletrônicos e Informática'),('Projetor','Eletrônicos e Informática'),('Redes/Telecom','Eletrônicos e Informática'),
    ('Smartphone','Eletrônicos e Informática'),('Câmeras/Segurança','Eletrônicos e Informática'),('Áudio profissional','Eletrônicos e Informática'),
    ('Segurança/Automação','Eletrônicos e Informática'),('Inversor solar','Eletrônicos e Informática'),
    ('Ferramentas','Ferramentas e Construção'),('Material construção/Fixação','Ferramentas e Construção'),('Hidráulica/Torneiras','Ferramentas e Construção'),
    ('Iluminação/Elétrica','Ferramentas e Construção'),('Compressor de ar','Ferramentas e Construção'),('Escada','Ferramentas e Construção'),
    ('Autopeças','Ferramentas e Construção'),('Moto/Capacetes','Ferramentas e Construção'),('Industrial/Equipamentos','Ferramentas e Construção'),
    ('Brinquedos/Infantil','Infantil, Esporte e Lazer'),('Infantil volumoso','Infantil, Esporte e Lazer'),('Esporte','Infantil, Esporte e Lazer'),
    ('Bicicleta','Infantil, Esporte e Lazer'),('Patinete elétrico','Infantil, Esporte e Lazer'),('Camping/Tático','Infantil, Esporte e Lazer'),
    ('Pesca','Infantil, Esporte e Lazer'),('Piscina','Infantil, Esporte e Lazer'),('Acessórios piscina','Infantil, Esporte e Lazer'),
    ('Colchão inflável','Infantil, Esporte e Lazer'),('Livros/Papelaria','Infantil, Esporte e Lazer')
  ) as m(grupo, macro)
 where p.grupo = m.grupo;

-- Valores sujos já vistos em itens.grupo → grupo oficial (chave em minúsculas/trim).
create table if not exists public.catalogo_grupo_alias (
  alias text primary key,
  grupo text not null references public.pricing_grupo(grupo)
);
alter table public.catalogo_grupo_alias enable row level security;

insert into public.catalogo_grupo_alias (alias, grupo) values
  ('loja de roupas', 'Vestuário'), ('loja de roupa', 'Vestuário'),
  ('automotivo', 'Autopeças'),
  ('casa', 'Decoração/Festas'),
  ('colecionáveis', 'Decoração/Festas')
on conflict (alias) do update set grupo = excluded.grupo;

-- Resolve o texto livre de itens.grupo para (grupo oficial, macro). Sem correspondência → Diversos.
create or replace function public.catalogo_categoria(p_grupo text)
returns table (grupo text, macro text)
language sql stable security definer set search_path = public as $$
  select coalesce(p.grupo, 'Diversos (não classificado)'), coalesce(p.macro, 'Diversos')
    from (select 1) _
    left join lateral (
      select g.grupo, g.macro from pricing_grupo g
       where lower(trim(g.grupo)) = lower(trim(coalesce(p_grupo, '')))
          or g.grupo = (select a.grupo from catalogo_grupo_alias a where a.alias = lower(trim(coalesce(p_grupo, ''))))
       limit 1
    ) p on true;
$$;
revoke all on function public.catalogo_categoria(text) from public, anon, authenticated;
grant execute on function public.catalogo_categoria(text) to service_role;

-- Feed: mesmas colunas/valores de antes; rotulos ganha macro + grupo_norm (sempre, mesmo sem preco_ideal).
create or replace function public.catalogo_meta_feed()
returns table (sku text, payload jsonb, disponivel boolean)
language sql stable security definer set search_path = public as $$
  select l.sku,
         case when jsonb_typeof(l.payload->'itens') = 'array' then
           jsonb_set(
             case when i.preco_ideal > 0
                  then jsonb_set(jsonb_set(l.payload, '{itens,0,preco}', to_jsonb(i.preco_ideal)),
                                 '{itens,0,produto}', to_jsonb(coalesce(nullif(trim(i.titulo_anuncio), ''), i.produto, l.sku)))
                  else l.payload end,
             '{itens,0,rotulos}',
             (case when i.preco_ideal > 0
                   then jsonb_build_object('grupo', i.grupo, 'lote', i.lote, 'tamanho', i.tamanho, 'estado', i.estado::text)
                   else coalesce(l.payload #> '{itens,0,rotulos}', '{}'::jsonb) end)
             || jsonb_build_object('macro', c.macro, 'grupo_norm', c.grupo))
         else l.payload end,
         canal_ativo('whatsapp') and coalesce(e.motivos <@ array['preco_nao_validado'], false)
    from listing_state l
    left join itens i on i.sku = l.sku
    cross join lateral catalogo_categoria(i.grupo) c
    left join lateral (select x.motivos from catalogo_elegibilidade(l.sku) x) e on true
   where l.canal = 'whatsapp' and l.estado = 'publicado' order by l.sku;
$$;
revoke all on function public.catalogo_meta_feed() from public, anon, authenticated;
grant execute on function public.catalogo_meta_feed() to service_role;

-- Painel do catálogo: peças publicadas que ainda caem em "Diversos" (grupo vazio/desconhecido) para a categoria ser corrigida.
create or replace function public.catalogo_diversos()
returns table (sku text, produto text, grupo text)
language sql stable security definer set search_path = public as $$
  select l.sku, i.produto, i.grupo
    from listing_state l
    join itens i on i.sku = l.sku
    cross join lateral catalogo_categoria(i.grupo) c
   where l.canal = 'whatsapp' and l.estado = 'publicado' and c.macro = 'Diversos'
   order by l.sku;
$$;
revoke all on function public.catalogo_diversos() from public, anon;
grant execute on function public.catalogo_diversos() to authenticated, service_role;

-- ROLLBACK (manual): recriar catalogo_meta_feed de 20261102310000_interruptor_canal.sql;
-- drop function public.catalogo_diversos(); drop function public.catalogo_categoria(text); drop table public.catalogo_grupo_alias; alter table public.pricing_grupo drop column macro.
