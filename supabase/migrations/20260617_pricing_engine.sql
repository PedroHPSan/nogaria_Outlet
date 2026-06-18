-- Migration: motor de precificação Nogária Outlet (alinhada ao schema real)
-- Deriva condição do campo itens.estado; grava nada (só lê). Idempotente.

create table if not exists pricing_config (key text primary key, valor numeric, valor_txt text, obs text);
create table if not exists pricing_factor_condicao (codigo text primary key, fator numeric not null, ancora text not null check (ancora in ('NOVO','USADO')), obs text);
create table if not exists pricing_factor_risco (nivel text primary key, fator numeric not null, obs text);
create table if not exists pricing_canal (codigo text primary key, take_rate numeric not null, fixo numeric not null default 0, obs text);
create table if not exists pricing_grupo (grupo text primary key, nivel_risco text not null default 'MEDIO', ancora_novo numeric, ancora_usado numeric, classe text);
create table if not exists pricing_lote_custo (lote integer primary key, custo_total numeric not null);
alter table itens add column if not exists preco_ref_novo numeric;
alter table itens add column if not exists preco_ref_usado numeric;
alter table itens add column if not exists preco_ref_fonte text;
alter table itens add column if not exists preco_ref_confianca text;

insert into pricing_config (key,valor,valor_txt,obs) values
 ('margem_sp',0.30,null,'Margem mínima líquida SP/ML'),
 ('margem_belem',0.50,null,'Margem mínima envio Belém'),
 ('reserva',0.05,null,'Reserva de devolução (% receita)'),
 ('embalagem',25,null,'Embalagem média por item (R$)'),
 ('frete_kg',3.0,null,'Frete marketplace por kg (R$)'),
 ('frete_min',15,null,'Frete marketplace mínimo (R$)'),
 ('conv_novo_usado',0.60,null,'Usado = novo x fator quando falta âncora usado'),
 ('condicao_padrao',null,'USADO_OK','Condição quando estado vazio')
on conflict (key) do update set valor=excluded.valor,valor_txt=excluded.valor_txt,obs=excluded.obs;

insert into pricing_factor_condicao (codigo,fator,ancora,obs) values
 ('NOVO_LACRADO',0.80,'NOVO','estado=Novo — 70-85% do menor novo'),
 ('NOVO_CAIXA_AVARIADA',0.70,'NOVO','novo caixa avariada'),
 ('USADO_OK',0.92,'USADO','estado=Usado funcionando'),
 ('AVARIA_ESTETICA',0.75,'USADO','estado=Avariado'),
 ('SEM_TESTE',0.55,'USADO','estado=Usado sem teste / Incompleto'),
 ('DEFEITO_PECAS',0.20,'USADO','estado=Sucata — peças')
on conflict (codigo) do update set fator=excluded.fator,ancora=excluded.ancora,obs=excluded.obs;

insert into pricing_factor_risco (nivel,fator,obs) values
 ('BAIXO',0.95,'Passivo/sem eletrônica'),('MEDIO',0.90,'Eletrônico simples'),('ALTO',0.85,'Eletrônico complexo/bateria')
on conflict (nivel) do update set fator=excluded.fator,obs=excluded.obs;

insert into pricing_canal (codigo,take_rate,fixo,obs) values
 ('ML',0.14,6.75,'Clássico 11-14%; custo/un <R$79 (03/2026)'),
 ('SHOPEE',0.14,20,'R$100-199:14%+R$16; <R$80:20%+R$4'),
 ('TIKTOK',0.06,2,'6%+R$2/item <R$79; isenção 60d'),
 ('MAGALU',0.16,0,'10-20% por categoria'),
 ('AMAZON',0.13,2,'9-15% por categoria'),
 ('B2B',0.05,0,'lote/atacado'),
 ('LOCAL',0.00,0,'OLX/Facebook 0% vendedor')
on conflict (codigo) do update set take_rate=excluded.take_rate,fixo=excluded.fixo,obs=excluded.obs;

