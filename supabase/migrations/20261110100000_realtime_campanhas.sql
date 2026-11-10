-- Realtime para campanhas: tirar/pôr peça em campanha atualiza as telas abertas (App.jsx, canal "itens-realtime").
do $$
declare t text;
begin
  foreach t in array array['campanhas', 'campanha_itens'] loop
    if to_regclass('public.' || t) is not null
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ROLLBACK (manual): alter publication supabase_realtime drop table public.campanhas, public.campanha_itens;
