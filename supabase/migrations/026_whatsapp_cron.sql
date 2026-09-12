-- ============================================================
-- Agendamento do disparo da fila de WhatsApp.
-- Execute DEPOIS da 025 e DEPOIS de publicar a Edge Function whatsapp-dispatch.
--
-- Roda a cada minuto, mas só chama a função quando existe mensagem vencida:
-- em oficina parada, o custo é uma consulta por minuto e nenhuma invocação.
--
-- ⚠️ URL e token saem do Vault, nunca do texto desta migration: este repositório é público.
-- Antes de rodar, criar os dois segredos (uma vez só):
--   select vault.create_secret('<url da função>',   'whatsapp_dispatch_url');
--   select vault.create_secret('<token gerado>',    'whatsapp_dispatch_token');
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.whatsapp_dispatch_tick()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_url   TEXT;
  v_token TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM whatsapp_outbox WHERE status = 'pendente' AND send_at <= NOW()
  ) THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'whatsapp_dispatch_url';
  SELECT decrypted_secret INTO v_token
    FROM vault.decrypted_secrets WHERE name = 'whatsapp_dispatch_token';

  IF v_url IS NULL OR v_token IS NULL THEN
    RAISE WARNING 'whatsapp: segredos do disparo ausentes no Vault';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object('content-type', 'application/json', 'x-dispatch-token', v_token),
    body    := '{}'::JSONB,
    timeout_milliseconds := 25000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_dispatch_tick() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('whatsapp-dispatch')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'whatsapp-dispatch');

SELECT cron.schedule('whatsapp-dispatch', '* * * * *', 'SELECT public.whatsapp_dispatch_tick()');
