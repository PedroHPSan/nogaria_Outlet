-- Cota por usuário da Edge Function buscar-imagens (busca Google + proxy de download).
-- Janela fixa de 1 hora; só a service_role (a função) consome.
create table if not exists public.buscar_imagens_uso (
  user_id uuid not null,
  acao    text not null check (acao in ('buscar', 'baixar')),
  janela  timestamptz not null,
  qtd     integer not null default 0,
  primary key (user_id, acao, janela)
);
alter table public.buscar_imagens_uso enable row level security; -- sem policies: só service_role

-- Incrementa e devolve true se ainda está dentro do limite da janela atual.
create or replace function public.consumir_cota_busca(p_user uuid, p_acao text, p_limite integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_janela timestamptz := date_trunc('hour', now());
  v_qtd integer;
begin
  insert into buscar_imagens_uso (user_id, acao, janela, qtd)
  values (p_user, p_acao, v_janela, 1)
  on conflict (user_id, acao, janela) do update set qtd = buscar_imagens_uso.qtd + 1
  returning qtd into v_qtd;
  delete from buscar_imagens_uso where janela < now() - interval '1 day';
  return v_qtd <= p_limite;
end;
$$;

revoke all on function public.consumir_cota_busca(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.consumir_cota_busca(uuid, text, integer) to service_role;