insert into pricing_grupo (grupo,nivel_risco,ancora_novo,ancora_usado,classe) values
 ('Acessórios celular/info','None',80,null,'C'),
 ('Acessórios piscina','None',250,null,'B'),
 ('Air fryer/Fritadeira','None',400,220.0,'B'),
 ('Alimentos/Bebidas','None',60,null,'C'),
 ('Ar-condicionado','None',1700,null,'A'),
 ('Aspirador','None',350,192.5,'B'),
 ('Autopeças','None',220,90,'B'),
 ('Balanças','None',180,null,'B'),
 ('Bebedouro/Purificador','None',600,null,'A'),
 ('Beleza/Cuidados pessoais','None',150,null,'B'),
 ('Bicicleta','None',700,385.0,'D'),
 ('Brinquedos/Infantil','None',120,null,'C'),
 ('Cadeira escritório/gamer','None',700,385.0,'D'),
 ('Caixa de som','None',250,137.5,'B'),
 ('Calçados','None',130,null,'C'),
 ('Cama/Mesa/Banho','None',120,null,'C'),
 ('Camping/Tático','None',150,null,'B'),
 ('Carregadores/Acessórios eletrônicos','None',90,null,'C'),
 ('Climatizador','None',550,null,'A'),
 ('Coifa/Depurador','None',600,null,'B'),
 ('Colchão inflável','None',250,null,'B'),
 ('Compressor de ar','None',800,null,'A'),
 ('Computador/All-in-One','None',2200,1300,'A+'),
 ('Cooktop','None',550,302.5,'A'),
 ('Cosméticos/Perfumaria','None',80,null,'C'),
 ('Câmeras/Segurança','None',300,165.0,'A'),
 ('Decoração/Festas','None',90,null,'C'),
 ('Diversos (não classificado)','None',120,null,'C'),
 ('Eletroportáteis cozinha','None',200,null,'B'),
 ('Equip. médico/odonto','None',1200,null,'A+'),
 ('Escada','None',400,null,'D'),
 ('Esporte','None',120,null,'C'),
 ('Ferramentas','None',350,180,'A'),
 ('Fones de ouvido','None',100,null,'C'),
 ('Forno elétrico','None',450,247.5,'B'),
 ('Gabinete PC','None',300,165.0,'B'),
 ('Hidráulica/Torneiras','None',180,null,'B'),
 ('Iluminação/Elétrica','None',120,null,'C'),
 ('Impressora','None',450,247.5,'A'),
 ('Industrial/Equipamentos','None',900,495.0,'A+'),
 ('Infantil volumoso','None',500,null,'D'),
 ('Inversor solar','None',900,null,'A'),
 ('Lavadora alta pressão','None',550,null,'A'),
 ('Limpeza elétrica','None',250,null,'B'),
 ('Limpeza/Embalagens','None',60,null,'C'),
 ('Livros/Papelaria','None',70,null,'C'),
 ('Material construção/Fixação','None',90,null,'C'),
 ('Micro-ondas','None',600,330.0,'A'),
 ('Monitor','None',700,380,'A'),
 ('Moto/Capacetes','None',300,165.0,'B'),
 ('Máquina de gelo','None',1100,null,'A'),
 ('Móveis','None',450,247.5,'D'),
 ('Notebook','None',2800,1700,'A+'),
 ('Organização','None',120,null,'C'),
 ('Patinete elétrico','None',1800,1200,'A+'),
 ('Periféricos informática','None',300,165.0,'B'),
 ('Pesca','None',150,null,'B'),
 ('Pet','None',100,null,'C'),
 ('Piscina','None',900,null,'D'),
 ('Projetor','None',500,275.0,'A'),
 ('Redes/Telecom','None',400,220.0,'A'),
 ('Refrigeração','None',1500,null,'D'),
 ('Relógios/Joias/Óculos','None',350,null,'A'),
 ('Robô aspirador','None',1500,700,'A+'),
 ('Segurança/Automação','None',200,null,'B'),
 ('Smartphone','None',1300,1700,'A+'),
 ('Suplementos','None',80,null,'C'),
 ('Utensílios cozinha/mesa','None',100,null,'C'),
 ('Ventilador','None',180,null,'B'),
 ('Vestuário','None',90,null,'C'),
 ('Áudio profissional','None',700,385.0,'A')
on conflict (grupo) do update set nivel_risco=excluded.nivel_risco,ancora_novo=excluded.ancora_novo,ancora_usado=excluded.ancora_usado,classe=excluded.classe;

insert into pricing_lote_custo (lote,custo_total) values
 (3,1622.14),
 (12,2189.14),
 (42,1175.89),
 (43,891.35),
 (52,1081.39),
 (68,1068.8),
 (69,1066.69),
 (71,809.45),
 (82,609.95),
 (83,1453.1),
 (89,1198.99),
 (90,1137.05),
 (91,889.25),
 (92,1443.64),
 (93,640.39),
 (95,827.29),
 (96,907.1),
 (100,10663.69),
 (103,16539.49),
 (105,2074.7),
 (110,4398.35),
 (111,11721.05),
 (112,8173.1),
 (116,10128.19),
 (119,12588.34),
 (120,10433.75),
 (121,3282.2),
 (122,8331.65),
 (123,12156.8),
 (125,13761.19)
on conflict (lote) do update set custo_total=excluded.custo_total;

