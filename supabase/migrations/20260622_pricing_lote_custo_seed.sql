-- Seed dos custos de arremate (custo_total) dos lotes que faltavam em
-- pricing_lote_custo. Complementa o seed inicial em 20260617_pricing_engine.sql,
-- para que um rebuild do banco do zero traga o breakeven correto destes lotes.
-- Valores informados pela operação (aquisição em R$). Idempotente.
insert into pricing_lote_custo (lote, custo_total) values
 (1, 1035.45),
 (7, 2507.35),
 (74, 1776.55),
 (75, 2110.45),
 (1000, 0.00)  -- lote extra, sem custo de aquisição
on conflict (lote) do update set custo_total = excluded.custo_total;
