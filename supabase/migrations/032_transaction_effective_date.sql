-- Data de efetivação (caixa) separada da data de lançamento.
-- Execute no Supabase → SQL Editor → Run. Requer a 018 (payment_status).

ALTER TABLE financial_transactions
  ADD COLUMN IF NOT EXISTS effective_date DATE;

CREATE INDEX IF NOT EXISTS idx_financial_transactions_effective_date
  ON financial_transactions (workshop_id, type, effective_date DESC);

-- Alinha o status da receita automática com o da OS, para o caixa não contar
-- serviço ainda pendente como dinheiro já recebido.
UPDATE financial_transactions ft
SET payment_status = so.payment_status
FROM service_orders so
WHERE ft.service_order_id = so.id
  AND ft.type = 'receita'
  AND ft.payment_status IS DISTINCT FROM so.payment_status;

-- Pago: efetiva na data do lançamento quando ainda estiver vazia.
UPDATE financial_transactions
SET effective_date = transaction_date
WHERE payment_status = 'pago'
  AND effective_date IS NULL;

-- Pendente/parcial/cancelado: ainda não entrou no caixa.
UPDATE financial_transactions
SET effective_date = NULL
WHERE payment_status IN ('pendente', 'parcial', 'cancelado');
