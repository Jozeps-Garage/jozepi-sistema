-- Itens da despesa, como as linhas de uma nota fiscal.
-- Execute no Supabase → SQL Editor → Run.
--
-- Hoje os itens são digitados à mão dentro da observação, em texto corrido
-- ("* Fast Grafeno 500ml R$ 62,00"). Isso não soma, não confere com o valor do
-- lançamento e não dá para consultar depois.
--
-- Guarda como JSONB e não em tabela própria porque a lista só é lida junto do
-- lançamento: não há join, nem relatório por item. No dia em que precisar
-- responder "quanto gastei em Fast Grafeno no ano", aí sim vira tabela.
--
-- Formato de cada item:
--   { "description": "Fast Grafeno 500ml", "quantity": 1, "unitAmount": 62.00 }

ALTER TABLE financial_transactions
  ADD COLUMN IF NOT EXISTS items JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Barra qualquer coisa que não seja lista, para o app não precisar se defender
-- de objeto solto vindo do banco.
ALTER TABLE financial_transactions
  DROP CONSTRAINT IF EXISTS financial_transactions_items_check;

ALTER TABLE financial_transactions
  ADD CONSTRAINT financial_transactions_items_check
  CHECK (jsonb_typeof(items) = 'array');
