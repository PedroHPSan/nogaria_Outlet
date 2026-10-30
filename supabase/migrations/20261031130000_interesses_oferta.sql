-- Pedidos de interesse vindos da página pública /p/<slug> no modo euro.
-- O servidor calcula o valor (R$ base do snapshot da oferta × 1,20 ÷ cotação) e devolve um
-- código curto que o cliente envia no WhatsApp; a Nogária confere pelo código no app, sem
-- depender do texto (editável) da mensagem. Válido por 24 h a partir do pedido.
create table if not exists public.interesses (
  id         uuid primary key default gen_random_uuid(),
  codigo     text not null unique,
  slug       text not null,
  sku        text not null,
  lang       text not null default 'pt',
  brl_base   numeric(12,2) not null,
  eur        numeric(12,2) not null,
  taxa       numeric(10,4) not null,
  taxa_em    timestamptz,
  valido_ate timestamptz not null,
  status     text not null default 'ABERTO' check (status in ('ABERTO', 'ATENDIDO', 'DESCARTADO')),
  criado_em  timestamptz not null default now()
);
create index if not exists interesses_criado_idx on public.interesses (criado_em desc);
create index if not exists interesses_slug_idx on public.interesses (slug, criado_em desc);

alter table public.interesses enable row level security;
drop policy if exists interesses_ler on public.interesses;
create policy interesses_ler on public.interesses for select to authenticated using (true);
drop policy if exists interesses_atualizar on public.interesses;
create policy interesses_atualizar on public.interesses for update to authenticated using (true) with check (true);

-- Cotações EUR→BRL gravadas SOMENTE pela Edge Function `cotacao` (service role). Sem policy: ninguém
-- (anon/authenticated) lê ou escreve direto; a RPC abaixo lê com security definer.
create table if not exists public.cotacoes (
  id        bigint generated always as identity primary key,
  taxa      numeric(10,4) not null check (taxa > 0),
  em        timestamptz not null,
  fonte     text not null,
  criado_em timestamptz not null default now()
);
create index if not exists cotacoes_criado_idx on public.cotacoes (criado_em desc);
alter table public.cotacoes enable row level security;

-- RPC anônima: só aceita SKU que está na oferta vigente; preço do snapshot e cotação da tabela
-- `cotacoes` (nunca valores do cliente). Exige cotação de até 15 min e limita a 30 pedidos por
-- oferta em 10 min.
drop function if exists public.registrar_interesse(text, text, text, numeric, timestamptz);
create or replace function public.registrar_interesse(p_slug text, p_sku text, p_lang text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_preco numeric;
  v_brl numeric(12,2);
  v_eur numeric(12,2);
  v_codigo text;
  v_valido timestamptz := now() + interval '24 hours';
  v_taxa numeric(10,4);
  v_taxa_em timestamptz;
begin
  select taxa, em into v_taxa, v_taxa_em from cotacoes where criado_em > now() - interval '15 minutes' order by criado_em desc limit 1;
  if v_taxa is null then raise exception 'sem cotacao recente'; end if;
  select (e->>'preco')::numeric into v_preco
  from catalogos_publicos c
  cross join lateral jsonb_array_elements(case when jsonb_typeof(c.payload->'itens') = 'array' then c.payload->'itens' else '[]'::jsonb end) e
  where c.slug = p_slug and c.expira_em > now() and coalesce((c.payload->>'euro')::boolean, false) and e->>'sku' = p_sku;
  if v_preco is null or v_preco <= 0 then raise exception 'item indisponivel'; end if;
  if (select count(*) from interesses where slug = p_slug and criado_em > now() - interval '10 minutes') >= 30 then
    raise exception 'muitos pedidos';
  end if;
  v_brl := round(v_preco * 1.20, 2);
  v_eur := round(v_brl / v_taxa, 2);
  loop
    v_codigo := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 5));
    exit when not exists (select 1 from interesses where codigo = v_codigo);
  end loop;
  insert into interesses (codigo, slug, sku, lang, brl_base, eur, taxa, taxa_em, valido_ate)
  values (v_codigo, p_slug, p_sku, case when p_lang in ('pt', 'en', 'es') then p_lang else 'pt' end, v_preco, v_eur, v_taxa, v_taxa_em, v_valido);
  return jsonb_build_object('codigo', v_codigo, 'eur', v_eur, 'taxa', v_taxa, 'taxa_em', v_taxa_em, 'valido_ate', v_valido);
end $$;
revoke all on function public.registrar_interesse(text, text, text) from public;
grant execute on function public.registrar_interesse(text, text, text) to anon, authenticated;
