-- Devolve para "pendente" os custos fixos que o sistema marcou como pagos sozinho.
-- Execute no Supabase → SQL Editor → Run.
--
-- O lançamento automático do custo fixo nascia com payment_status = 'pago' e
-- effective_date preenchida. Resultado: a conta sumia da lista de contas a
-- pagar antes de alguém pagar, e o saldo já vinha descontado de um dinheiro
-- que não tinha saído da conta.
--
-- O código foi corrigido para lançar como 'pendente' com due_date no dia do
-- vencimento. Esta migration conserta as linhas que já estavam gravadas.
--
-- ATENÇÃO: só mexe no que venceu a partir da data abaixo. Meses mais antigos
-- provavelmente foram pagos de verdade, e marcá-los como pendentes criaria uma
-- lista enorme de contas vencidas que não existem. Ajuste a data se precisar
-- alcançar mais meses para trás.

-- 1) Confira antes de alterar: rode SÓ este SELECT primeiro.
-- SELECT transaction_date, description, amount, payment_status, effective_date
-- FROM financial_transactions
-- WHERE source LIKE 'fixed_cost:%'
--   AND payment_status = 'pago'
--   AND transaction_date >= DATE '2026-10-01'
-- ORDER BY transaction_date DESC;

-- 2) A correção.
UPDATE financial_transactions
SET payment_status = 'pendente',
    effective_date = NULL,
    due_date       = COALESCE(due_date, transaction_date)
WHERE source LIKE 'fixed_cost:%'
  AND payment_status = 'pago'
  AND transaction_date >= DATE '2026-10-01';

-- 3) Custos fixos antigos ficaram sem due_date porque a coluna nasceu depois
--    (migration 034). Preenche sem mexer no status de ninguém.
UPDATE financial_transactions
SET due_date = transaction_date
WHERE source LIKE 'fixed_cost:%'
  AND due_date IS NULL;
