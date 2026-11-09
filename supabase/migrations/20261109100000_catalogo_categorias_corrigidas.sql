-- Catálogo Meta: listas coerentes com o nome. Corrige o mapeamento grupo → macro e reclassifica peças soltas
-- SÓ para o catálogo (itens.grupo, que alimenta o preço, não muda). Aditivo: id/link/product_type do feed ficam iguais.

-- 1) Duas macros novas (viram Product Sets na Meta: custom_label_3 = automotivo | livros-e-papelaria).
update public.pricing_grupo set macro = 'Automotivo' where grupo in ('Autopeças', 'Moto/Capacetes');
update public.pricing_grupo set macro = 'Livros e Papelaria' where grupo = 'Livros/Papelaria';
update public.pricing_grupo set macro = 'Casa e Decoração' where grupo = 'Lavadora alta pressão';

-- 2) Correção por peça (catálogo apenas): sku → grupo oficial.
create table if not exists public.catalogo_categoria_override (
  sku text primary key,
  grupo text not null references public.pricing_grupo(grupo),
  motivo text not null default 'auditoria 2026-11-09',
  criado_em timestamptz not null default now()
);
alter table public.catalogo_categoria_override enable row level security;
revoke all on public.catalogo_categoria_override from anon, authenticated;
grant select, insert, update, delete on public.catalogo_categoria_override to service_role;

insert into public.catalogo_categoria_override (sku, grupo)
select distinct on (i.sku) i.sku, v.grupo
  from public.itens i
  join (values
    -- Livros/Papelaria que são embalagem/festa
    ('%Lacre Fecha Sacola%','Limpeza/Embalagens'), ('%Caixa Embalagem Caixinha%','Limpeza/Embalagens'), ('%Ribbon Prata%','Limpeza/Embalagens'),
    ('%Forminhas Doces%','Decoração/Festas'), ('%Kit 200 Sachê Cola%','Livros/Papelaria'),
    -- Bolsas, mochilas e malas (estavam em Organização)
    ('%bolsa emília%','Vestuário'), ('%Bolsa Feminina%','Vestuário'), ('%Mochila Executiva%','Vestuário'), ('%mochila feminina%','Vestuário'),
    ('%Mini Bag%','Vestuário'), ('%Mala de Viagem%','Vestuário'),
    ('%Mochila Escolar%','Livros/Papelaria'), ('%Mochila Grande Capricho%','Livros/Papelaria'), ('%mochila capricho%','Livros/Papelaria'),
    ('%Mochila De Hidratação%','Esporte'),
    ('%Bolsa Maternidade%','Brinquedos/Infantil'), ('%Mala De Bebe%','Brinquedos/Infantil'),
    ('%Armário aéreo cozinha%','Móveis'), ('%Bandeja decorativa%','Decoração/Festas'),
    -- Cama/Mesa/Banho
    ('%Tchau Bosta%','Limpeza/Embalagens'), ('%Escolinha Livro+Tapete%','Brinquedos/Infantil'), ('%Kit Naninha%','Brinquedos/Infantil'),
    -- Acessórios celular/info
    ('%LAMP LED BULBO%','Iluminação/Elétrica'), ('%Display L 10X15%','Organização'),
    -- Beleza/Cuidados
    ('%Balizadores Spot LED%','Iluminação/Elétrica'), ('%Kit 2 Body%','Vestuário'), ('%Seringa 10Ml%','Equip. médico/odonto'),
    -- Brinquedos / eletrônicos trocados
    ('%Volante Logitech%','Periféricos informática'), ('%Carrinho Fusca Táxi%','Brinquedos/Infantil'),
    ('%Fita Led Chata%','Iluminação/Elétrica'), ('%Mini Fonte Agua Mesa Cascata%','Decoração/Festas'),
    -- Descartáveis de mesa
    ('%Canudo%','Utensílios cozinha/mesa'), ('%Bandeja De Papelão%','Utensílios cozinha/mesa'), ('%Palito Espetinho%','Utensílios cozinha/mesa'),
    -- Iluminação decorativa e natalina
    ('%Luminária%','Decoração/Festas'), ('%Luz Noturna%','Decoração/Festas'), ('%Fio Pendente%','Decoração/Festas'), ('%projetor natalino%','Decoração/Festas'),
    -- Diversos que têm lugar certo
    ('%Avental%','Utensílios cozinha/mesa'), ('%Braceletes Em Couro%','Relógios/Joias/Óculos'), ('%Caixa Correio%','Material construção/Fixação'),
    ('%Tapo C200%','Câmeras/Segurança'), ('%Caminhão De Bombeiro%','Brinquedos/Infantil'), ('%Cd Dio%','Livros/Papelaria'),
    ('%Cuecas Boxer%','Vestuário'), ('%Eco Casca De Pneu%','Decoração/Festas'), ('%Escultura Imagem%','Decoração/Festas'), ('%estátua escultura%','Decoração/Festas'),
    ('%Espátula De Aço%','Ferramentas'), ('%Fita Crepe Azul%','Ferramentas'), ('%Suta Carpinteiro%','Ferramentas'),
    ('%Garrafa Inoxidável Térmica%','Utensílios cozinha/mesa'), ('%Placas Sorria%','Decoração/Festas'), ('%Espalhadores Fogão%','Utensílios cozinha/mesa'),
    ('%PUXADOR ALÇA NYLON%','Material construção/Fixação'), ('%Bomba Manual De Sucção%','Organização'), ('%MEDIDOR DE PRESSÃO INTELLI%','Equip. médico/odonto'),
    ('%PORTA GARRAFA SPATEN%','Utensílios cozinha/mesa'), ('%Saca Areia Praia%','Esporte'), ('%Seringa De Insulina%','Equip. médico/odonto'),
    ('%Silhouette Lâmina%','Livros/Papelaria'),
    -- Ferramentas / construção
    ('%Lixadeira de Unhas%','Beleza/Cuidados pessoais'), ('%Sincronismo Dos Motores%','Autopeças'), ('%Valvula Descarga Deca%','Hidráulica/Torneiras'),
    ('%Mini Escovinhas Manicure%','Beleza/Cuidados pessoais'), ('%Narigueira Alta%','Moto/Capacetes'), ('%Pestline Reator%','Iluminação/Elétrica'),
    ('%Interruptor De Parede Duplo%','Iluminação/Elétrica'), ('%Vela Com Carvão Ativado%','Bebedouro/Purificador'),
    ('%Bomba Pressurizadora%','Hidráulica/Torneiras'), ('%TFT LCD COLOR MONITOR%','Monitor'),
    -- Pet, saúde e utilidades soltas
    ('%Petisco Mastigável%','Pet'), ('%Peitoral Colete%','Pet'), ('%Banqueta Dobrável%','Móveis'), ('%Cinta Airbag%','Autopeças'),
    ('%Creatina Monohidratada Vitamax%','Suplementos'), ('%Fita Adesiva Durex%','Limpeza/Embalagens'), ('%Suporte De Chão Para Vasos%','Decoração/Festas'),
    ('%Filtro Papel Branco Compatível Hario%','Utensílios cozinha/mesa'), ('%Sensor Porta Janela Inteligente%','Segurança/Automação')
  ) as v(pat, grupo) on i.produto ilike v.pat or i.titulo_anuncio ilike v.pat
 order by i.sku, v.grupo
