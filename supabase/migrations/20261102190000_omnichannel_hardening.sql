-- Endurecimento pós-aplicação (advisors do Supabase em 2026-11-02): funções de trigger não são RPC e
-- usuario_atual precisa de search_path fixo. Aprovação de schema: Pedro, 2026-11-02. Idempotente.
revoke all on function public.reservas_projetar() from public, anon, authenticated;
revoke all on function public.itens_vendido_instagram() from public, anon, authenticated;
alter function public.usuario_atual() set search_path = pg_catalog;
