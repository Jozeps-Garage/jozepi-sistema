-- ============================================================
-- WhatsApp: conexão da oficina, fluxos de mensagem e fila de envio.
-- Execute no Supabase → SQL Editor → Run.  Rollback: rollback/025_whatsapp_down.sql
--
-- Desenho, em duas linhas:
--   O gatilho nasce AQUI, no banco, porque a tela grava direto no Supabase. Se dependesse da
--   tela avisar, todo caminho novo de gravação esqueceria de mandar mensagem.
--   Nada sai daqui: esta migration só ENFILEIRA. Quem envia é a Edge Function, pelo gateway.
--
-- Feita pra crescer (decisão de 2026-09-12):
--   * VÁRIOS fluxos por evento, não um só. A tela hoje usa um, o banco já aceita muitos.
--   * `conditions` (JSONB) por fluxo = critério de decisão, sem mudar schema pra cada regra nova.
--   * `cooldown_minutes` por fluxo + `min_gap_minutes` por oficina = anti-conflito entre fluxos.
--   * Evento novo é um valor a mais no enum, não uma tabela nova.
--
-- Seguro de aplicar com o sistema no ar: só cria coisa nova, e a fila fica parada enquanto
-- não houver (a) conexão criada pela oficina e (b) fluxo ativo.
-- As 105 ordens que já existem NÃO geram mensagem: os gatilhos só reagem a evento novo.
-- ============================================================

-- ------------------------------------------------------------
-- Tipos
-- ------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'whatsapp_event') THEN
    -- Evento novo no futuro: ALTER TYPE whatsapp_event ADD VALUE 'nome_do_evento';
    CREATE TYPE whatsapp_event AS ENUM (
      'agendamento_criado',
      'agendamento_reagendado',
      'agendamento_cancelado',
      'lembrete_vespera',
      'pos_servico',
      'manutencao'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'whatsapp_outbox_status') THEN
    -- 'incerto' = o envio deu timeout no gateway: pode ter saído. Não reenviar, revisar na mão.
    CREATE TYPE whatsapp_outbox_status AS ENUM (
      'pendente', 'enviando', 'enviado', 'falhou', 'cancelado', 'incerto'
    );
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- Cliente pode recusar receber. Sem isso não dá pra respeitar quem pediu pra parar.
-- ------------------------------------------------------------

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS whatsapp_opt_out BOOLEAN NOT NULL DEFAULT FALSE;

-- ------------------------------------------------------------
-- Ajustes por oficina: janela de envio e distância mínima entre mensagens pro mesmo cliente.
-- É aqui que mora o anti-flood que vale pra TODOS os fluxos juntos.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.whatsapp_settings (
  workshop_id      UUID PRIMARY KEY REFERENCES public.workshops(id) ON DELETE CASCADE,
  quiet_start      TIME NOT NULL DEFAULT '08:00',
  quiet_end        TIME NOT NULL DEFAULT '20:00',
  min_gap_minutes  INTEGER NOT NULL DEFAULT 60,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT whatsapp_settings_janela CHECK (quiet_start < quiet_end),
  CONSTRAINT whatsapp_settings_gap CHECK (min_gap_minutes BETWEEN 0 AND 10080)
);

