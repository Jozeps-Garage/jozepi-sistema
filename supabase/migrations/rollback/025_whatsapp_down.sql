-- ============================================================
-- DESFAZ as migrations 025 e 026 (WhatsApp). Execute no SQL Editor.
--
-- Volta o banco exatamente ao formato anterior: a 025 só ADICIONOU coisa, então desfazer
-- é derrubar o que ela criou. Nenhuma tabela antiga é tocada aqui.
--
-- ⚠️ O que se perde (tudo nasceu com a 025): fluxos cadastrados, fila de mensagens,
-- histórico de envio e a marcação whatsapp_opt_out dos clientes.
-- ⚠️ Mensagem já enviada não volta atrás. Pra PARAR sem desfazer nada, o caminho é:
--      UPDATE whatsapp_flows SET active = FALSE;   -- nenhum fluxo novo enfileira
--      UPDATE whatsapp_outbox SET status = 'cancelado' WHERE status = 'pendente';
-- ============================================================

-- 026: agendamento
SELECT cron.unschedule('whatsapp-dispatch')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'whatsapp-dispatch');

DROP FUNCTION IF EXISTS public.whatsapp_dispatch_tick();

-- As extensões pg_cron e pg_net ficam instaladas de propósito: são inofensivas paradas,
-- e outra coisa no projeto pode passar a usar. Pra remover mesmo:
--   DROP EXTENSION IF EXISTS pg_net;  DROP EXTENSION IF EXISTS pg_cron;

-- 025: gatilho primeiro, pra nada mais entrar na fila enquanto o resto cai
DROP TRIGGER IF EXISTS trg_whatsapp_service_order ON public.service_orders;
DROP FUNCTION IF EXISTS public.handle_whatsapp_service_order();

DROP FUNCTION IF EXISTS public.whatsapp_claim_batch(INTEGER);
DROP FUNCTION IF EXISTS public.whatsapp_settle(UUID, whatsapp_outbox_status, TEXT, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.whatsapp_enqueue(UUID, whatsapp_event, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.whatsapp_cancel_pending(UUID, whatsapp_event);
DROP FUNCTION IF EXISTS public.whatsapp_conditions_match(JSONB, JSONB);
DROP FUNCTION IF EXISTS public.whatsapp_business_time(TIMESTAMPTZ, TEXT, TIME, TIME);
DROP FUNCTION IF EXISTS public.whatsapp_render(TEXT, JSONB);

DROP TABLE IF EXISTS public.whatsapp_outbox;
DROP TABLE IF EXISTS public.whatsapp_flows;
DROP TABLE IF EXISTS public.whatsapp_connections;
DROP TABLE IF EXISTS public.whatsapp_settings;

DROP TYPE IF EXISTS whatsapp_outbox_status;
DROP TYPE IF EXISTS whatsapp_event;

ALTER TABLE public.clients DROP COLUMN IF EXISTS whatsapp_opt_out;
