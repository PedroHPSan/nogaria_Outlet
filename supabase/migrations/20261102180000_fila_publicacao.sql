-- Fila de publicação com aprovação (issues #77 E5-2, #57 F2, #69 E2-1). Depende das migrations omnichannel, catalogo_meta.
-- Aprovação de schema: Pedro, 2026-11-02. Aplicar em produção só após o merge (migrations → functions → vercel).
-- Idempotente. Rollback no fim (comentado).

-- Mídias do Instagram: JPEG em bucket público (a API do Instagram busca a imagem por URL).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ig-media', 'ig-media', true, 2097152, array['image/jpeg'])
on conflict (id) do nothing;
drop policy if exists auth_subir_ig_media on storage.objects;
create policy auth_subir_ig_media on storage.objects for insert to authenticated with check (bucket_id = 'ig-media');

-- Token do Instagram (Business Login): singleton, SEM policy (só service_role / Edge Function).
create table if not exists public.instagram_oauth (
  id            integer primary key default 1 check (id = 1),
  ig_user_id    text,
  access_token  text,
  expires_at    timestamptz,
  updated_at    timestamptz not null default now()
);
alter table public.instagram_oauth enable row level security;

-- Regras por canal (canais.config): criador pode aprovar o próprio post? comenta VENDIDO sozinho?
update public.canais set config = config || '{"aprovacao_propria": true, "comentar_vendido": true}'::jsonb
 where codigo = 'instagram' and not (config ? 'aprovacao_propria');

create table if not exists public.fila_publicacao (
  id             uuid primary key default gen_random_uuid(),
  canal          text not null references public.canais(codigo),
  tipo           text not null check (tipo in ('feed','carrossel','story')),
  skus           text[] not null default '{}',
  payload        jsonb not null,                     -- { legenda, midias: [url jpeg...] }
  status         text not null default 'rascunho'
                 check (status in ('rascunho','aprovado','agendado','publicando','publicado','erro','cancelado','esgotado')),
  agendado_para  timestamptz,
  criado_por     text,
  aprovado_por   text,
  aprovado_em    timestamptz,
  container_id   text,                               -- retomada: não recria o container já criado
  external_id    text,                               -- id da mídia no canal (ig_media_id)
  publicado_em   timestamptz,
  erro           text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index if not exists idx_fila_pub_status on public.fila_publicacao (status, criado_em desc);
create index if not exists idx_fila_pub_agendadas on public.fila_publicacao (agendado_para) where status = 'agendado';
alter table public.fila_publicacao enable row level security;
drop policy if exists fila_publicacao_ler on public.fila_publicacao;
create policy fila_publicacao_ler on public.fila_publicacao for select to authenticated using (true);
-- escrita só pelas RPCs abaixo (SECURITY DEFINER) e pelo worker (service_role)

create or replace function public.usuario_atual() returns text language sql stable as $$
  select coalesce(nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email', ''), 'sistema')
$$;

-- Cria o rascunho (mídias já enviadas ao bucket ig-media).
create or replace function public.publicacao_criar(
  p_canal text, p_tipo text, p_skus text[], p_payload jsonb, p_agendado_para timestamptz default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; n integer;
begin
  if p_canal <> 'instagram' or not exists (select 1 from canais where codigo = p_canal and ativo) then
    raise exception 'canal sem publicação automática: %', p_canal; end if;  -- demais canais entram com os épicos E3/E4
  if p_tipo not in ('feed','carrossel','story') then raise exception 'tipo inválido'; end if;
  if jsonb_typeof(p_payload->'midias') <> 'array' then raise exception 'payload sem mídias'; end if;
  n := jsonb_array_length(p_payload->'midias');
  if n < 1 or n > 10 or (p_tipo <> 'carrossel' and n <> 1) or (p_tipo = 'carrossel' and n < 2) then
    raise exception 'quantidade de mídias inválida para %', p_tipo; end if;
  -- só imagens enviadas ao bucket público ig-media (caminho <uuid>/<arquivo>.jpg, sem query string); o worker
  -- ainda confere o host contra SUPABASE_URL. O bucket só aceita INSERT (sem update/delete): conteúdo imutável.
  if exists (select 1 from jsonb_array_elements_text(p_payload->'midias') u
              where u !~ '^https?://[A-Za-z0-9.:-]+/storage/v1/object/public/ig-media/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]+\.jpe?g$'
                 or u like '%..%') then
    raise exception 'mídias devem ser JPEGs do bucket ig-media'; end if;
  if length(coalesce(p_payload->>'legenda', '')) > 2200 then raise exception 'legenda acima de 2.200 caracteres'; end if;
  if exists (select 1 from unnest(p_skus) s where not exists (select 1 from itens where sku = s)) then
    raise exception 'SKU inexistente'; end if;
  insert into fila_publicacao (canal, tipo, skus, payload, agendado_para, criado_por)
  values (p_canal, p_tipo, p_skus, p_payload, p_agendado_para, usuario_atual()) returning id into v_id;
  return v_id;
end $$;

-- Define (ou limpa) o horário de um rascunho antes de aprovar.
create or replace function public.publicacao_agendar(p_id uuid, p_quando timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_quando is not null and p_quando < now() - interval '1 minute' then raise exception 'horário no passado'; end if;
  update fila_publicacao set agendado_para = p_quando, atualizado_em = now() where id = p_id and status = 'rascunho';
  if not found then raise exception 'só rascunho pode ser agendado'; end if;
end $$;
revoke all on function public.publicacao_agendar(uuid, timestamptz) from public, anon;
grant execute on function public.publicacao_agendar(uuid, timestamptz) to authenticated, service_role;

-- Aprova: publica já (enfileira o job) ou deixa agendado. Revalida estoque; aplica a regra de aprovação própria.
create or replace function public.publicacao_aprovar(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare p fila_publicacao%rowtype; v_user text := usuario_atual(); v_proprio boolean; s text; v_novo text;
begin
  select * into p from fila_publicacao where id = p_id for update;
  if not found then raise exception 'publicação não encontrada'; end if;
  if p.status <> 'rascunho' then raise exception 'só rascunho pode ser aprovado (status: %)', p.status; end if;
  select coalesce((config->>'aprovacao_propria')::boolean, true) into v_proprio from canais where codigo = p.canal;
  if not v_proprio and p.criado_por = v_user then raise exception 'outra pessoa precisa aprovar esta publicação'; end if;
  foreach s in array p.skus loop
    if not item_disponivel(s) then raise exception '%: indisponível (vendido ou reservado)', s; end if;
  end loop;
  v_novo := case when p.agendado_para is not null and p.agendado_para > now() then 'agendado' else 'aprovado' end;
  update fila_publicacao set status = v_novo, aprovado_por = v_user, aprovado_em = now(), erro = null, atualizado_em = now() where id = p_id;
  if v_novo = 'aprovado' then perform enfileirar_job('ig.publicar', jsonb_build_object('publicacao_id', p_id), 'pub:' || p_id); end if;
  return v_novo;
end $$;

create or replace function public.publicacao_cancelar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update fila_publicacao set status = 'cancelado', atualizado_em = now()
   where id = p_id and status in ('rascunho','aprovado','agendado','erro');
  if not found then raise exception 'esta publicação não pode ser cancelada'; end if;
end $$;

-- Tentar de novo uma publicação com erro (reabre o job morto).
create or replace function public.publicacao_reenfileirar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update fila_publicacao set status = 'aprovado', erro = null, atualizado_em = now() where id = p_id and status = 'erro';
  if not found then raise exception 'só publicação com erro pode ser reenviada'; end if;
  update integracao_jobs set status = 'pendente', tentativas = 0, erro = null, proximo_em = now(), atualizado_em = now()
   where idem_key = 'pub:' || p_id;
end $$;

-- Cron: agendadas vencidas viram 'aprovado' + job. Devolve quantas.
create or replace function public.publicacoes_enfileirar_vencidas() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select id from fila_publicacao where status = 'agendado' and agendado_para <= now() for update skip locked loop
    update fila_publicacao set status = 'aprovado', atualizado_em = now() where id = r.id;
    perform enfileirar_job('ig.publicar', jsonb_build_object('publicacao_id', r.id), 'pub:' || r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.publicacao_criar(text, text, text[], jsonb, timestamptz) from public, anon;
revoke all on function public.publicacao_aprovar(uuid) from public, anon;
revoke all on function public.publicacao_cancelar(uuid) from public, anon;
revoke all on function public.publicacao_reenfileirar(uuid) from public, anon;
revoke all on function public.publicacoes_enfileirar_vencidas() from public, anon, authenticated;
grant execute on function public.publicacao_criar(text, text, text[], jsonb, timestamptz) to authenticated, service_role;
grant execute on function public.publicacao_aprovar(uuid) to authenticated, service_role;
grant execute on function public.publicacao_cancelar(uuid) to authenticated, service_role;
grant execute on function public.publicacao_reenfileirar(uuid) to authenticated, service_role;
grant execute on function public.publicacoes_enfileirar_vencidas() to service_role;

-- O cron também enfileira as agendadas vencidas ANTES de decidir se chama o worker.
create or replace function public.cron_chamar_worker() returns void
language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  perform publicacoes_enfileirar_vencidas();
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'sync_canais_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'sync_canais_secret';
  if v_url is null or v_secret is null then return; end if;
  if not exists (select 1 from integracao_jobs
                  where (status in ('pendente','erro') and proximo_em <= now())
                     or (status = 'rodando' and atualizado_em < now() - interval '10 minutes')) then
    return;
  end if;
  perform net.http_post(url := v_url, headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_secret),
                        body := '{}'::jsonb, timeout_milliseconds := 20000);
end $$;
revoke all on function public.cron_chamar_worker() from public, anon, authenticated;

-- E2-1: venda de item publicado no Instagram → comentário "VENDIDO" (a API não edita nem apaga post) e baixa da fila.
create or replace function public.itens_vendido_instagram() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; v_comenta boolean;
begin
  if new.status not in ('VENDIDO','ENTREGUE') or old.status in ('VENDIDO','ENTREGUE') then return new; end if;
  select coalesce((config->>'comentar_vendido')::boolean, true) into v_comenta from canais where codigo = 'instagram';
  if v_comenta then
    for r in select external_listing_id from listing_state
              where sku = new.sku and canal = 'instagram' and estado = 'publicado' and external_listing_id is not null loop
      perform enfileirar_job('ig.comentar_vendido', jsonb_build_object('sku', new.sku, 'media_id', r.external_listing_id),
                             'igv:' || new.sku || ':' || r.external_listing_id);
    end loop;
  end if;
  -- publicação cujos itens todos saíram do estoque fica 'esgotado'
  update fila_publicacao p set status = 'esgotado', atualizado_em = now()
   where p.canal = 'instagram' and p.status = 'publicado' and new.sku = any (p.skus)
     and not exists (select 1 from unnest(p.skus) k join itens i on i.sku = k
                      where i.status not in ('VENDIDO','ENTREGUE','DESCARTE'));
  return new;
end $$;
drop trigger if exists trg_itens_vendido_instagram on public.itens;
create trigger trg_itens_vendido_instagram after update of status on public.itens
  for each row execute function public.itens_vendido_instagram();

-- Renovação semanal do token (60 dias de validade): enfileira o job; o handler ignora se não há token.
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'omni-ig-refresh';
  perform cron.schedule('omni-ig-refresh', '0 9 * * 1',
    $c$select public.enfileirar_job('ig.refresh_token', '{}'::jsonb, 'igrefresh:' || to_char(now(), 'IYYY-IW'))$c$);
exception when others then
  raise notice 'pg_cron indisponível (%): renovação do token não agendada.', sqlerrm;
end $$;

-- ROLLBACK (manual):
-- drop trigger if exists trg_itens_vendido_instagram on public.itens; drop function if exists public.itens_vendido_instagram();
-- select cron.unschedule(jobid) from cron.job where jobname = 'omni-ig-refresh';
-- drop function if exists public.publicacoes_enfileirar_vencidas(); drop function if exists public.publicacao_reenfileirar(uuid);
-- drop function if exists public.publicacao_cancelar(uuid); drop function if exists public.publicacao_aprovar(uuid);
-- drop function if exists public.publicacao_agendar(uuid, timestamptz); drop function if exists public.publicacao_criar(text, text, text[], jsonb, timestamptz); drop function if exists public.usuario_atual();
-- drop table if exists public.fila_publicacao, public.instagram_oauth;
-- (restaurar cron_chamar_worker da migration 20261102140000 se necessário)