-- ------------------------------------------------------------
-- Conexão da oficina (um número por oficina).
-- A verdade do estado é do gateway; aqui fica o último estado conhecido, pra tela não
-- depender de rede pra desenhar. A existência da linha é o "a oficina ativou o WhatsApp".
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.whatsapp_connections (
  workshop_id  UUID PRIMARY KEY REFERENCES public.workshops(id) ON DELETE CASCADE,
  phone        TEXT,
  state        TEXT NOT NULL DEFAULT 'missing'
                 CHECK (state IN ('missing', 'connecting', 'open', 'close')),
  connected_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- Fluxos. Um evento pode ter VÁRIOS (ex.: manutenção em 90 e em 180 dias, ou texto
-- diferente por categoria de serviço). `priority` decide a ordem de avaliação.
--
-- offset_minutes: ANTES do horário agendado no lembrete; DEPOIS da referência nos demais.
-- conditions:     {} = sempre. Chaves suportadas hoje em whatsapp_conditions_match().
-- cooldown_minutes: não repete ESTE fluxo pro mesmo cliente dentro da janela.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.whatsapp_flows (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id      UUID NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  event            whatsapp_event NOT NULL,
  name             TEXT NOT NULL DEFAULT 'padrão',
  body             TEXT NOT NULL,
  active           BOOLEAN NOT NULL DEFAULT FALSE,
  offset_minutes   INTEGER NOT NULL DEFAULT 0,
  conditions       JSONB NOT NULL DEFAULT '{}'::JSONB,
  cooldown_minutes INTEGER NOT NULL DEFAULT 0,
  priority         INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT whatsapp_flows_body_len CHECK (char_length(trim(body)) BETWEEN 1 AND 1000),
  CONSTRAINT whatsapp_flows_name_len CHECK (char_length(trim(name)) BETWEEN 1 AND 60),
  CONSTRAINT whatsapp_flows_offset_range CHECK (offset_minutes BETWEEN 0 AND 525600),
  CONSTRAINT whatsapp_flows_cooldown_range CHECK (cooldown_minutes BETWEEN 0 AND 525600),
  CONSTRAINT whatsapp_flows_conditions_obj CHECK (jsonb_typeof(conditions) = 'object'),
  -- Nome único por evento: dá pra ter vários fluxos no mesmo evento, sem dois com o mesmo nome.
  CONSTRAINT whatsapp_flows_unique_name UNIQUE (workshop_id, event, name)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_flows_lookup
  ON public.whatsapp_flows (workshop_id, event, priority DESC) WHERE active;

-- ------------------------------------------------------------
-- Fila de envio. É ela que segura tudo se o gateway ou a VPS estiverem fora:
-- a mensagem espera e sai depois, em vez de se perder.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.whatsapp_outbox (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id        UUID NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  client_id          UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  service_order_id   UUID REFERENCES public.service_orders(id) ON DELETE CASCADE,
  flow_id            UUID REFERENCES public.whatsapp_flows(id) ON DELETE SET NULL,
  event              whatsapp_event NOT NULL,
  phone              TEXT NOT NULL,
  body               TEXT NOT NULL,
  send_at            TIMESTAMPTZ NOT NULL,
  status             whatsapp_outbox_status NOT NULL DEFAULT 'pendente',
  attempts           INTEGER NOT NULL DEFAULT 0,
  last_error         TEXT,
  gateway_message_id TEXT,
  sent_at            TIMESTAMPTZ,
  -- Trava contra mensagem repetida: mesma ordem + mesmo fluxo + mesmo horário = uma linha só.
  dedupe_key         TEXT NOT NULL UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_outbox_due
  ON public.whatsapp_outbox (send_at) WHERE status = 'pendente';

CREATE INDEX IF NOT EXISTS idx_whatsapp_outbox_workshop
  ON public.whatsapp_outbox (workshop_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_outbox_order
  ON public.whatsapp_outbox (service_order_id) WHERE status = 'pendente';

-- Usado pelo anti-flood e pelo cooldown: "o que já foi mandado pra este cliente".
CREATE INDEX IF NOT EXISTS idx_whatsapp_outbox_client
  ON public.whatsapp_outbox (client_id, send_at DESC);

DROP TRIGGER IF EXISTS trg_whatsapp_settings_updated_at ON public.whatsapp_settings;
CREATE TRIGGER trg_whatsapp_settings_updated_at
  BEFORE UPDATE ON public.whatsapp_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS trg_whatsapp_connections_updated_at ON public.whatsapp_connections;
CREATE TRIGGER trg_whatsapp_connections_updated_at
  BEFORE UPDATE ON public.whatsapp_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS trg_whatsapp_flows_updated_at ON public.whatsapp_flows;
CREATE TRIGGER trg_whatsapp_flows_updated_at
  BEFORE UPDATE ON public.whatsapp_flows
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS trg_whatsapp_outbox_updated_at ON public.whatsapp_outbox;
CREATE TRIGGER trg_whatsapp_outbox_updated_at
  BEFORE UPDATE ON public.whatsapp_outbox
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- Texto: troca {{variavel}} pelo valor. Variável não preenchida some, em vez de
-- aparecer "{{placa}}" na mensagem do cliente.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.whatsapp_render(p_body TEXT, p_vars JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_out TEXT := p_body;
  v_key TEXT;
  v_val TEXT;
BEGIN
  FOR v_key, v_val IN SELECT key, COALESCE(value, '') FROM jsonb_each_text(p_vars) LOOP
    v_out := replace(v_out, '{{' || v_key || '}}', v_val);
  END LOOP;
  RETURN trim(regexp_replace(v_out, '\{\{[a-z_]+\}\}', '', 'g'));
END;
$$;

-- ------------------------------------------------------------
-- Critério de decisão do fluxo. É o ponto de extensão: regra nova = chave nova aqui,
-- sem tocar em tabela. Fluxo sem condição ({}) sempre passa.
--
-- Hoje entende:
--   {"categorias": ["estetica"]}        → só se a categoria do serviço estiver na lista
--   {"dias_semana": [1,2,3,4,5]}        → 1=segunda ... 7=domingo (do horário de envio)
--   {"valor_minimo": 300}               → só se a ordem passar desse valor
-- Chave desconhecida derruba o fluxo de propósito: melhor não enviar do que enviar errado.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.whatsapp_conditions_match(p_cond JSONB, p_ctx JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_key TEXT;
  v_val JSONB;
BEGIN
  IF p_cond IS NULL OR p_cond = '{}'::JSONB THEN RETURN TRUE; END IF;

  FOR v_key, v_val IN SELECT key, value FROM jsonb_each(p_cond) LOOP
    IF v_key = 'categorias' THEN
      IF NOT (p_ctx->>'categoria' IS NOT NULL
              AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_val) c
                           WHERE c = p_ctx->>'categoria')) THEN
        RETURN FALSE;
      END IF;

    ELSIF v_key = 'dias_semana' THEN
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_val) d
                      WHERE d = p_ctx->>'dia_semana') THEN
        RETURN FALSE;
      END IF;

    ELSIF v_key = 'valor_minimo' THEN
      IF COALESCE((p_ctx->>'valor')::NUMERIC, 0) < (v_val#>>'{}')::NUMERIC THEN
        RETURN FALSE;
      END IF;

    ELSE
      RETURN FALSE;
    END IF;
  END LOOP;

  RETURN TRUE;
END;
$$;

-- ------------------------------------------------------------
-- Janela de envio da oficina. Ninguém recebe mensagem de oficina às 3 da manhã
-- porque uma ordem foi fechada tarde.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.whatsapp_business_time(
  p_ts    TIMESTAMPTZ,
  p_tz    TEXT,
  p_start TIME DEFAULT '08:00',
  p_end   TIME DEFAULT '20:00'
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_tz    TEXT := COALESCE(NULLIF(trim(p_tz), ''), 'America/Sao_Paulo');
  v_local TIMESTAMP;
BEGIN
  v_local := p_ts AT TIME ZONE v_tz;
  IF v_local::TIME < p_start THEN
    v_local := date_trunc('day', v_local) + p_start;
  ELSIF v_local::TIME >= p_end THEN
    v_local := date_trunc('day', v_local) + INTERVAL '1 day' + p_start;
  END IF;
  RETURN v_local AT TIME ZONE v_tz;
END;
$$;

-- ------------------------------------------------------------
-- Enfileira. Concentra TODAS as recusas num lugar só: sem conexão, sem fluxo ativo,
-- sem telefone, cliente que pediu pra não receber, condição não batida, cooldown do
-- fluxo, horário que já passou. Se qualquer uma bater, não entra na fila.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.whatsapp_enqueue(
  p_order_id UUID,
  p_event    whatsapp_event,
  p_base     TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o        RECORD;
  f        RECORD;
  v_cfg    RECORD;
  v_when   TIMESTAMPTZ;
  v_body   TEXT;
  v_vars   JSONB;
  v_ctx    JSONB;
  v_ultima TIMESTAMPTZ;
BEGIN
  SELECT so.id, so.workshop_id, so.client_id, so.scheduled_date, so.scheduled_start,
         so.total_amount,
         c.name AS cliente, c.phone, c.whatsapp_opt_out,
         v.brand, v.model, v.plate,
         w.name AS oficina, w.timezone,
         (SELECT s.name FROM service_order_items soi
             JOIN services s ON s.id = soi.service_id
            WHERE soi.service_order_id = so.id ORDER BY soi.created_at LIMIT 1) AS servico,
         (SELECT s.category FROM service_order_items soi
             JOIN services s ON s.id = soi.service_id
            WHERE soi.service_order_id = so.id ORDER BY soi.created_at LIMIT 1) AS categoria
    INTO o
    FROM service_orders so
    JOIN clients c   ON c.id = so.client_id
    JOIN workshops w ON w.id = so.workshop_id
    LEFT JOIN vehicles v ON v.id = so.vehicle_id
   WHERE so.id = p_order_id;

  IF o.id IS NULL THEN RETURN; END IF;

  -- A oficina precisa ter ativado o WhatsApp alguma vez. Sem isso, nada é enfileirado
  -- (senão a fila encheria de mensagem velha antes de o recurso existir na prática).
  IF NOT EXISTS (SELECT 1 FROM whatsapp_connections WHERE workshop_id = o.workshop_id) THEN
    RETURN;
  END IF;

  IF o.whatsapp_opt_out OR COALESCE(trim(o.phone), '') = '' THEN RETURN; END IF;

  SELECT COALESCE(s.quiet_start, TIME '08:00') AS quiet_start,
         COALESCE(s.quiet_end,   TIME '20:00') AS quiet_end,
         COALESCE(s.min_gap_minutes, 60)       AS min_gap_minutes
    INTO v_cfg
    FROM (SELECT 1) x
    LEFT JOIN whatsapp_settings s ON s.workshop_id = o.workshop_id;

  v_vars := jsonb_build_object(
    'cliente', split_part(trim(o.cliente), ' ', 1),
    'cliente_completo', o.cliente,
    'veiculo', trim(COALESCE(o.brand, '') || ' ' || COALESCE(o.model, '')),
    'placa', COALESCE(o.plate, ''),
    'servico', COALESCE(o.servico, ''),
    'oficina', o.oficina,
    'data', CASE WHEN o.scheduled_date IS NULL THEN '' ELSE to_char(o.scheduled_date, 'DD/MM') END,
    'hora', CASE WHEN o.scheduled_start IS NULL THEN '' ELSE to_char(o.scheduled_start, 'HH24:MI') END
  );

  FOR f IN
    SELECT * FROM whatsapp_flows
     WHERE workshop_id = o.workshop_id AND event = p_event AND active
     ORDER BY priority DESC, created_at
  LOOP
    v_when := CASE
      WHEN p_event = 'lembrete_vespera' THEN p_base - make_interval(mins => f.offset_minutes)
      ELSE p_base + make_interval(mins => f.offset_minutes)
    END;

    -- Lembrete cujo horário já passou não serve pra nada (ordem criada em cima da hora).
    IF p_event = 'lembrete_vespera' AND v_when < NOW() - INTERVAL '5 minutes' THEN
      CONTINUE;
    END IF;

    v_when := whatsapp_business_time(GREATEST(v_when, NOW()), o.timezone,
                                     v_cfg.quiet_start, v_cfg.quiet_end);

    v_ctx := jsonb_build_object(
      'categoria', o.categoria,
      'valor', o.total_amount,
      'dia_semana', EXTRACT(ISODOW FROM v_when AT TIME ZONE COALESCE(o.timezone, 'America/Sao_Paulo'))::TEXT
    );
    IF NOT whatsapp_conditions_match(f.conditions, v_ctx) THEN CONTINUE; END IF;

    -- Cooldown do próprio fluxo: não repete pro mesmo cliente dentro da janela.
    IF f.cooldown_minutes > 0 AND EXISTS (
      SELECT 1 FROM whatsapp_outbox
       WHERE client_id = o.client_id AND flow_id = f.id
         AND status IN ('pendente', 'enviando', 'enviado')
         AND send_at > NOW() - make_interval(mins => f.cooldown_minutes)
    ) THEN
      CONTINUE;
    END IF;

    -- Anti-conflito entre fluxos: se o cliente já tem mensagem perto desse horário,
    -- esta vai pro fim da fila dele em vez de chegar colada na outra.
    IF v_cfg.min_gap_minutes > 0 THEN
      SELECT MAX(send_at) INTO v_ultima
        FROM whatsapp_outbox
       WHERE client_id = o.client_id
         AND status IN ('pendente', 'enviando', 'enviado')
         AND send_at BETWEEN v_when - make_interval(mins => v_cfg.min_gap_minutes)
                         AND v_when + make_interval(mins => v_cfg.min_gap_minutes);
      IF v_ultima IS NOT NULL THEN
        v_when := whatsapp_business_time(v_ultima + make_interval(mins => v_cfg.min_gap_minutes),
                                         o.timezone, v_cfg.quiet_start, v_cfg.quiet_end);
      END IF;
    END IF;

    v_body := whatsapp_render(f.body, v_vars);
    IF v_body = '' THEN CONTINUE; END IF;

    INSERT INTO whatsapp_outbox (
      workshop_id, client_id, service_order_id, flow_id, event, phone, body, send_at, dedupe_key
    ) VALUES (
      o.workshop_id, o.client_id, o.id, f.id, p_event, o.phone, v_body, v_when,
      p_order_id::TEXT || ':' || f.id::TEXT || ':' || to_char(v_when, 'YYYYMMDDHH24MI')
    )
    ON CONFLICT (dedupe_key) DO NOTHING;
  END LOOP;
END;
$$;

-- Cancela o que ainda não saiu (ordem cancelada, ou remarcada e o lembrete velho perdeu o sentido).
CREATE OR REPLACE FUNCTION public.whatsapp_cancel_pending(
  p_order_id UUID,
  p_event    whatsapp_event DEFAULT NULL
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE whatsapp_outbox
     SET status = 'cancelado'
   WHERE service_order_id = p_order_id
     AND status = 'pendente'
     AND (p_event IS NULL OR event = p_event);
$$;

-- ------------------------------------------------------------
-- O gatilho da agenda.
-- ------------------------------------------------------------

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
    IF v_sched IS NOT NULL AND NEW.status <> 'cancelada' THEN
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
    PERFORM whatsapp_enqueue(NEW.id, 'lembrete_vespera', v_sched);
  END IF;

  IF NEW.status = 'finalizada' AND OLD.status IS DISTINCT FROM 'finalizada' THEN
    PERFORM whatsapp_cancel_pending(NEW.id, 'lembrete_vespera');
    PERFORM whatsapp_enqueue(NEW.id, 'pos_servico', COALESCE(NEW.completed_at, NOW()));
    PERFORM whatsapp_enqueue(NEW.id, 'manutencao', COALESCE(NEW.completed_at, NOW()));
  END IF;

  RETURN NULL;
END;
$$;

-- AFTER: não interfere no que as triggers BEFORE já existentes fazem (completed_at, updated_at).
DROP TRIGGER IF EXISTS trg_whatsapp_service_order ON public.service_orders;
CREATE TRIGGER trg_whatsapp_service_order
  AFTER INSERT OR UPDATE ON public.service_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_whatsapp_service_order();

-- ------------------------------------------------------------
-- Fila: pegar lote e dar baixa. Só o service_role (Edge Function) executa.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.whatsapp_claim_batch(p_limit INTEGER DEFAULT 3)
RETURNS SETOF public.whatsapp_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Linha presa em "enviando" (a função morreu no meio) volta pra fila depois de 10 min.
  UPDATE whatsapp_outbox
     SET status = 'pendente'
   WHERE status = 'enviando' AND updated_at < NOW() - INTERVAL '10 minutes';

  RETURN QUERY
  UPDATE whatsapp_outbox o
     SET status = 'enviando', attempts = o.attempts + 1
   WHERE o.id IN (
     SELECT id FROM whatsapp_outbox
      WHERE status = 'pendente' AND send_at <= NOW()
      ORDER BY send_at
      FOR UPDATE SKIP LOCKED
      LIMIT p_limit
   )
  RETURNING o.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_settle(
  p_id         UUID,
  p_status     whatsapp_outbox_status,
  p_error      TEXT DEFAULT NULL,
  p_message_id TEXT DEFAULT NULL,
  p_retry_at   TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE whatsapp_outbox
     SET status  = p_status,
         last_error = p_error,
         gateway_message_id = COALESCE(p_message_id, gateway_message_id),
         sent_at = CASE WHEN p_status = 'enviado' THEN NOW() ELSE sent_at END,
         send_at = COALESCE(p_retry_at, send_at)
   WHERE id = p_id;
END;
$$;

-- ------------------------------------------------------------
-- RLS: mesmo padrão do resto do sistema (get_user_workshop_id()).
-- A fila é SÓ LEITURA pra tela: quem escreve nela é gatilho e Edge Function.
-- ------------------------------------------------------------

ALTER TABLE public.whatsapp_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_flows       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_outbox      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.whatsapp_settings, public.whatsapp_connections,
                    public.whatsapp_flows, public.whatsapp_outbox
  FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE ON TABLE public.whatsapp_settings TO authenticated;
GRANT SELECT ON TABLE public.whatsapp_connections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp_flows TO authenticated;
GRANT SELECT ON TABLE public.whatsapp_outbox TO authenticated;

DROP POLICY IF EXISTS whatsapp_settings_own_workshop ON public.whatsapp_settings;
CREATE POLICY whatsapp_settings_own_workshop
  ON public.whatsapp_settings FOR ALL TO authenticated
  USING (workshop_id = get_user_workshop_id())
  WITH CHECK (workshop_id = get_user_workshop_id());

DROP POLICY IF EXISTS whatsapp_connections_own_workshop ON public.whatsapp_connections;
CREATE POLICY whatsapp_connections_own_workshop
  ON public.whatsapp_connections FOR SELECT TO authenticated
  USING (workshop_id = get_user_workshop_id());

DROP POLICY IF EXISTS whatsapp_flows_own_workshop ON public.whatsapp_flows;
CREATE POLICY whatsapp_flows_own_workshop
  ON public.whatsapp_flows FOR ALL TO authenticated
  USING (workshop_id = get_user_workshop_id())
  WITH CHECK (workshop_id = get_user_workshop_id());

DROP POLICY IF EXISTS whatsapp_outbox_own_workshop ON public.whatsapp_outbox;
CREATE POLICY whatsapp_outbox_own_workshop
  ON public.whatsapp_outbox FOR SELECT TO authenticated
  USING (workshop_id = get_user_workshop_id());

REVOKE ALL ON FUNCTION public.whatsapp_claim_batch(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_settle(UUID, whatsapp_outbox_status, TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_claim_batch(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_settle(UUID, whatsapp_outbox_status, TEXT, TEXT, TIMESTAMPTZ)
  TO service_role;
