-- Salas: local físico estruturado que substitui o texto livre local_fisico.
-- A sala é entidade de 1ª classe (código auto-gerado, nome, RLS, eventos,
-- etiqueta com QR), irmã da tabela `caixas`. Caixas e itens apontam para a sala
-- via sala_id. Item encaixotado herda a sala da caixa (snapshot propagado);
-- item solto recebe sala direto. local_fisico permanece como histórico.
create table if not exists salas (
  codigo     text primary key,               -- 'SALA-001' (auto-gerado)
  nome       text not null,                  -- descritivo, ex.: 'Galpão A'
  observacao text,
  ativa      boolean not null default true,  -- esconder do dropdown sem apagar
  criado_por text,
  criado_em  timestamptz not null default now()
);

alter table caixas add column if not exists sala_id text
  references salas(codigo) on update cascade on delete set null;
alter table itens  add column if not exists sala_id text
  references salas(codigo) on update cascade on delete set null;
create index if not exists idx_caixas_sala on caixas (sala_id);
create index if not exists idx_itens_sala  on itens  (sala_id);

-- RLS espelhando o padrão (auth_full_<tabela>: authenticated, ALL, true/true).
alter table salas enable row level security;
drop policy if exists auth_full_salas on salas;
create policy auth_full_salas on salas for all to authenticated using (true) with check (true);
