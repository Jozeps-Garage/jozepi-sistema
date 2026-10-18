-- Número da nota fiscal como campo próprio.
-- Execute no Supabase → SQL Editor → Run.
--
-- Hoje o número vive dentro da descrição ("NF 1259", "NF 506.253"), então não
-- dá para procurar por ele sem depender de como foi escrito naquele dia, nem
-- para ver numa coluna da lista.
--
-- Texto e não número: nota fiscal tem série, barra e zero à esquerda.

ALTER TABLE financial_transactions
  ADD COLUMN IF NOT EXISTS invoice_number TEXT;

CREATE INDEX IF NOT EXISTS idx_financial_transactions_invoice
  ON financial_transactions (workshop_id, invoice_number)
  WHERE invoice_number IS NOT NULL;
