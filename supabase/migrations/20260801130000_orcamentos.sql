-- Orçamentos persistidos + reserva leve (F3 do plano-catalogo-pdf-venda-assistida).
-- NÃO APLICADA: precisa da aprovação de Pedro ou Bárbara antes do `db push`.
-- Reserva NÃO entra no STATUS_FLOW dos itens: usa itens.reservado_ate (expira sozinha).
create table if not exists orcamentos (
  id               uuid primary key default gen_random_uuid(),
  codigo           text not null unique,                 -- 'ORC-0001'
  slug             text not null unique,                 -- página pública /o/<slug>
  status           text not null default 'RASCUNHO'
                   check (status in ('RASCUNHO','ENVIADO','RESERVADO','VENDIDO','CANCELADO','EXPIRADO')),
  itens            jsonb not null,                       -- [{sku, produto, preco, estado}] (snapshot)
  desconto_pct     numeric not null default 0 check (desconto_pct >= 0 and desconto_pct <= 90),
  total            numeric not null default 0,
  cliente_nome     text,
  cliente_whatsapp text,
  vendedor_nome    text,
  vendedor_whatsapp text,
  validade         timestamptz not null,
  criado_por       text,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create index if not exists idx_orcamentos_status on orcamentos (status, criado_em desc);

alter table orcamentos enable row level security;
drop policy if exists auth_full_orcamentos on orcamentos;
create policy auth_full_orcamentos on orcamentos for all to authenticated using (true) with check (true);
-- Página pública: SEM policy de leitura para anon (uma policy `using (status…)` deixaria
-- qualquer anônimo listar TODOS os orçamentos ativos, com nome/WhatsApp de clientes).
-- O acesso é por função SECURITY DEFINER que devolve UM orçamento, só pelo slug exato
-- e só os campos necessários à página (sem WhatsApp do cliente).
drop policy if exists anon_select_orcamentos on orcamentos;
create or replace function orcamento_publico(p_slug text)
returns table (codigo text, status text, itens jsonb, desconto_pct numeric, total numeric,
               validade timestamptz, cliente_nome text, vendedor_nome text, vendedor_whatsapp text)
language sql security definer set search_path = public as $$
  select o.codigo, o.status, o.itens, o.desconto_pct, o.total, o.validade,
         o.cliente_nome, o.vendedor_nome, o.vendedor_whatsapp
  from orcamentos o
  where o.slug = p_slug and o.status in ('ENVIADO','RESERVADO') and o.validade > now()
  limit 1;
$$;
revoke all on function orcamento_publico(text) from public;
grant execute on function orcamento_publico(text) to anon, authenticated;

alter table itens add column if not exists reservado_ate timestamptz;
alter table itens add column if not exists reservado_por_orc text;
create index if not exists idx_itens_reservado on itens (reservado_ate) where reservado_ate is not null;
