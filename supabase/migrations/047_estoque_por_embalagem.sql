-- Estoque refeito: contagem por embalagem, baixa manual e histórico.
-- Execute no Supabase → SQL Editor → Run.
--
-- O modelo antigo guardava "volume total" e "volume restante" e desenhava uma
-- barra de consumo. A barra nunca andava: nada no sistema descontava estoque
-- ao prestar serviço, então aquele número só mudava na mão. Some a barra e
-- entra contagem de embalagem — "3 galões", "12 panos" — que é como se compra
-- e como se confere na prateleira.
--
-- Três tipos de item agora:
--   liquido     — galões e frascos, acabam com o uso
--   utensilio   — panos, pincéis, microfibras: gastam e vão fora
--   patrimonio  — politriz, soprador, estrutura: não se consome, tem revenda
--
-- O que o banco NÃO consegue adivinhar e você corrige depois na tela:
--   1. Quantas embalagens você tem de cada líquido. A migration assume 1, com
--      o volume cadastrado virando o tamanho dela. A primeira revisão de
--      estoque acerta isso.
--   2. Quais utensílios são, na verdade, patrimônio. Todos entram como
--      utensílio; trocar o tipo é um clique no cadastro.

-- 1. Colunas novas em products -----------------------------------------------

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS kind TEXT,
  ADD COLUMN IF NOT EXISTS on_hand NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_on_hand NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS unit_label TEXT,
  ADD COLUMN IF NOT EXISTS package_volume_ml NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS resale_value NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS acquired_on DATE;

COMMENT ON COLUMN products.kind IS
  'liquido | utensilio | patrimonio';
COMMENT ON COLUMN products.on_hand IS
  'Quantas embalagens/unidades você tem. Patrimônio não usa.';
COMMENT ON COLUMN products.min_on_hand IS
  'Abaixo disso o painel avisa. Vazio: não avisa.';
COMMENT ON COLUMN products.unit_label IS
  'Como você chama a embalagem: galão, frasco, pano, unidade.';
COMMENT ON COLUMN products.package_volume_ml IS
  'Tamanho de UMA embalagem, em ml. Só para líquido.';
COMMENT ON COLUMN products.resale_value IS
  'Quanto você acha que o equipamento vale hoje. Só para patrimônio.';

-- 2. Traz os dados do modelo antigo -------------------------------------------

-- O tipo antigo era 'liquid' / 'utensil' (e tipos personalizados).
UPDATE products
SET kind = CASE WHEN type = 'liquid' THEN 'liquido' ELSE 'utensilio' END
WHERE kind IS NULL;

-- Líquido: o volume cadastrado vira o tamanho da embalagem e assume-se uma.
UPDATE products
SET package_volume_ml = NULLIF(volume_ml, '')::NUMERIC,
    unit_label = COALESCE(unit_label, 'frasco'),
    on_hand = 1
WHERE kind = 'liquido'
  AND package_volume_ml IS NULL
  AND volume_ml ~ '^[0-9]+(\.[0-9]+)?$';

-- Utensílio: a quantidade cadastrada já era contagem de unidade.
UPDATE products
SET on_hand = COALESCE(NULLIF(quantity, '')::NUMERIC, 1),
    unit_label = COALESCE(unit_label, 'unidade')
WHERE kind = 'utensilio'
  AND quantity ~ '^[0-9]+(\.[0-9]+)?$';

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_kind_valido;

ALTER TABLE products
  ADD CONSTRAINT products_kind_valido
  CHECK (kind IS NULL OR kind IN ('liquido', 'utensilio', 'patrimonio'));

CREATE INDEX IF NOT EXISTS idx_products_kind
  ON products (workshop_id, kind, name);

-- 3. Movimentações -------------------------------------------------------------
--
-- É daqui que sai o histórico de durabilidade: cada entrada abre um ciclo e a
-- baixa que zera o saldo fecha, então dá para dizer "comprei dia X, acabou dia
-- Y, durou N dias".

CREATE TABLE IF NOT EXISTS stock_movements (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id    UUID NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('entrada', 'baixa', 'revisao')),
  -- entrada/baixa: quanto entrou ou saiu. revisao: quanto foi contado.
  quantity       NUMERIC(12, 2) NOT NULL CHECK (quantity >= 0),
  -- Saldo depois do movimento, gravado para o histórico não ter que recalcular
  -- a cadeia inteira toda vez.
  balance_after  NUMERIC(12, 2) NOT NULL,
  occurred_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  notes          TEXT,
  -- Compra que originou a entrada, quando veio de uma despesa.
  transaction_id UUID REFERENCES financial_transactions(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_produto
  ON stock_movements (workshop_id, product_id, occurred_on DESC, created_at DESC);

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'stock_movements'
      AND policyname = 'stock_movements_select_own_workshop'
  ) THEN
    CREATE POLICY stock_movements_select_own_workshop
      ON stock_movements FOR SELECT TO authenticated
      USING (
        workshop_id IN (
          SELECT profiles.workshop_id FROM profiles WHERE profiles.id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'stock_movements'
      AND policyname = 'stock_movements_insert_own_workshop'
  ) THEN
    CREATE POLICY stock_movements_insert_own_workshop
      ON stock_movements FOR INSERT TO authenticated
      WITH CHECK (
        workshop_id IN (
          SELECT profiles.workshop_id FROM profiles WHERE profiles.id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'stock_movements'
      AND policyname = 'stock_movements_delete_own_workshop'
  ) THEN
    CREATE POLICY stock_movements_delete_own_workshop
      ON stock_movements FOR DELETE TO authenticated
      USING (
        workshop_id IN (
          SELECT profiles.workshop_id FROM profiles WHERE profiles.id = auth.uid()
        )
      );
  END IF;
END $$;

-- Sem política de UPDATE de propósito: movimento é registro do que aconteceu.
-- Errou, apaga e lança de novo — assim o histórico não vira ficção.
