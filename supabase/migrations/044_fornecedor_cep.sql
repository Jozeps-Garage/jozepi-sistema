-- CEP do fornecedor.
-- Execute no Supabase → SQL Editor → Run.
--
-- A consulta de CNPJ já devolve o CEP junto do endereço; sem coluna ele era
-- descartado. Texto e não número: CEP tem zero à esquerda.

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS zip_code TEXT;
