-- Permite lançamento de valor zero (serviço trocado, permuta, cortesia).
-- Execute no Supabase → SQL Editor → Run.
--
-- A tabela nasceu com CHECK (amount > 0), então não dava para registrar no
-- histórico um serviço prestado sem cobrança — a única saída era inventar um
-- valor simbólico, que suja o faturamento.
--
-- Continua barrando valor negativo: despesa é gravada como amount positivo
-- com type = 'despesa', nunca como receita negativa.

ALTER TABLE financial_transactions
  DROP CONSTRAINT IF EXISTS financial_transactions_amount_check;

ALTER TABLE financial_transactions
  ADD CONSTRAINT financial_transactions_amount_check CHECK (amount >= 0);
