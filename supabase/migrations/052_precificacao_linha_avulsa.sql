-- Linha avulsa na precificação de serviço.
-- Execute no Supabase → SQL Editor → Run.
--
-- A tabela já ligava serviço a produto do catálogo e guardava quanto cada
-- serviço consome. Passa a aceitar também a linha que existe só para a conta:
-- um nome e um custo digitados na hora, sem virar cadastro de produto e sem
-- aparecer no estoque.
--
-- Foi justamente o cadastro que matou a primeira versão disso, removida em
-- outubro: produto demais para manter, para um número que ninguém media. A
-- linha avulsa é o contrário — nasce e morre dentro da precificação.
--
-- product_id passa a aceitar nulo, e nulo é o que distingue as duas: com
-- produto vale o amount e o custo sai do catálogo; sem produto valem label e
-- cost, digitados.
--
-- O UNIQUE (service_id, product_id) continua de pé. No Postgres dois nulos não
-- conflitam entre si, então várias linhas avulsas convivem no mesmo serviço,
-- e o mesmo produto duas vezes segue barrado.

ALTER TABLE service_product_usages
  ALTER COLUMN product_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS cost NUMERIC(10, 2);

ALTER TABLE service_product_usages
  DROP CONSTRAINT IF EXISTS service_product_usages_linha_valida;

ALTER TABLE service_product_usages
  ADD CONSTRAINT service_product_usages_linha_valida
  CHECK (
    product_id IS NOT NULL
    OR (label IS NOT NULL AND btrim(label) <> '' AND cost IS NOT NULL)
  );

COMMENT ON COLUMN service_product_usages.label IS
  'Nome da linha avulsa. Nulo quando a linha vem de um produto do catálogo.';
COMMENT ON COLUMN service_product_usages.cost IS
  'Custo em reais da linha avulsa. Linha de produto calcula pelo amount.';
