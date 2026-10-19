-- Impede que o mesmo custo fixo seja lançado duas vezes no mesmo mês.
-- Execute no Supabase → SQL Editor → Run.
--
-- Cada lançamento automático de custo fixo carrega um `source` próprio no
-- formato "fixed_cost:<id do custo>:<ano-mês>", e o app só insere quando não
-- acha esse source entre os lançamentos que já carregou. O problema é que essa
-- checagem é feita em memória: a inserção dispara o realtime, que recarrega a
-- página, que roda a sincronização de novo — e se a segunda leitura acontecer
-- antes de a primeira inserção ficar visível, entra duplicado.
--
-- O código foi corrigido para não rodar duas sincronizações ao mesmo tempo,
-- mas corrida é coisa que se resolve no banco. Com o índice abaixo a segunda
-- inserção é recusada, não importa o que o app tente.

-- 1) Confira o que será apagado: rode SÓ este SELECT primeiro.
-- SELECT source, count(*), sum(amount) AS total
-- FROM financial_transactions
-- WHERE source LIKE 'fixed_cost:%'
-- GROUP BY source HAVING count(*) > 1
-- ORDER BY source;

-- 2) Remove as cópias, mantendo uma por mês. Fica a que já foi mexida (tem
--    data de pagamento) e, em empate, a mais antiga.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY workshop_id, source
      ORDER BY (effective_date IS NOT NULL) DESC, created_at ASC, id ASC
    ) AS rn
  FROM financial_transactions
  WHERE source LIKE 'fixed_cost:%'
)
DELETE FROM financial_transactions
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 3) A garantia. Parcial porque lançamento manual tem source nulo e pode
--    repetir à vontade.
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_transactions_source_unico
  ON financial_transactions (workshop_id, source)
  WHERE source IS NOT NULL;
