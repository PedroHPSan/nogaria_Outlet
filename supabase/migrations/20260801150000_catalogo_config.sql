-- Contato configurável + predefinições e histórico de catálogos (M6/M7 do plano).
-- NÃO APLICADA: precisa da aprovação de Pedro ou Bárbara. O app funciona sem ela
-- (usa EMPRESA como padrão e não persiste predefinições/histórico).
-- Sem leitura anônima: as páginas públicas usam o snapshot (payload) do catálogo.
create table if not exists empresa_config (
  chave text primary key,        -- whatsapp, instagram, site, email, telefone, endereco, horario
  valor text not null,
  atualizado_por text,
  atualizado_em timestamptz not null default now()
);
create table if not exists catalogo_predefinicoes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  spec jsonb not null,
  criado_por text,
  criado_em timestamptz not null default now()
);
create table if not exists catalogo_historico (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  formato text not null,         -- pdf | link | cards | texto | csv
  n_itens int not null default 0,
  spec jsonb,
  criado_por text,
  criado_em timestamptz not null default now()
);
create index if not exists idx_catalogo_historico_criado on catalogo_historico (criado_em desc);

alter table empresa_config enable row level security;
alter table catalogo_predefinicoes enable row level security;
alter table catalogo_historico enable row level security;
drop policy if exists auth_full_empresa_config on empresa_config;
create policy auth_full_empresa_config on empresa_config for all to authenticated using (true) with check (true);
drop policy if exists auth_full_catalogo_predefinicoes on catalogo_predefinicoes;
create policy auth_full_catalogo_predefinicoes on catalogo_predefinicoes for all to authenticated using (true) with check (true);
drop policy if exists auth_full_catalogo_historico on catalogo_historico;
create policy auth_full_catalogo_historico on catalogo_historico for all to authenticated using (true) with check (true);
