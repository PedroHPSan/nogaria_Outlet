-- Novos estados de triagem (tri_estado):
--   Novo · Embalagem aberta/avariada · Usado · Avariado · Usado sem teste
-- Renomeia 'Usado funcionando' -> 'Usado' (preserva linhas existentes) e adiciona
-- 'Embalagem aberta/avariada'. 'Incompleto' e 'Sucata' ficam órfãos no enum (fora da
-- UI). A view vw_precificacao é atualizada numa migração separada (o novo valor de
-- enum não pode ser usado na mesma transação em que é criado).
alter type tri_estado add value if not exists 'Embalagem aberta/avariada';

do $$
begin
  if exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'tri_estado' and e.enumlabel = 'Usado funcionando'
  ) then
    execute 'alter type tri_estado rename value ''Usado funcionando'' to ''Usado''';
  end if;
end $$;
