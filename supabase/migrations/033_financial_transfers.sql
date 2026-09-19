-- Transferências entre contas próprias (não são receita nem despesa).
-- Execute no Supabase → SQL Editor → Run. Requer a 030.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS financial_transfers (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id      UUID NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  from_account_id  UUID NOT NULL REFERENCES financial_accounts(id) ON DELETE RESTRICT,
  to_account_id    UUID NOT NULL REFERENCES financial_accounts(id) ON DELETE RESTRICT,
  amount           NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  transfer_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  description      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (from_account_id <> to_account_id)
);

CREATE INDEX IF NOT EXISTS idx_financial_transfers_workshop_date
  ON financial_transfers (workshop_id, transfer_date DESC);

CREATE INDEX IF NOT EXISTS idx_financial_transfers_from_account
  ON financial_transfers (from_account_id, transfer_date DESC);

CREATE INDEX IF NOT EXISTS idx_financial_transfers_to_account
  ON financial_transfers (to_account_id, transfer_date DESC);

ALTER TABLE financial_transfers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'financial_transfers'
      AND policyname = 'financial_transfers_select_own_workshop'
  ) THEN
    CREATE POLICY financial_transfers_select_own_workshop
      ON financial_transfers FOR SELECT TO authenticated
      USING (
        workshop_id IN (
          SELECT profiles.workshop_id FROM profiles WHERE profiles.id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'financial_transfers'
      AND policyname = 'financial_transfers_insert_own_workshop'
  ) THEN
    CREATE POLICY financial_transfers_insert_own_workshop
      ON financial_transfers FOR INSERT TO authenticated
      WITH CHECK (
        workshop_id IN (
          SELECT profiles.workshop_id FROM profiles WHERE profiles.id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'financial_transfers'
      AND policyname = 'financial_transfers_delete_own_workshop'
  ) THEN
    CREATE POLICY financial_transfers_delete_own_workshop
      ON financial_transfers FOR DELETE TO authenticated
      USING (
        workshop_id IN (
          SELECT profiles.workshop_id FROM profiles WHERE profiles.id = auth.uid()
        )
      );
  END IF;
END $$;
