-- Preenche o vencimento das despesas antigas que ficaram sem ele.
-- Execute no Supabase → SQL Editor → Run.
--
-- A lista de despesas passa a filtrar por vencimento por padrão, que é a
-- pergunta certa para contas a pagar. Só que 53 das 83 despesas não têm
-- due_date: são as pagas de antes da coluna existir. A 034 preencheu apenas as
-- pendentes. Sem este preenchimento, filtrar por vencimento esconderia 64% da
-- lista.
--
-- O valor usado é a própria data de lançamento. Em despesa já paga o
-- vencimento é informação histórica e não muda saldo, status nem relatório —
-- só devolve a linha para dentro do filtro.
--
-- Só despesas: em receita um vencimento igual ao lançamento faria o que está
-- pendente virar "Vencido" na hora, o que mudaria o significado da tela.

-- 1) Confira antes: rode SÓ este SELECT primeiro.
-- SELECT count(*) AS sem_vencimento
-- FROM financial_transactions
-- WHERE type = 'despesa' AND due_date IS NULL;

-- 2) A correção.
UPDATE financial_transactions
SET due_date = transaction_date
WHERE type = 'despesa'
  AND due_date IS NULL;
