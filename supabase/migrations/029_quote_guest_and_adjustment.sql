-- Cliente avulso e ajuste final no orçamento.
-- Execute no Supabase → SQL Editor → Run.

ALTER TABLE quotes
  ALTER COLUMN client_id DROP NOT NULL;

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS guest_name TEXT,
  ADD COLUMN IF NOT EXISTS guest_contact TEXT,
  ADD COLUMN IF NOT EXISTS adjustment_amount NUMERIC(10, 2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quotes_client_or_guest_chk'
  ) THEN
    ALTER TABLE quotes
      ADD CONSTRAINT quotes_client_or_guest_chk
      CHECK (
        client_id IS NOT NULL
        OR (guest_name IS NOT NULL AND length(btrim(guest_name)) > 0)
      );
  END IF;
END $$;
