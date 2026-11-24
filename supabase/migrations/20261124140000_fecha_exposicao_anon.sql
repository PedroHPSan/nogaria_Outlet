-- Fecha exposições encontradas no levantamento de acesso (2026-11-24): sem login (papel anon) lia/gravava
-- a tabela de backup de custos de lote (sem RLS) e a view de pedidos unificados tinha SELECT para anon.
-- Nada no app usa nenhum dos dois por anon. Idempotente.
-- ⚠️ Aprovação de schema (Pedro OU Bárbara) antes de aplicar em produção.
alter table if exists public.pricing_lote_custo_bkp_20261103 enable row level security;   -- sem policy = ninguém lê pela API
revoke all on public.pricing_lote_custo_bkp_20261103 from anon, authenticated;
alter view if exists public.vw_pedidos_unificados set (security_invoker = on);            -- respeita a RLS de quem consulta
revoke all on public.vw_pedidos_unificados from anon;
-- ROLLBACK: alter table public.pricing_lote_custo_bkp_20261103 disable row level security;
--           grant all on public.pricing_lote_custo_bkp_20261103 to anon, authenticated;
