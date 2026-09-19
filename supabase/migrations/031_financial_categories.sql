-- Categorias financeiras cadastráveis (receita / despesa)
-- Execute no Supabase → SQL Editor → Run. Requer a 030.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS financial_categories (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id  UUID NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('receita', 'despesa')),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workshop_id, type, name)
);

CREATE INDEX IF NOT EXISTS idx_financial_categories_workshop_type
  ON financial_categories (workshop_id, type, active);

ALTER TABLE financial_transactions
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES financial_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_financial_transactions_category
  ON financial_transactions (workshop_id, category_id);

ALTER TABLE financial_categories ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'financial_categories'
      AND policyname = 'financial_categories_select_own_workshop'
  ) THEN
    CREATE POLICY financial_categories_select_own_workshop
      ON financial_categories FOR SELECT TO authenticated
      USING (
        workshop_id IN (
          SELECT profiles.workshop_id FROM profiles WHERE profiles.id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'financial_categories'
      AND policyname = 'financial_categories_insert_own_workshop'
  ) THEN
    CREATE POLICY financial_categories_insert_own_workshop
      ON financial_categories FOR INSERT TO authenticated
      WITH CHECK (
        workshop_id IN (
          SELECT profiles.workshop_id FROM profiles WHERE profiles.id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'financial_categories'
      AND policyname = 'financial_categories_update_own_workshop'
  ) THEN
    CREATE POLICY financial_categories_update_own_workshop
      ON financial_categories FOR UPDATE TO authenticated
      USING (
        workshop_id IN (
          SELECT profiles.workshop_id FROM profiles WHERE profiles.id = auth.uid()
        )
      )
      WITH CHECK (
        workshop_id IN (
          SELECT profiles.workshop_id FROM profiles WHERE profiles.id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'financial_categories'
      AND policyname = 'financial_categories_delete_own_workshop'
  ) THEN
    CREATE POLICY financial_categories_delete_own_workshop
      ON financial_categories FOR DELETE TO authenticated
      USING (
        workshop_id IN (
          SELECT profiles.workshop_id FROM profiles WHERE profiles.id = auth.uid()
        )
      );
  END IF;
END $$;

INSERT INTO financial_categories (workshop_id, name, type, active)
SELECT w.id, seed.name, seed.type, TRUE
FROM workshops w
CROSS JOIN (
  VALUES
    ('Serviço', 'receita'),
    ('Gorjeta', 'receita'),
    ('Outros', 'receita'),
    ('Produtos', 'despesa'),
    ('Equipamentos', 'despesa'),
    ('Aluguel', 'despesa'),
    ('Marketing', 'despesa'),
    ('Outros', 'despesa'),
    ('Custo Fixo', 'despesa')
) AS seed(name, type)
ON CONFLICT (workshop_id, type, name) DO NOTHING;

-- Backfill category_id a partir do texto legado (mesmo tipo + nome, case-insensitive).
UPDATE financial_transactions ft
SET category_id = fc.id
FROM financial_categories fc
WHERE ft.workshop_id = fc.workshop_id
  AND ft.type::text = fc.type
  AND lower(btrim(COALESCE(ft.category, ''))) = lower(fc.name)
  AND ft.category_id IS NULL
  AND COALESCE(btrim(ft.category), '') <> '';

DO $$
DECLARE
  unmatched integer;
BEGIN
  SELECT COUNT(*) INTO unmatched
  FROM financial_transactions
  WHERE category_id IS NULL
    AND COALESCE(btrim(category), '') <> '';

  RAISE NOTICE 'financial_categories backfill: % lançamentos sem category_id (texto sem correspondência).', unmatched;
END $$;

CREATE OR REPLACE FUNCTION public.seed_workshop_finance_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO financial_accounts (workshop_id, name, type, initial_balance, active, is_default)
  VALUES (NEW.id, 'Não classificado', 'outro', 0, TRUE, TRUE)
  ON CONFLICT (workshop_id, name) DO NOTHING;

  INSERT INTO financial_categories (workshop_id, name, type, active)
  VALUES
    (NEW.id, 'Serviço', 'receita', TRUE),
    (NEW.id, 'Gorjeta', 'receita', TRUE),
    (NEW.id, 'Outros', 'receita', TRUE),
    (NEW.id, 'Produtos', 'despesa', TRUE),
    (NEW.id, 'Equipamentos', 'despesa', TRUE),
    (NEW.id, 'Aluguel', 'despesa', TRUE),
    (NEW.id, 'Marketing', 'despesa', TRUE),
    (NEW.id, 'Outros', 'despesa', TRUE),
    (NEW.id, 'Custo Fixo', 'despesa', TRUE)
  ON CONFLICT (workshop_id, type, name) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workshops_default_financial_account ON workshops;
DROP TRIGGER IF EXISTS trg_workshops_finance_defaults ON workshops;
CREATE TRIGGER trg_workshops_finance_defaults
AFTER INSERT ON workshops
FOR EACH ROW
EXECUTE PROCEDURE public.seed_workshop_finance_defaults();

DROP FUNCTION IF EXISTS public.seed_workshop_default_account();

REVOKE ALL ON FUNCTION public.seed_workshop_finance_defaults() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_workshop_finance_defaults() TO authenticated;
