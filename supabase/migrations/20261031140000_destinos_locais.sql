-- Destinos logísticos e locais de storage cadastráveis (antes fixos no código: Belém, SP storage,
-- Venda local SP, A definir). `internacional` marca os destinos cujo estoque vai para a base
-- internacional (Europa); `locais_storage` alimenta as sugestões do campo "Local físico".
-- itens.destino segue texto livre (sem FK): renomear/desativar não quebra itens existentes.
create table if not exists public.destinos (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null unique check (length(btrim(nome)) between 1 and 60),
  internacional boolean not null default false,
  pais          text,
  ativo         boolean not null default true,
  ordem         int not null default 100,
  criado_em     timestamptz not null default now()
);

create table if not exists public.locais_storage (
  id        uuid primary key default gen_random_uuid(),
  destino   text not null,
  nome      text not null check (length(btrim(nome)) between 1 and 60),
  ativo     boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (destino, nome)
);

insert into public.destinos (nome, ordem) values
  ('Belém', 10), ('SP storage', 20), ('Venda local SP', 30), ('A definir', 90)
on conflict (nome) do nothing;

alter table public.destinos enable row level security;
alter table public.locais_storage enable row level security;
do $$ declare t text; begin
  foreach t in array array['destinos', 'locais_storage'] loop
    execute format('drop policy if exists %I on public.%I', t || '_ler', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_ler', t);
    execute format('drop policy if exists %I on public.%I', t || '_inserir', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (true)', t || '_inserir', t);
    execute format('drop policy if exists %I on public.%I', t || '_atualizar', t);
    execute format('create policy %I on public.%I for update to authenticated using (true) with check (true)', t || '_atualizar', t);
  end loop;
end $$;
