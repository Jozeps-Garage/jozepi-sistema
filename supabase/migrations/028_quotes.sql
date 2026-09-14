-- Orçamentos internos: criar, listar, status e conversão em agendamento.
-- Execute no Supabase → SQL Editor → Run.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS quotes (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id      UUID NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente', 'aprovado', 'expirado', 'convertido')),
  valid_until      DATE,
  notes            TEXT,
  total_amount     NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  service_order_id UUID REFERENCES service_orders(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quote_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_id    UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  service_id  UUID REFERENCES services(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'servico'
              CHECK (kind IN ('coating', 'stage', 'servico')),
  unit_price  NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotes_workshop_created
  ON quotes (workshop_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quotes_workshop_status
  ON quotes (workshop_id, status);

CREATE INDEX IF NOT EXISTS idx_quote_items_quote
  ON quote_items (quote_id);

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'quotes'
      AND policyname = 'quotes_select_own_workshop'
  ) THEN
    CREATE POLICY quotes_select_own_workshop
      ON quotes FOR SELECT TO authenticated
      USING (
        workshop_id IN (
          SELECT profiles.workshop_id FROM profiles WHERE profiles.id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'quotes'
      AND policyname = 'quotes_insert_own_workshop'
  ) THEN
    CREATE POLICY quotes_insert_own_workshop
      ON quotes FOR INSERT TO authenticated
      WITH CHECK (
        workshop_id IN (
          SELECT profiles.workshop_id FROM profiles WHERE profiles.id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'quotes'
      AND policyname = 'quotes_update_own_workshop'
  ) THEN
    CREATE POLICY quotes_update_own_workshop
      ON quotes FOR UPDATE TO authenticated
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
    WHERE schemaname = 'public' AND tablename = 'quotes'
      AND policyname = 'quotes_delete_own_workshop'
  ) THEN
    CREATE POLICY quotes_delete_own_workshop
      ON quotes FOR DELETE TO authenticated
      USING (
        workshop_id IN (
          SELECT profiles.workshop_id FROM profiles WHERE profiles.id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'quote_items'
      AND policyname = 'quote_items_select_own_workshop'
  ) THEN
    CREATE POLICY quote_items_select_own_workshop
      ON quote_items FOR SELECT TO authenticated
      USING (
        quote_id IN (
          SELECT quotes.id FROM quotes
          WHERE quotes.workshop_id IN (
            SELECT profiles.workshop_id FROM profiles WHERE profiles.id = auth.uid()
          )
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'quote_items'
      AND policyname = 'quote_items_insert_own_workshop'
  ) THEN
    CREATE POLICY quote_items_insert_own_workshop
      ON quote_items FOR INSERT TO authenticated
      WITH CHECK (
        quote_id IN (
          SELECT quotes.id FROM quotes
          WHERE quotes.workshop_id IN (
            SELECT profiles.workshop_id FROM profiles WHERE profiles.id = auth.uid()
          )
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'quote_items'
      AND policyname = 'quote_items_update_own_workshop'
  ) THEN
    CREATE POLICY quote_items_update_own_workshop
      ON quote_items FOR UPDATE TO authenticated
      USING (
        quote_id IN (
          SELECT quotes.id FROM quotes
          WHERE quotes.workshop_id IN (
            SELECT profiles.workshop_id FROM profiles WHERE profiles.id = auth.uid()
          )
        )
      )
      WITH CHECK (
        quote_id IN (
          SELECT quotes.id FROM quotes
          WHERE quotes.workshop_id IN (
            SELECT profiles.workshop_id FROM profiles WHERE profiles.id = auth.uid()
          )
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'quote_items'
      AND policyname = 'quote_items_delete_own_workshop'
  ) THEN
    CREATE POLICY quote_items_delete_own_workshop
      ON quote_items FOR DELETE TO authenticated
      USING (
        quote_id IN (
          SELECT quotes.id FROM quotes
          WHERE quotes.workshop_id IN (
            SELECT profiles.workshop_id FROM profiles WHERE profiles.id = auth.uid()
          )
        )
      );
  END IF;
END $$;
