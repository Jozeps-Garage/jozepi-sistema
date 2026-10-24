-- Valor pago em cada entrada de estoque.
-- Execute no Supabase → SQL Editor → Run.
--
-- O histórico precisa dizer quanto custou aquela compra, e não quanto o
-- produto custa hoje: preço muda, e um histórico que recalcula pelo preço
-- atual mente sobre o passado.
--
-- Fica no próprio movimento, não numa junção com a despesa, porque entrada
-- também acontece sem nota — e porque apagar a despesa não pode apagar a
-- memória do que foi pago.

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(10, 2);

COMMENT ON COLUMN stock_movements.unit_cost IS
  'Quanto custou cada unidade nesta entrada. Nulo em baixa e revisão.';
