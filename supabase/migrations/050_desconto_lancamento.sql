-- Desconto do lançamento.
-- Execute no Supabase → SQL Editor → Run.
--
-- A coluna `amount` continua sendo o que saiu da conta: o líquido, já com o
-- desconto abatido. Relatório, fluxo de caixa e saldo somam essa coluna, e
-- mudar o sentido dela para bruto quebraria todos de uma vez.
--
-- O que entra aqui é só o que falta para reconstruir a nota ao reabrir o
-- lançamento: se o desconto foi em reais ou em porcento, e quanto.

ALTER TABLE financial_transactions
  ADD COLUMN IF NOT EXISTS discount_type TEXT,
  ADD COLUMN IF NOT EXISTS discount_value NUMERIC(10, 2);

COMMENT ON COLUMN financial_transactions.discount_type IS
  'fixed (reais) ou percent (porcento). Nulo: lançamento sem desconto.';

COMMENT ON COLUMN financial_transactions.discount_value IS
  'Quanto de desconto, na unidade do discount_type. O amount já vem abatido.';
