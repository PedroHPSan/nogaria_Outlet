-- Sacolas de venda pelo WhatsApp: reaproveita `orcamentos` como "sacola do cliente".
-- Aplicada em produção em 2026-10-28 (aprovação de Pedro).
-- Fluxo: ABERTA (itens reservados) → VENDIDO (pago) → ENTREGUE. ABERTA → CANCELADO/EXPIRADO.
alter table orcamentos drop constraint if exists orcamentos_status_check;
alter table orcamentos add constraint orcamentos_status_check
  check (status in ('RASCUNHO','ENVIADO','RESERVADO','ABERTA','VENDIDO','ENTREGUE','CANCELADO','EXPIRADO'));

alter table orcamentos add column if not exists origem text not null default 'orcamento'
  check (origem in ('orcamento','whatsapp'));
alter table orcamentos add column if not exists pago_em timestamptz;
alter table orcamentos add column if not exists forma_pagamento text;
alter table orcamentos add column if not exists valor_pago numeric;
alter table orcamentos add column if not exists entregue_em timestamptz;
create index if not exists idx_orcamentos_origem on orcamentos (origem, status, criado_em desc);

-- Link público do grupo: item reservado (sacola ativa) também some como disponível.
create or replace function oferta_indisponiveis(p_slug text)
returns setof text language sql stable security definer set search_path = public as $$
  select i.sku
  from catalogos_publicos c
  cross join lateral jsonb_array_elements(case when jsonb_typeof(c.payload->'itens') = 'array' then c.payload->'itens' else '[]'::jsonb end) e
  join itens i on i.sku = e->>'sku'
  where c.slug = p_slug and c.expira_em > now()
    and (i.status in ('VENDIDO', 'ENTREGUE') or i.reservado_ate > now())
$$;
revoke all on function oferta_indisponiveis(text) from public;
grant execute on function oferta_indisponiveis(text) to anon, authenticated;
