-- Contas financeiras (caixa, banco, InfinitePay etc.)
-- Execute no Supabase → SQL Editor → Run.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS financial_accounts (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id      UUID NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL DEFAULT 'outro'
                   CHECK (type IN ('dinheiro', 'banco', 'digital', 'outro')),
  initial_balance  NUMERIC(10, 2) NOT NULL DEFAULT 0,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  is_default       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workshop_id, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_accounts_one_default
  ON financial_accounts (workshop_id)
  WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_financial_accounts_workshop_active
  ON financial_accounts (workshop_id, active);

ALTER TABLE financial_transactions
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES financial_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_financial_transactions_account
  ON financial_transactions (workshop_id, account_id, transaction_date DESC);

ALTER TABLE financial_accounts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'financial_accounts'
      AND policyname = 'financial_accounts_select_own_workshop'
  ) THEN
    CREATE POLICY financial_accounts_select_own_workshop
      ON financial_accounts FOR SELECT TO authenticated
      USING (
        workshop_id IN (
          SELECT profiles.workshop_id FROM profiles WHERE profiles.id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'financial_accounts'
      AND policyname = 'financial_accounts_insert_own_workshop'
  ) THEN
    CREATE POLICY financial_accounts_insert_own_workshop
      ON financial_accounts FOR INSERT TO authenticated
      WITH CHECK (
        workshop_id IN (
          SELECT profiles.workshop_id FROM profiles WHERE profiles.id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'financial_accounts'
      AND policyname = 'financial_accounts_update_own_workshop'
  ) THEN
    CREATE POLICY financial_accounts_update_own_workshop
      ON financial_accounts FOR UPDATE TO authenticated
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
    WHERE schemaname = 'public' AND tablename = 'financial_accounts'
      AND policyname = 'financial_accounts_delete_own_workshop'
  ) THEN
    CREATE POLICY financial_accounts_delete_own_workshop
      ON financial_accounts FOR DELETE TO authenticated
      USING (
        workshop_id IN (
          SELECT profiles.workshop_id FROM profiles WHERE profiles.id = auth.uid()
        )
      );
  END IF;
END $$;

-- Uma conta padrão por oficina já existente.
INSERT INTO financial_accounts (workshop_id, name, type, initial_balance, active, is_default)
SELECT w.id, 'Não classificado', 'outro', 0, TRUE, TRUE
FROM workshops w
WHERE NOT EXISTS (
  SELECT 1 FROM financial_accounts a
  WHERE a.workshop_id = w.id AND a.name = 'Não classificado'
);

UPDATE financial_accounts a
SET is_default = TRUE
WHERE a.name = 'Não classificado'
  AND NOT EXISTS (
    SELECT 1 FROM financial_accounts other
    WHERE other.workshop_id = a.workshop_id AND other.is_default
  );

-- Backfill: nenhum lançamento antigo fica sem conta.
UPDATE financial_transactions ft
SET account_id = a.id
FROM financial_accounts a
WHERE ft.workshop_id = a.workshop_id
  AND a.is_default
  AND ft.account_id IS NULL;

CREATE OR REPLACE FUNCTION public.seed_workshop_default_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO financial_accounts (workshop_id, name, type, initial_balance, active, is_default)
  VALUES (NEW.id, 'Não classificado', 'outro', 0, TRUE, TRUE)
  ON CONFLICT (workshop_id, name) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workshops_default_financial_account ON workshops;
CREATE TRIGGER trg_workshops_default_financial_account
AFTER INSERT ON workshops
FOR EACH ROW
EXECUTE PROCEDURE public.seed_workshop_default_account();

REVOKE ALL ON FUNCTION public.seed_workshop_default_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_workshop_default_account() TO authenticated;
