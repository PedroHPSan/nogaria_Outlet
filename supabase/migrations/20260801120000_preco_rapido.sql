-- Preço rápido (F2 do plano-catalogo-pdf-venda-assistida): desconto por tempo parado.
-- NÃO APLICADA: precisa da aprovação de Pedro ou Bárbara antes do `db push`.
-- O app funciona sem esta migration (usa faixas padrão e `criado_em`/`created_at`
-- quando existirem); ela só torna as faixas editáveis e grava a data de entrada.
create table if not exists pricing_markdown_idade (
  id       serial primary key,
  dias_min int  not null check (dias_min >= 0),
  dias_max int,                                  -- null = sem teto
  pct      numeric not null check (pct >= 0 and pct <= 90),
  check (dias_max is null or dias_max >= dias_min)
);
insert into pricing_markdown_idade (dias_min, dias_max, pct)
select * from (values (0, 30, 0), (31, 60, 10), (61, 90, 20), (91, null::int, 30)) v(a, b, c)
where not exists (select 1 from pricing_markdown_idade);

alter table pricing_markdown_idade enable row level security;
drop policy if exists auth_full_pricing_markdown_idade on pricing_markdown_idade;
create policy auth_full_pricing_markdown_idade on pricing_markdown_idade for all to authenticated using (true) with check (true);

-- Carimbo da 1ª vez que o item ficou vendável + trilha de aprovação de preço.
alter table itens add column if not exists disponivel_desde timestamptz;
alter table itens add column if not exists preco_aprovacao text
  check (preco_aprovacao in ('PENDENTE', 'APROVADO', 'REJEITADO'));
alter table itens add column if not exists preco_aprovacao_motivo text;

-- Backfill: 1º evento de status PRONTO/ANUNCIADO de cada item (se houver).
update itens i set disponivel_desde = e.primeiro
from (
  select sku, min(ts) as primeiro
  from eventos
  where acao in ('status:PRONTO', 'status:ANUNCIADO')
  group by sku
) e
where e.sku = i.sku and i.disponivel_desde is null;
