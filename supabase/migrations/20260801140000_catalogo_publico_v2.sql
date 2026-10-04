-- Link público v2 (F4 do plano): contador de aberturas. NÃO APLICADA: precisa da
-- aprovação de Pedro ou Bárbara. O app funciona sem ela (a contagem é best-effort).
-- O payload v2 (sku por card, contato) é jsonb: não exige alteração de schema.
alter table if exists catalogos_publicos add column if not exists visualizacoes int not null default 0;

-- Só incrementa e só no slug exato; não devolve dados e não amplia a leitura anônima.
create or replace function catalogo_publico_visualizar(p_slug text)
returns void language sql security definer set search_path = public as $$
  update catalogos_publicos set visualizacoes = visualizacoes + 1
  where slug = p_slug and expira_em > now();
$$;
revoke all on function catalogo_publico_visualizar(text) from public;
grant execute on function catalogo_publico_visualizar(text) to anon, authenticated;
