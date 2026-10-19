-- Nome fantasia e endereço do fornecedor.
-- Execute no Supabase → SQL Editor → Run.
--
-- O formulário tinha um campo só, "nome da empresa", que na prática guardava
-- ora a razão social ("CONNECT PETRO HUB DENEGOCIOS LTDA"), ora o nome de
-- fachada ("ZaplusCar"). A consulta de CNPJ devolve os dois separados, então
-- agora cada um tem o seu lugar: `name` passa a ser a razão social e
-- `trade_name` o nome fantasia.
--
-- Os cadastros antigos ficam como estão: o que estiver em `name` continua
-- valendo e é o que as listas mostram enquanto não houver fantasia.

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS trade_name TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT;
