-- Acréscimos do lançamento (juros, frete, taxa).
-- Execute no Supabase → SQL Editor → Run.
--
-- Mesma regra da 050: a coluna `amount` continua sendo o que saiu da conta —
-- o líquido, já com o desconto abatido e o acréscimo somado. Relatório, fluxo
-- de caixa e saldo somam essa coluna e não precisam saber da composição.
--
-- O que entra aqui é só o que falta para reconstruir a nota ao reabrir o
-- lançamento. Diferente do desconto, o acréscimo não tem tipo: frete e juros
-- vêm em reais, e um "acréscimo de 10%" sobre uma nota já descontada seria
-- uma conta que ninguém faz de cabeça.
--
-- A ordem importa e é esta: desconto sobre o bruto, acréscimo depois.
-- Desconto de 10% numa nota de 100 com 20 de frete é 10, não 12.

ALTER TABLE financial_transactions
  ADD COLUMN IF NOT EXISTS surcharge_value NUMERIC(10, 2);

COMMENT ON COLUMN financial_transactions.surcharge_value IS
  'Acréscimo em reais somado depois do desconto. Nulo: lançamento sem acréscimo. O amount já vem somado.';
