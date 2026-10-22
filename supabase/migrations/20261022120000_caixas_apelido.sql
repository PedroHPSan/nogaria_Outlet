-- Apelido (designação) da caixa/mala, ex.: "Material de construção", "Artigos de cozinha".
alter table public.caixas add column if not exists apelido text;
comment on column public.caixas.apelido is 'Designação livre para achar a caixa (ex.: Material de construção).';
