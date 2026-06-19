-- Controle de vias de impressão de etiquetas.
-- O "ticket impresso" e o número de vias são derivados da tabela `eventos`
-- (acao = 'etiqueta:impressa'). Esta migration apenas acelera a consulta de
-- vias por SKU usada nas telas de itens/detalhe/impressão. Idempotente.
create index if not exists idx_eventos_sku_acao on eventos (sku, acao);