create or replace view vw_precificacao as
with cfg as (
  select max(valor) filter (where key='margem_sp') as margem_sp,
         max(valor) filter (where key='margem_belem') as margem_belem,
         max(valor) filter (where key='reserva') as reserva,
         max(valor) filter (where key='embalagem') as embalagem,
         max(valor) filter (where key='frete_kg') as frete_kg,
         max(valor) filter (where key='frete_min') as frete_min,
         max(valor) filter (where key='conv_novo_usado') as conv,
         max(valor_txt) filter (where key='condicao_padrao') as cond_padrao
  from pricing_config
),
resolved as (
  select i.sku, i.lote, i.produto, i.grupo, i.canal_principal, i.destino,
    case i.estado
      when 'Novo' then 'NOVO_LACRADO'
      when 'Usado funcionando' then 'USADO_OK'
      when 'Usado sem teste' then 'SEM_TESTE'
      when 'Avariado' then 'AVARIA_ESTETICA'
      when 'Incompleto' then 'SEM_TESTE'
      when 'Sucata' then 'DEFEITO_PECAS'
      else cfg.cond_padrao end as cond_cod,
    case
      when i.canal_principal ilike '%shopee%' then 'SHOPEE'
      when i.canal_principal ilike '%mercado livre%' then 'ML'
      when i.canal_principal ilike '%tiktok%' then 'TIKTOK'
      when i.canal_principal ilike '%magalu%' then 'MAGALU'
      when i.canal_principal ilike '%amazon%' then 'AMAZON'
      when i.canal_principal ilike '%b2b%' then 'B2B'
      when i.canal_principal ilike '%olx%' or i.canal_principal ilike '%facebook%' or i.canal_principal ilike '%local%' then 'LOCAL'
      else 'ML' end as canal_cod,
    coalesce(i.preco_ref_novo, g.ancora_novo, i.preco_novo_est) as ref_novo,
    coalesce(i.preco_ref_usado, g.ancora_usado, coalesce(i.preco_ref_novo,g.ancora_novo,i.preco_novo_est)*cfg.conv) as ref_usado,
    coalesce(g.nivel_risco,'MEDIO') as nivel_risco,
    coalesce(i.peso_real_kg, i.peso_kg, 0) as peso,
    cfg.margem_sp,cfg.margem_belem,cfg.reserva,cfg.embalagem,cfg.frete_kg,cfg.frete_min,
    i.preco_ref_confianca
  from itens i cross join cfg left join pricing_grupo g on g.grupo=i.grupo
),
priced as (
  select r.*, c.fator as f_cond, c.ancora, rk.fator as f_risco,
    case when c.ancora='NOVO' then r.ref_novo else r.ref_usado end as ref_eff,
    cn.take_rate, cn.fixo,
    case when r.destino ilike '%belem%' or r.destino ilike '%belém%' then r.margem_belem else r.margem_sp end as margem_min
  from resolved r
  left join pricing_factor_condicao c on c.codigo=r.cond_cod
  left join pricing_factor_risco rk on rk.nivel=r.nivel_risco
  left join pricing_canal cn on cn.codigo=r.canal_cod
),
anun as (select p.*, round(coalesce(ref_eff,0)*coalesce(f_cond,0.55)*coalesce(f_risco,0.9),2) as p_anuncio from priced p),
rateio as (
  select a.*, sum(p_anuncio) over (partition by lote) as soma_base_lote,
    case when a.canal_cod in ('LOCAL','B2B') then 0 else round(greatest(a.frete_min,a.peso*a.frete_kg),2) end as frete
  from anun a
)
select r.sku,r.lote,r.produto,r.grupo,r.canal_cod,r.destino,r.cond_cod,r.ancora,r.nivel_risco,
  r.f_cond,r.f_risco,r.ref_novo,r.ref_usado,r.ref_eff,r.preco_ref_confianca,r.p_anuncio,
  round(coalesce(lc.custo_total,0)*r.p_anuncio/nullif(r.soma_base_lote,0),2) as custo_proporcional,
  r.frete,r.take_rate,r.fixo,r.margem_min,
  round((round(coalesce(lc.custo_total,0)*r.p_anuncio/nullif(r.soma_base_lote,0),2)+r.frete+r.embalagem+r.fixo)/nullif(1-r.take_rate-r.reserva-r.margem_min,0),2) as p_piso,
  round(r.p_anuncio-round(coalesce(lc.custo_total,0)*r.p_anuncio/nullif(r.soma_base_lote,0),2)-r.frete-r.embalagem-r.fixo-r.p_anuncio*(r.take_rate+r.reserva),2) as lucro_liquido,
  case when r.p_anuncio>0 then round((r.p_anuncio-round(coalesce(lc.custo_total,0)*r.p_anuncio/nullif(r.soma_base_lote,0),2)-r.frete-r.embalagem-r.fixo-r.p_anuncio*(r.take_rate+r.reserva))/r.p_anuncio,4) else 0 end as margem_liquida,
  (r.p_anuncio >= round((round(coalesce(lc.custo_total,0)*r.p_anuncio/nullif(r.soma_base_lote,0),2)+r.frete+r.embalagem+r.fixo)/nullif(1-r.take_rate-r.reserva-r.margem_min,0),2)) as viavel
from rateio r left join pricing_lote_custo lc on lc.lote=r.lote;
