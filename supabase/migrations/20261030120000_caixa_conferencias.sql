-- Rodadas de conferência por caixa. Cada rodada guarda o resultado por item
-- (OK / FALTANDO / AVARIADO / SOBRANDO), independente de itens.conferido_em
-- (que continua sendo a conferência por lote). No máximo 1 rodada aberta por caixa.
create table if not exists caixa_conferencias (
  id bigserial primary key,
  caixa_id text not null references caixas(codigo) on update cascade on delete cascade,
  numero int not null,
  iniciada_em timestamptz not null default now(),
  iniciada_por text,
  concluida_em timestamptz,
  concluida_por text,
  total int, conferidos int, faltando int, avariados int, sobrando int,
  unique (caixa_id, numero)
);
create unique index if not exists uq_caixa_conferencia_aberta
  on caixa_conferencias (caixa_id) where concluida_em is null;

create table if not exists caixa_conferencia_itens (
  conferencia_id bigint not null references caixa_conferencias(id) on delete cascade,
  sku text not null,
  resultado text not null check (resultado in ('OK','FALTANDO','AVARIADO','SOBRANDO')),
  em timestamptz not null default now(),
  por text,
  primary key (conferencia_id, sku)
);

alter table caixa_conferencias enable row level security;
drop policy if exists auth_full_caixa_conferencias on caixa_conferencias;
create policy auth_full_caixa_conferencias on caixa_conferencias for all to authenticated using (true) with check (true);
alter table caixa_conferencia_itens enable row level security;
drop policy if exists auth_full_caixa_conferencia_itens on caixa_conferencia_itens;
create policy auth_full_caixa_conferencia_itens on caixa_conferencia_itens for all to authenticated using (true) with check (true);
