-- Conferência de caixas: chegada (ex.: em Belém) e carimbo de reconferência.
alter table public.caixas
  add column if not exists chegou_em     timestamptz,
  add column if not exists conferida_em  timestamptz,
  add column if not exists conferida_por text;

comment on column public.caixas.chegou_em     is 'Data de chegada da caixa (ex.: em Belém).';
comment on column public.caixas.conferida_em  is 'Quando a caixa foi reconferida.';
comment on column public.caixas.conferida_por is 'E-mail de quem reconferiu a caixa.';
