-- ============================================================
-- Pré-cadastro de cliente: agendar sem ter os dados do cliente ainda.
-- Execute no Supabase → SQL Editor → Run.  Rollback: rollback/027_pre_cadastro_down.sql
--
-- Desenho, e por que é assim:
--   O caminho óbvio seria deixar clients.phone aceitar NULL. NÃO foi feito: telefone aparece em
--   36 lugares do código, e formatPhone/getWhatsAppUrl quebram com nulo. Em vez disso, o
--   pré-cadastro nasce com telefone VAZIO ('') e uma marca própria. String vazia é falsy no JS,
--   então os componentes que já testam `client.phone && ...` continuam corretos sem mudança.
--
--   Resultado: esta migration só ADICIONA duas colunas com valor padrão. Não altera nem remove
--   nada, não mexe em NOT NULL, e desfazer é derrubar as duas colunas.
--
-- Efeito em quem já existe: todas as 57 linhas de clients e 64 de vehicles ficam com
-- pre_cadastro = false, ou seja, exatamente como estão hoje.
-- ============================================================

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS pre_cadastro BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS pre_cadastro BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.clients.pre_cadastro IS
  'Cliente criado pela agenda sem dados completos. Vira false quando o cadastro é finalizado.';
COMMENT ON COLUMN public.vehicles.pre_cadastro IS
  'Veículo de marcação, criado junto do pré-cadastro. Vira false quando marca/modelo/placa são preenchidos.';

-- Listar "o que falta preencher" é a consulta que a tela de clientes faz, então ela ganha índice.
CREATE INDEX IF NOT EXISTS idx_clients_pre_cadastro
  ON public.clients (workshop_id) WHERE pre_cadastro;

CREATE INDEX IF NOT EXISTS idx_vehicles_pre_cadastro
  ON public.vehicles (client_id) WHERE pre_cadastro;

-- ⚠️ Nada muda no WhatsApp: whatsapp_enqueue() já ignora cliente sem telefone
-- (COALESCE(trim(phone),'') = ''), então pré-cadastro não recebe mensagem automática.
