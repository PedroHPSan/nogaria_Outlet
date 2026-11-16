-- Permissionamento de vendas: só gestores (hoje Bárbara e Valentina) TROCAM o preço de venda depois do cadastro
-- inicial e CANCELAM separação (tirar item da sacola, cancelar sacola/orçamento com reserva, liberar reserva do bot).
-- ⚠️ Aprovação de schema (Pedro OU Bárbara) antes de aplicar em produção. Idempotente. Rollback no fim (comentado).
--
-- A trava é no banco (a RLS `auth_full_*` deixa qualquer login gravar direto pela API). Vale para chamadas feitas
-- com o JWT de um usuário (papel authenticated/anon), inclusive dentro de RPCs SECURITY DEFINER (liberar_reserva):
-- por isso olha o papel do JWT, não o current_user. service_role (edge functions, bot), crons e migrations passam.
-- Gestores ficam numa tabela sem escrita pela API: incluir/remover alguém = SQL pelo painel/MCP.

create table if not exists public.gestores_venda (
  email text primary key check (email = lower(email)),
  nome text,
  criado_em timestamptz not null default now()
);
alter table public.gestores_venda enable row level security;
drop policy if exists gestores_venda_leitura on public.gestores_venda;
create policy gestores_venda_leitura on public.gestores_venda for select to authenticated using (true);
revoke insert, update, delete on public.gestores_venda from anon, authenticated;

insert into public.gestores_venda (email, nome) values
  ('barbaranogueira@nogaria.com.br', 'Bárbara'),
  ('financeiro@nogaria.com.br', 'Valentina')
on conflict (email) do nothing;

-- true = quem chama pode trocar preço / cancelar separação. Sem JWT de usuário (service_role, cron, migration) = true.
create or replace function public.pode_gerir_venda() returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') not in ('authenticated', 'anon') then true
    else exists (select 1 from gestores_venda
                  where email = lower(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'))
  end
$$;
revoke all on function public.pode_gerir_venda() from public;
grant execute on function public.pode_gerir_venda() to anon, authenticated, service_role;

-- 1) Preço de venda (itens.preco_ideal): o primeiro preço (vazio/zero → valor) é livre; trocar um preço já definido, só gestor.
create or replace function public.itens_guarda_preco() returns trigger
language plpgsql as $$
begin
  if coalesce(old.preco_ideal, 0) > 0 and new.preco_ideal is distinct from old.preco_ideal and not public.pode_gerir_venda() then
    raise exception '%: só Bárbara e Valentina podem alterar o preço de venda depois do cadastro.', old.sku using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_itens_guarda_preco on public.itens;
create trigger trg_itens_guarda_preco before update of preco_ideal on public.itens
  for each row execute function public.itens_guarda_preco();

-- 2) Separação: lista do que NÃO-gestor pode fazer numa reserva (o resto é recusado), para não haver atalho que
--    derrube a separação (LIBERADA, EXPIRADA antes da hora, prazo encurtado, trocar de dono, apagar):
--    · ATIVA → CONFIRMADA (venda) · ATIVA → EXPIRADA só se o prazo já passou (reservas_expirar)
--    · mudar o prazo só para o futuro (renovar/re-separar) · trocar de dono só bot/interesse → sacola (N8)
--    · nunca apagar, nunca mudar o SKU, nunca sair de um status final.
create or replace function public.reservas_guarda_liberacao() returns trigger
language plpgsql as $$
declare v_ok boolean := true;
begin
  if public.pode_gerir_venda() then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'DELETE' then
    v_ok := false;
  else
    if new.sku is distinct from old.sku then v_ok := false; end if;
    if new.status is distinct from old.status and not (
         old.status = 'ATIVA' and (new.status = 'CONFIRMADA' or (new.status = 'EXPIRADA' and old.expira_em <= now()))) then
      v_ok := false;
    end if;
    if new.status = 'ATIVA' and new.expira_em is distinct from old.expira_em and new.expira_em <= now() then v_ok := false; end if;
    if (new.origem_tipo, new.origem_ref) is distinct from (old.origem_tipo, old.origem_ref)
       and not (old.status = 'ATIVA' and old.origem_tipo in ('carrinho_wa', 'interesse') and new.origem_tipo = 'sacola') then
      v_ok := false;
    end if;
  end if;
  if not v_ok then
    raise exception '%: só Bárbara e Valentina podem cancelar a separação do item.', old.sku using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists trg_reservas_guarda_liberacao on public.reservas;
create trigger trg_reservas_guarda_liberacao before update or delete on public.reservas
  for each row execute function public.reservas_guarda_liberacao();

-- 3) Cancelar sacola/orçamento que ainda segura reserva ATIVA, só gestor (o app muda o status antes de liberar).
create or replace function public.orcamentos_guarda_cancelamento() returns trigger
language plpgsql as $$
begin
  if new.status = 'CANCELADO' and old.status is distinct from 'CANCELADO' and not public.pode_gerir_venda()
     and exists (select 1 from reservas r where r.status = 'ATIVA' and r.origem_ref = old.codigo) then
    raise exception '%: só Bárbara e Valentina podem cancelar a separação.', old.codigo using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_orcamentos_guarda_cancelamento on public.orcamentos;
create trigger trg_orcamentos_guarda_cancelamento before update of status on public.orcamentos
  for each row execute function public.orcamentos_guarda_cancelamento();

-- ROLLBACK (manual):
-- drop trigger if exists trg_itens_guarda_preco on public.itens;
-- drop trigger if exists trg_reservas_guarda_liberacao on public.reservas;
-- drop trigger if exists trg_orcamentos_guarda_cancelamento on public.orcamentos;
-- drop function if exists public.itens_guarda_preco(), public.reservas_guarda_liberacao(), public.orcamentos_guarda_cancelamento();
-- drop function if exists public.pode_gerir_venda();
-- drop table if exists public.gestores_venda;
