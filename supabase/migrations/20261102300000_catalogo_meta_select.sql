-- Corrige a publicação no catálogo: upload com upsert:true no bucket catalogo-meta falha com
-- "new row violates row-level security policy" porque o upsert do Storage exige também SELECT (só havia INSERT e UPDATE).
-- Bucket já é público de leitura (URL estável para a Meta); a policy só deixa o app logado enxergar os objetos do próprio bucket.
-- ⚠️ Aprovação (Pedro OU Bárbara) antes de aplicar em produção. Idempotente.
drop policy if exists auth_ver_catalogo_meta on storage.objects;
create policy auth_ver_catalogo_meta on storage.objects for select to authenticated using (bucket_id = 'catalogo-meta');

-- ROLLBACK (manual): drop policy if exists auth_ver_catalogo_meta on storage.objects;
