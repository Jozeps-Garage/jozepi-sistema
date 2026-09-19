-- Data de vencimento (quando o pagamento é esperado).
-- Execute no Supabase → SQL Editor → Run. Requer a 032 (effective_date / payment_status).

ALTER TABLE financial_transactions
  ADD COLUMN IF NOT EXISTS due_date DATE;

CREATE INDEX IF NOT EXISTS idx_financial_transactions_due_date
  ON financial_transactions (workshop_id, payment_status, due_date);

-- Pendente/parcial: vencimento padrão = data do lançamento.
UPDATE financial_transactions
SET due_date = transaction_date
WHERE payment_status IN ('pendente', 'parcial')
  AND due_date IS NULL;
