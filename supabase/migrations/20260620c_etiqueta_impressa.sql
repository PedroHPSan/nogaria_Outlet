-- Flag denormalizado p/ filtrar "triados sem etiqueta" (impressão em massa).
-- A contagem de vias continua sendo derivada de `eventos` (acao 'etiqueta:impressa',
-- ver printLog.js) — esta coluna é só um atalho booleano para filtrar no servidor
-- (com paginação/contagem), no mesmo padrão de medidas_fonte/caixa_id. É marcada
-- true ao registrar a 1ª impressão da etiqueta do item.
alter table itens add column if not exists etiqueta_impressa boolean not null default false;

-- Backfill: itens que já têm ao menos uma via impressa no histórico.
update itens i set etiqueta_impressa = true
where exists (select 1 from eventos e where e.sku = i.sku and e.acao = 'etiqueta:impressa');
