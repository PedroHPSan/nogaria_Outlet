-- Views de apoio ao Painel (Dashboard): ritmo de trabalho, produtividade da
-- equipe, resumo financeiro e caixas em aberto. Tudo derivado (sem novas
-- colunas) para o painel não precisar varrer `eventos`/`vw_precificacao` no
-- cliente. Datas em horário de São Paulo p/ "dia" bater com a operação.

-- 1) Throughput diário: quantos itens avançaram por dia (a partir de `eventos`).
--    `triados` = saídas de "A catalogar" (acao status:TRIADO) = ritmo de catalogação.
create or replace view vw_throughput_dia as
select
  (ts at time zone 'America/Sao_Paulo')::date as dia,
  count(*) filter (where acao = 'status:TRIADO')   as triados,
  count(*) filter (where acao like 'status:%')      as mudancas_status,
  count(*) filter (where acao like 'etiqueta:%')    as etiquetas,
  count(*) filter (where acao like 'medidas:%')     as medidas,
  count(*) filter (where acao like 'caixa:%')       as caixas,
  count(distinct usuario)                           as pessoas
from eventos
group by 1;

-- 2) Produtividade por pessoa e dia (para visão de equipe na última semana).
create or replace view vw_produtividade_dia as
select
  usuario,
  (ts at time zone 'America/Sao_Paulo')::date as dia,
  count(*) filter (where acao = 'status:TRIADO') as triados,
  count(*) filter (where acao like 'etiqueta:%') as etiquetas,
  count(*) filter (where acao like 'medidas:%')  as medidas,
  count(*) filter (where acao like 'caixa:%')    as caixas,
  count(*)                                        as total_acoes
from eventos
where usuario is not null
group by usuario, 2;

-- 3) Resumo financeiro do estoque catalogado e ainda não realizado. Junta
--    vw_precificacao com o status do item; ignora "A catalogar" (ainda sem
--    preço real, viabilidade não é confiável) e vendidos/entregues/descarte.
create or replace view vw_precificacao_resumo as
select
  count(*) filter (
    where v.viavel and i.status::text not in ('A_CATALOGAR','VENDIDO','ENTREGUE','DESCARTE')
  ) as n_viavel,
  count(*) filter (
    where not v.viavel and i.status::text not in ('A_CATALOGAR','VENDIDO','ENTREGUE','DESCARTE')
  ) as n_inviavel,
  coalesce(sum(v.lucro_liquido) filter (
    where v.viavel and i.status::text not in ('A_CATALOGAR','VENDIDO','ENTREGUE','DESCARTE')
  ), 0) as lucro_liquido_potencial,
  coalesce(sum(v.p_anuncio) filter (
    where i.status::text not in ('A_CATALOGAR','VENDIDO','ENTREGUE','DESCARTE')
  ), 0) as anuncio_potencial
from vw_precificacao v
join itens i on i.sku = v.sku;

-- 4) Caixas em aberto com a contagem de itens dentro (para não esquecer caixa aberta).
create or replace view vw_caixas_abertas as
select
  c.codigo, c.tipo, c.destino, c.local_fisico, c.referencia, c.criado_em,
  count(i.sku) as n_itens
from caixas c
left join itens i on i.caixa_id = c.codigo
where c.status = 'ABERTA'
group by c.codigo, c.tipo, c.destino, c.local_fisico, c.referencia, c.criado_em;
