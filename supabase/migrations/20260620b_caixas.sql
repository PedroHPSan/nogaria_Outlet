-- Caixas (2ª etapa): encaixotamento unificado. A caixa vira entidade de primeira
-- classe (código auto-gerado, destino/local únicos, status aberta/fechada,
-- rastreabilidade). O item aponta para a caixa via itens.caixa_id; ao encaixotar,
-- herda destino/local da caixa (snapshot — mantém o pricing por destino, que lê
-- itens.destino). O texto livre legado itens.caixa_num permanece para dados antigos.
create table if not exists caixas (
  codigo       text primary key,                -- 'CX-001' | 'MALA-001' (auto-gerado)
  tipo         text not null default 'CAIXA',   -- 'CAIXA' | 'MALA'
  destino      text,                            -- Belém / SP storage / Venda local SP / A definir
  local_fisico text,
  referencia   text,
  status       text not null default 'ABERTA',  -- 'ABERTA' | 'FECHADA'
  criado_por   text,
  criado_em    timestamptz not null default now(),
  fechada_por  text,
  fechada_em   timestamptz
);

alter table itens
  add column if not exists caixa_id text references caixas(codigo) on update cascade on delete set null;
create index if not exists idx_itens_caixa on itens (caixa_id);

-- RLS espelhando o padrão das demais tabelas (auth_full_<tabela>: authenticated, ALL, true/true).
alter table caixas enable row level security;
drop policy if exists auth_full_caixas on caixas;
create policy auth_full_caixas on caixas for all to authenticated using (true) with check (true);
