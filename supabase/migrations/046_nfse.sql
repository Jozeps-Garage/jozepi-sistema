-- Emissão de NFS-e pela Notaas.
-- Execute no Supabase → SQL Editor → Run.
--
-- Duas partes:
--   1. Os dados fiscais da oficina, que vão em toda nota (código do serviço na
--      LC 116 e alíquota do ISS do município).
--   2. A tabela de notas. A emissão é assíncrona: a Notaas devolve um
--      invoice_id na hora e o resultado chega depois, então a nota existe aqui
--      desde o "enfileirada" até virar "emitida" ou "erro".
--
-- A chave da API NÃO mora no banco nem no navegador: fica em NOTAAS_API_KEY,
-- lida só pelas rotas de servidor.

-- 1. Dados fiscais da oficina ------------------------------------------------

ALTER TABLE workshops
  ADD COLUMN IF NOT EXISTS nfse_service_code TEXT,
  ADD COLUMN IF NOT EXISTS nfse_iss_rate NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS nfse_service_description TEXT;

COMMENT ON COLUMN workshops.nfse_service_code IS
  'cTribNac da LC 116/2003, 6 dígitos. Vazio: usa o padrão do projeto na Notaas.';
COMMENT ON COLUMN workshops.nfse_iss_rate IS
  'Alíquota do ISS em %, ex.: 2.00. Zero para imunidade ou exportação.';
COMMENT ON COLUMN workshops.nfse_service_description IS
  'Descrição padrão do serviço, usada quando o lançamento não tem uma melhor.';

ALTER TABLE workshops
  DROP CONSTRAINT IF EXISTS workshops_nfse_service_code_formato;

ALTER TABLE workshops
  ADD CONSTRAINT workshops_nfse_service_code_formato
  CHECK (nfse_service_code IS NULL OR nfse_service_code ~ '^[0-9]{6}$');

ALTER TABLE workshops
  DROP CONSTRAINT IF EXISTS workshops_nfse_iss_rate_intervalo;

ALTER TABLE workshops
  ADD CONSTRAINT workshops_nfse_iss_rate_intervalo
  CHECK (nfse_iss_rate IS NULL OR (nfse_iss_rate >= 0 AND nfse_iss_rate <= 100));

-- 2. Notas emitidas ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS nfse_invoices (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id      UUID NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  -- Lançamento que originou a nota. ON DELETE SET NULL: apagar a receita não
  -- apaga a nota, que já existe na prefeitura.
  transaction_id   UUID REFERENCES financial_transactions(id) ON DELETE SET NULL,
  client_id        UUID REFERENCES clients(id) ON DELETE SET NULL,
  -- id da Notaas; nulo só na janela entre criar a linha e a API responder.
  invoice_id       TEXT,
  -- O que mandamos como `referencia`, para conciliar pelo webhook.
  referencia       TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'processing', 'issued', 'error', 'cancelled')),
  amount           NUMERIC(10, 2) NOT NULL,
  tomador_nome     TEXT NOT NULL,
  tomador_document TEXT,
  servico_descricao TEXT NOT NULL,
  -- Preenchidos quando a nota é emitida.
  numero_nfse      TEXT,
  chave_nfse       TEXT,
  pdf_url          TEXT,
  xml_url          TEXT,
  ambiente         TEXT,
  emitted_at       TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,
  cancel_reason    TEXT,
  error_code       TEXT,
  error_message    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A referência é nossa e tem que ser única por oficina: é por ela que o
-- webhook da Notaas encontra a linha de volta.
CREATE UNIQUE INDEX IF NOT EXISTS idx_nfse_invoices_referencia
  ON nfse_invoices (workshop_id, referencia);

CREATE UNIQUE INDEX IF NOT EXISTS idx_nfse_invoices_invoice_id
  ON nfse_invoices (invoice_id)
  WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_nfse_invoices_transaction
  ON nfse_invoices (workshop_id, transaction_id);

CREATE INDEX IF NOT EXISTS idx_nfse_invoices_status
  ON nfse_invoices (workshop_id, status, created_at DESC);

ALTER TABLE nfse_invoices ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'nfse_invoices'
      AND policyname = 'nfse_invoices_select_own_workshop'
  ) THEN
    CREATE POLICY nfse_invoices_select_own_workshop
      ON nfse_invoices FOR SELECT TO authenticated
      USING (
        workshop_id IN (
          SELECT profiles.workshop_id FROM profiles WHERE profiles.id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'nfse_invoices'
      AND policyname = 'nfse_invoices_insert_own_workshop'
  ) THEN
    CREATE POLICY nfse_invoices_insert_own_workshop
      ON nfse_invoices FOR INSERT TO authenticated
      WITH CHECK (
        workshop_id IN (
          SELECT profiles.workshop_id FROM profiles WHERE profiles.id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'nfse_invoices'
      AND policyname = 'nfse_invoices_update_own_workshop'
  ) THEN
    CREATE POLICY nfse_invoices_update_own_workshop
      ON nfse_invoices FOR UPDATE TO authenticated
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
END $$;

-- Sem política de DELETE de propósito: nota fiscal emitida não se apaga, se
-- cancela. O cancelamento vira status 'cancelled' com a data e o motivo.
