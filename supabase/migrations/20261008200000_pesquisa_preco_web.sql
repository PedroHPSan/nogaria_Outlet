-- Pesquisa automática de preço na web (Edge Function pesquisa-preco-web).
-- Guarda cada pesquisa (mediana + anúncios com URL) para auditoria e cache.
-- NÃO altera itens: a sugestão só vira preço quando o operador aplica.
create table if not exists public.pesquisa_preco_web (
  id          bigint generated always as identity primary key,
  sku         text not null references public.itens(sku) on delete cascade,
  condicao    text not null check (condicao in ('NOVO', 'USADO')),
  mediana     numeric(12,2),
  n           integer not null default 0,
  preco_min   numeric(12,2),
  preco_max   numeric(12,2),
  confianca   text not null check (confianca in ('ALTA', 'MEDIA', 'BAIXA', 'NENHUMA')),
  anuncios    jsonb not null default '[]'::jsonb,   -- anúncios usados no cálculo
  descartados jsonb not null default '[]'::jsonb,   -- anúncios achados e descartados, com o motivo
  obs         text,
  modelo_ia   text,
  criado_por  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists pesquisa_preco_web_sku_idx on public.pesquisa_preco_web (sku, created_at desc);

alter table public.pesquisa_preco_web enable row level security;
-- leitura para usuários autenticados do app; escrita só via service_role (a função).
create policy pesquisa_preco_web_select on public.pesquisa_preco_web
  for select to authenticated using (true);
