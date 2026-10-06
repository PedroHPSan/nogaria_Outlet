-- Issue #110 do programa de unificação (repo nogaria-supply-hub), Fase 0.
-- As views de painel e precificação rodavam com os privilégios do dono
-- (SECURITY DEFINER, linter ERROR 0010) e o papel `anon` tinha SELECT nelas:
-- qualquer pessoa com a chave pública do app lia custos, preços e
-- produtividade de todos os itens sem login. O app sempre consulta logado
-- (RLS `auth_full_*` libera `authenticated`), e as páginas públicas /c e /o
-- usam só as RPCs `catalogo_publico_visualizar` e `orcamento_publico`.
do $$
declare v text;
begin
  for v in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v' and c.relname like 'vw\_%'
  loop
    execute format('alter view public.%I set (security_invoker = on)', v);
    execute format('revoke all on public.%I from anon', v);
  end loop;
end $$;