on conflict (sku) do nothing;

-- 3) Feed e painel passam a usar a correção por peça (se houver) antes do grupo do item.
create or replace function public.catalogo_meta_feed()
returns table (sku text, payload jsonb, disponivel boolean)
language sql stable security definer set search_path = public as $$
  select l.sku,
         case when jsonb_typeof(l.payload->'itens') = 'array' then
           jsonb_set(
             jsonb_set(
               case when i.preco_ideal > 0
                    then jsonb_set(jsonb_set(l.payload, '{itens,0,preco}', to_jsonb(i.preco_ideal)),
                                   '{itens,0,produto}', to_jsonb(coalesce(nullif(trim(i.titulo_anuncio), ''), i.produto, l.sku)))
                    else l.payload end,
               '{itens,0,rotulos}',
               (case when i.preco_ideal > 0
                     then jsonb_build_object('grupo', i.grupo, 'lote', i.lote, 'tamanho', i.tamanho, 'estado', i.estado::text)
                     else coalesce(l.payload #> '{itens,0,rotulos}', '{}'::jsonb) end)
               || jsonb_build_object('macro', c.macro, 'grupo_norm', c.grupo)),
             '{itens,0,promo}',
             case when pr.pct > 0 then jsonb_build_object(
                    'preco', least(campanha_arredondar(pr.cheio * (1 - pr.pct / 100), pr.arred), pr.cheio),
                    'preco_cheio', pr.cheio,
                    'ativa', now() >= pr.inicio_em,
                    'janela', to_char(pr.inicio_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') || '-03:00/'
                              || to_char(pr.fim_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') || '-03:00')
                  else 'null'::jsonb end)
         else l.payload end,
         canal_ativo('whatsapp') and coalesce(e.motivos <@ array['preco_nao_validado'], false)
    from listing_state l
    left join itens i on i.sku = l.sku
    cross join lateral catalogo_categoria(coalesce((select o.grupo from public.catalogo_categoria_override o where o.sku = l.sku), i.grupo)) c
    left join lateral (select x.motivos from catalogo_elegibilidade(l.sku) x) e on true
    left join lateral (
      select ci.preco_cheio as cheio, ci.desconto_pct as pct, k.inicio_em, k.fim_em, k.arredondamento as arred
        from campanha_itens ci join campanhas k on k.id = ci.campanha_id
       where ci.sku = l.sku and ci.canal in ('whatsapp', '*') and k.status = 'PUBLICADA' and k.fim_em > now()
       order by k.inicio_em, (ci.canal = 'whatsapp') desc
       limit 1) pr on true
   where l.canal = 'whatsapp' and l.estado = 'publicado' order by l.sku;
$$;
revoke all on function public.catalogo_meta_feed() from public, anon, authenticated;
grant execute on function public.catalogo_meta_feed() to service_role;

create or replace function public.catalogo_diversos()
returns table (sku text, produto text, grupo text)
language sql stable security definer set search_path = public as $$
  select l.sku, i.produto, i.grupo
    from listing_state l
    join itens i on i.sku = l.sku
    cross join lateral catalogo_categoria(coalesce((select o.grupo from public.catalogo_categoria_override o where o.sku = l.sku), i.grupo)) c
   where l.canal = 'whatsapp' and l.estado = 'publicado' and c.macro = 'Diversos'
   order by l.sku;
$$;
revoke all on function public.catalogo_diversos() from public, anon;
grant execute on function public.catalogo_diversos() to authenticated, service_role;

-- ROLLBACK (manual): recriar catalogo_meta_feed de 20261107170000_campanha_superficies.sql e catalogo_diversos de 20261106100000;
-- drop table public.catalogo_categoria_override; update pricing_grupo set macro='Ferramentas e Construção' where grupo in ('Autopeças','Moto/Capacetes');
-- update pricing_grupo set macro='Infantil, Esporte e Lazer' where grupo='Livros/Papelaria'; update pricing_grupo set macro='Cozinha e Eletrodomésticos' where grupo='Lavadora alta pressão'.
