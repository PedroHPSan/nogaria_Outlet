-- Liga RLS na pricing_factor_embalagem (criada na Fase 3 sem RLS — ficou exposta ao
-- role anon, ao contrário das demais pricing_*). Espelha o padrão das irmãs:
-- uma policy ALL para o role `authenticated` (anon fica sem acesso; service_role ignora RLS).
alter table public.pricing_factor_embalagem enable row level security;
drop policy if exists auth_full_pricing_factor_embalagem on public.pricing_factor_embalagem;
create policy auth_full_pricing_factor_embalagem on public.pricing_factor_embalagem
  for all to authenticated using (true) with check (true);
