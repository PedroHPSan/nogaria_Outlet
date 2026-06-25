-- Fase 3 — Precificação de 2 eixos: separa a condição do PRODUTO da condição da
-- EMBALAGEM. Espelho JS em src/lib/pricing.js (EMBALAGEM_FATOR, DEFAULT_PARAMS.condicao).
-- Idempotente. NÃO aplicar sem OK de Pedro/Bárbara (Supabase é a fonte de verdade).

-- 1. Eixo EMBALAGEM: multiplicador pequeno (3–12%) aplicado por cima da condição
--    do produto. Calibrado pelo que o mercado online cobra por caixa avariada.
create table if not exists pricing_factor_embalagem (
  codigo text primary key,
  fator  numeric not null,
  obs    text
);
insert into pricing_factor_embalagem (codigo,fator,obs) values
  ('PERFEITA', 1.00, 'caixa intacta'),
  ('LEVE',     0.97, 'amassado/risco leve — produto novo'),
  ('MEDIA',    0.93, 'caixa avariada visível'),
  ('FORTE',    0.88, 'caixa muito danificada'),
  ('SEM_CAIXA',0.88, 'sem embalagem original')
on conflict (codigo) do update set fator=excluded.fator, obs=excluded.obs;

-- 2. Condição da embalagem por item (eixo independente do estado do produto).
--    Guarda o CÓDIGO (PERFEITA/LEVE/MEDIA/FORTE/SEM_CAIXA); a UI normaliza o label.
alter table itens add column if not exists cond_embalagem text default 'PERFEITA';

-- 3. Recalibra a condição do PRODUTO: sobe NOVO_LACRADO (a caixa agora corta à parte),
--    adiciona NOVO_SEM_LACRE e aposenta NOVO_CAIXA_AVARIADA (= NOVO_LACRADO × embalagem).
update pricing_factor_condicao
   set fator=0.85, obs='estado=Novo (caixa ajustada pelo eixo embalagem)'
 where codigo='NOVO_LACRADO';

insert into pricing_factor_condicao (codigo,fator,ancora,obs) values
  ('NOVO_SEM_LACRE',0.78,'NOVO','novo sem lacre, não usado')
on conflict (codigo) do update set fator=excluded.fator, ancora=excluded.ancora, obs=excluded.obs;

update pricing_factor_condicao
   set obs='LEGADO — substituído por NOVO_LACRADO × pricing_factor_embalagem'
 where codigo='NOVO_CAIXA_AVARIADA';

-- 4. Backfill: itens já marcados 'Embalagem aberta/avariada' têm, por definição, caixa
--    não-perfeita. Sem isto o default 'PERFEITA' zeraria o desconto de caixa deles.
--    LEVE (0,97) → novo × 0,85 × 0,97 ≈ 0,82× do novo (alvo do plano); a triagem refina.
update itens set cond_embalagem='LEVE'
 where estado='Embalagem aberta/avariada'
   and (cond_embalagem is null or cond_embalagem='PERFEITA');
