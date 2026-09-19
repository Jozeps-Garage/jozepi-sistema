-- Parcelamento de despesas (várias transações no mesmo grupo).
-- Execute no Supabase → SQL Editor → Run. Requer a 034.

ALTER TABLE financial_transactions
  ADD COLUMN IF NOT EXISTS installment_group_id UUID,
  ADD COLUMN IF NOT EXISTS installment_number INTEGER
    CHECK (installment_number IS NULL OR installment_number >= 1),
  ADD COLUMN IF NOT EXISTS installment_total INTEGER
    CHECK (installment_total IS NULL OR installment_total >= 1);

CREATE INDEX IF NOT EXISTS idx_financial_transactions_installment_group
  ON financial_transactions (workshop_id, installment_group_id)
  WHERE installment_group_id IS NOT NULL;
