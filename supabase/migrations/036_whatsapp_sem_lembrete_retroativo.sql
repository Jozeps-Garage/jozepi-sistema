-- Não manda confirmação nem lembrete para serviço lançado depois de feito.
-- Execute no Supabase → SQL Editor → Run. Requer a 025.
--
-- O gatilho original só pulava ordem 'cancelada', então cadastrar um serviço
-- que já tinha acontecido disparava "agendamento criado" e o lembrete, porque
-- para o gatilho aquilo era uma ordem nova como qualquer outra.

CREATE OR REPLACE FUNCTION public.handle_whatsapp_service_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz    TEXT;
  v_sched TIMESTAMPTZ;
BEGIN
  SELECT timezone INTO v_tz FROM workshops WHERE id = NEW.workshop_id;
  v_sched := CASE
    WHEN NEW.scheduled_date IS NULL THEN NULL
    ELSE (NEW.scheduled_date + COALESCE(NEW.scheduled_start, TIME '08:00'))
           AT TIME ZONE COALESCE(NULLIF(trim(v_tz), ''), 'America/Sao_Paulo')
  END;

  IF TG_OP = 'INSERT' THEN
    -- Ordem cujo horário já passou, ou que nasce finalizada, é lançamento
    -- retroativo de um serviço entregue — não é agendamento, e o cliente não
    -- pode receber nem confirmação nem lembrete de algo que já aconteceu.
    IF v_sched IS NOT NULL
       AND v_sched > NOW()
       AND NEW.status NOT IN ('cancelada', 'finalizada') THEN
      PERFORM whatsapp_enqueue(NEW.id, 'agendamento_criado', NOW());
      PERFORM whatsapp_enqueue(NEW.id, 'lembrete_vespera', v_sched);
    END IF;
    RETURN NULL;
  END IF;

  IF NEW.status = 'cancelada' AND OLD.status IS DISTINCT FROM 'cancelada' THEN
    PERFORM whatsapp_cancel_pending(NEW.id, NULL);
    PERFORM whatsapp_enqueue(NEW.id, 'agendamento_cancelado', NOW());

  ELSIF (NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date
         OR NEW.scheduled_start IS DISTINCT FROM OLD.scheduled_start)
        AND v_sched IS NOT NULL
        AND NEW.status <> 'cancelada' THEN
    PERFORM whatsapp_cancel_pending(NEW.id, 'lembrete_vespera');
    PERFORM whatsapp_enqueue(NEW.id, 'agendamento_reagendado', NOW());

    -- Mesma regra ao remarcar: data corrigida para trás não gera lembrete.
    IF v_sched > NOW() THEN
      PERFORM whatsapp_enqueue(NEW.id, 'lembrete_vespera', v_sched);
    END IF;
  END IF;

  IF NEW.status = 'finalizada' AND OLD.status IS DISTINCT FROM 'finalizada' THEN
    PERFORM whatsapp_cancel_pending(NEW.id, 'lembrete_vespera');
    PERFORM whatsapp_enqueue(NEW.id, 'pos_servico', COALESCE(NEW.completed_at, NOW()));
    PERFORM whatsapp_enqueue(NEW.id, 'manutencao', COALESCE(NEW.completed_at, NOW()));
  END IF;

  RETURN NULL;
END;
$$;

-- Limpa o que a versão antiga já tinha enfileirado e ainda não saiu:
-- lembrete de ordem cujo horário agendado já passou.
UPDATE whatsapp_outbox o
   SET status = 'cancelado'
  FROM service_orders so
  JOIN workshops w ON w.id = so.workshop_id
 WHERE so.id = o.service_order_id
   AND o.status = 'pendente'
   AND o.event = 'lembrete_vespera'
   AND so.scheduled_date IS NOT NULL
   AND (so.scheduled_date + COALESCE(so.scheduled_start, TIME '08:00'))
       AT TIME ZONE COALESCE(NULLIF(trim(w.timezone), ''), 'America/Sao_Paulo') < NOW();
