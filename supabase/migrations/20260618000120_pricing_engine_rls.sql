-- Hardening do motor de precificação: habilita RLS nas tabelas pricing_* (config de
-- preços não pode ficar aberta à anon key) e faz a view respeitar a RLS do consultante.
-- Política espelha o padrão do projeto (auth_full_*): acesso total p/ autenticados.

alter table pricing_config        enable row level security;
alter table pricing_factor_condicao enable row level security;
alter table pricing_factor_risco  enable row level security;
alter table pricing_canal         enable row level security;
alter table pricing_grupo         enable row level security;
alter table pricing_lote_custo    enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'pricing_config','pricing_factor_condicao','pricing_factor_risco',
    'pricing_canal','pricing_grupo','pricing_lote_custo'
  ] loop
    execute format('drop policy if exists auth_full_%1$s on public.%1$I', t);
    execute format(
      'create policy auth_full_%1$s on public.%1$I for all to authenticated using (true) with check (true)', t);
  end loop;
end$$;

-- A view passa a rodar como o usuário que consulta (respeita RLS de itens/pricing_*),
-- limpando o lint security_definer_view. O app sempre consulta autenticado.
alter view vw_precificacao set (security_invoker = on);
