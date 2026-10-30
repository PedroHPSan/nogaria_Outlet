-- Venda paga em euros (transferência para a conta na Espanha): guarda o valor recebido em €,
-- a cotação EUR→BRL usada e quando foi obtida. `valor_vendido` (R$) segue sendo o equivalente
-- em reais (€ × cotação), usado no cálculo de lucro e nos relatórios existentes.
alter table public.itens
  add column if not exists valor_vendido_eur numeric(12,2),
  add column if not exists cotacao_eur_brl   numeric(10,4),
  add column if not exists cotacao_eur_em    timestamptz;

comment on column public.itens.valor_vendido_eur is 'Valor recebido em euros (venda internacional); NULL = venda em reais.';
comment on column public.itens.cotacao_eur_brl   is 'R$ por 1 € usado para converter valor_vendido_eur em valor_vendido.';
comment on column public.itens.cotacao_eur_em    is 'Momento em que a cotação foi obtida.';
