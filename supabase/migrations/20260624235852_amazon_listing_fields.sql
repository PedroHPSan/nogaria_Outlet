-- Fase 5 (ampliada) — campos de listagem p/ postagem em massa na Amazon (flat file).
-- Gerados pela IA (enriquecer-produto) e gravados em lote por scripts/enriquecer_precos.mjs.
-- Idempotente. NÃO aplicar sem OK de Pedro/Bárbara.
alter table itens add column if not exists bullet_points jsonb;   -- array de strings (até 5 pontos-chave)
alter table itens add column if not exists palavras_chave text;   -- termos de busca (generic_keywords)
alter table itens add column if not exists ficha_tecnica jsonb;   -- array de {atributo, valor}
