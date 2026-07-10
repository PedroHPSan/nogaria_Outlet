-- Snapshot durável da última análise da IA por item (transparência/posterioridade).
alter table public.itens
  add column if not exists ia_analise jsonb;

comment on column public.itens.ia_analise is
  'Última análise do assistente de IA: { em, por, usou_foto, confianca, observacoes, campos_faltantes, sugestoes:[{k,label,val,patch}], aplicados:[k] }.';
