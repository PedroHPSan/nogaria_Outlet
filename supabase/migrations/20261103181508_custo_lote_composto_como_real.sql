-- (#134) Arquivo versionado a partir do que JÁ está aplicado em produção (supabase_migrations.schema_migrations,
-- versão 20261103181508, nome custo_lote_composto_como_real). Conteúdo idêntico ao do banco; não reaplicar.
-- Custo REAL do lote = custo_composto (lance + comissão + taxa de arrematação + fretes). pricing_lote_custo (fonte de
-- vw_lote_resultado / vw_precificacao) usava lance×1,05 e subestimava o custo. Só lotes legados (custo_origem is null)
-- com composto calculado; os lotes 'composto' já são mantidos por trigger. Backup para rollback.
create table if not exists pricing_lote_custo_bkp_20261103 as table pricing_lote_custo;
update pricing_lote_custo p
   set custo_total = l.custo_composto
  from lotes l
 where l.lote = p.lote and l.custo_composto is not null and l.custo_origem is null
   and p.custo_total is distinct from l.custo_composto;
update lotes set custo_total = custo_composto where custo_composto is not null and custo_origem is null and custo_total is distinct from custo_composto;
-- Rollback: update pricing_lote_custo p set custo_total = b.custo_total from pricing_lote_custo_bkp_20261103 b where b.lote = p.lote;
