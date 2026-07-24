-- =====================================================================
-- FASE 2 — EVENTOS E AGREGADOS DE PRODUTO
-- Meu Nino Control Center
-- =====================================================================

-- Enum para faixa de valor (bucket) — nunca armazenamos o valor exato
DO $$ BEGIN
  CREATE TYPE public.value_bucket AS ENUM ('0_50','50_100','100_250','250_500','500_plus');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Enum para origem do evento
DO $$ BEGIN
  CREATE TYPE public.event_source AS ENUM ('live','backfill','backfill_proxy');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- 1) Catálogo de tipos de evento permitidos (allowlist)
-- ---------------------------------------------------------------------
CREATE TABLE public.product_event_types (
  event_name text PRIMARY KEY,
  category text NOT NULL, -- entry|goal|split|reminder|ocr|agent|whatsapp|insight
  requires_value_bucket boolean NOT NULL DEFAULT false,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.product_event_types TO authenticated;
GRANT ALL ON public.product_event_types TO service_role;

ALTER TABLE public.product_event_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pet_read_admins" ON public.product_event_types
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- Semeadura da allowlist canônica
INSERT INTO public.product_event_types (event_name, category, requires_value_bucket, description) VALUES
  ('financial_entry_created', 'entry', true,  'Lançamento financeiro criado'),
  ('financial_entry_edited',  'entry', false, 'Lançamento financeiro editado'),
  ('financial_entry_categorized', 'entry', false, 'Categoria atribuída ou revisada'),
  ('goal_created',            'goal',  false, 'Meta criada'),
  ('goal_progress_recorded',  'goal',  true,  'Aporte ou progresso registrado'),
  ('split_created',           'split', false, 'Divisão do rolê criada'),
  ('split_participant_paid',  'split', true,  'Participante marcou como pago'),
  ('split_reminder_scheduled','split', false, 'Lembrete de split agendado'),
  ('ocr_document_uploaded',   'ocr',   false, 'Documento enviado para OCR'),
  ('ocr_document_confirmed',  'ocr',   false, 'Extração de documento confirmada'),
  ('agent_response_delivered','agent', false, 'Resposta do assessor entregue'),
  ('insight_delivered',       'insight', false, 'Insight contextual entregue'),
  ('forecast_delivered',      'insight', false, 'Previsão financeira entregue'),
  ('personalized_response_delivered', 'agent', false, 'Resposta personalizada entregue'),
  ('goal_progress_explained', 'goal',  false, 'Progresso de meta explicado'),
  ('split_result_delivered',  'split', false, 'Resultado de split entregue'),
  ('split_reminder_prepared', 'split', false, 'Lembrete de split preparado'),
  ('whatsapp_message_sent',   'whatsapp', false, 'Mensagem enviada no WhatsApp'),
  ('whatsapp_message_delivered', 'whatsapp', false, 'Mensagem confirmada como entregue'),
  ('whatsapp_message_read',   'whatsapp', false, 'Mensagem lida pelo usuário')
ON CONFLICT (event_name) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2) Tabela append-only de eventos
-- ---------------------------------------------------------------------
CREATE TABLE public.product_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pseudo_id uuid NOT NULL,
  event_name text NOT NULL REFERENCES public.product_event_types(event_name),
  event_source public.event_source NOT NULL DEFAULT 'live',
  value_bucket public.value_bucket,
  feature text, -- allowlist: entry|goal|split|reminder|ocr|agent|whatsapp
  surface text CHECK (surface IN ('app','whatsapp','admin','system')),
  outcome text CHECK (outcome IN ('success','failure','partial')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX product_events_idem_uniq ON public.product_events (idempotency_key);
CREATE INDEX product_events_occurred_idx ON public.product_events (occurred_at DESC);
CREATE INDEX product_events_pseudo_idx ON public.product_events (pseudo_id, occurred_at DESC);
CREATE INDEX product_events_name_idx ON public.product_events (event_name, occurred_at DESC);
CREATE INDEX product_events_feature_idx ON public.product_events (feature, occurred_at DESC);

GRANT ALL ON public.product_events TO service_role;
-- authenticated NÃO tem grant direto: leitura só via admin_v2_* SECURITY DEFINER

ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY;

-- Sem policies para authenticated: nenhum SELECT direto do cliente.
-- service_role bypassa RLS.

-- Trigger de validação: allowlist + regras de bucket + append-only
CREATE OR REPLACE FUNCTION public.validate_product_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requires_bucket boolean;
BEGIN
  -- Bloqueia UPDATE/DELETE (append-only)
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'product_events is append-only (op=%)', TG_OP;
  END IF;

  -- Valida allowlist
  SELECT requires_value_bucket INTO v_requires_bucket
  FROM public.product_event_types
  WHERE event_name = NEW.event_name;

  IF v_requires_bucket IS NULL THEN
    RAISE EXCEPTION 'event_name % not in allowlist', NEW.event_name;
  END IF;

  IF v_requires_bucket AND NEW.value_bucket IS NULL THEN
    RAISE EXCEPTION 'event % requires value_bucket', NEW.event_name;
  END IF;

  -- pseudo_id precisa existir
  IF NOT EXISTS (SELECT 1 FROM public.user_pseudonyms WHERE pseudo_id = NEW.pseudo_id) THEN
    RAISE EXCEPTION 'pseudo_id % not found', NEW.pseudo_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER product_events_validate
  BEFORE INSERT OR UPDATE OR DELETE ON public.product_events
  FOR EACH ROW EXECUTE FUNCTION public.validate_product_event();

-- ---------------------------------------------------------------------
-- 3) Tabelas de agregados (6)
-- ---------------------------------------------------------------------
-- Todas sem PII, sem policies para authenticated (leitura via admin_v2_*).

CREATE TABLE public.product_daily_value (
  day date NOT NULL,
  wvu_count integer NOT NULL DEFAULT 0,         -- weekly value users no fim do dia (rolling 7d)
  activated_count integer NOT NULL DEFAULT 0,
  value_delivered_count integer NOT NULL DEFAULT 0,
  significant_entry_users integer NOT NULL DEFAULT 0,
  sample_size integer NOT NULL DEFAULT 0,
  formula_version text NOT NULL DEFAULT 'v1',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day)
);
GRANT ALL ON public.product_daily_value TO service_role;
ALTER TABLE public.product_daily_value ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.outbound_metrics_daily (
  day date NOT NULL,
  surface text NOT NULL,       -- app|whatsapp
  feature text NOT NULL,
  sent integer NOT NULL DEFAULT 0,
  delivered integer NOT NULL DEFAULT 0,
  read integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, surface, feature)
);
GRANT ALL ON public.outbound_metrics_daily TO service_role;
ALTER TABLE public.outbound_metrics_daily ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.agent_metrics_daily (
  day date NOT NULL,
  surface text NOT NULL,       -- app|whatsapp
  runs integer NOT NULL DEFAULT 0,
  runs_ok integer NOT NULL DEFAULT 0,
  runs_error integer NOT NULL DEFAULT 0,
  tokens_in bigint NOT NULL DEFAULT 0,
  tokens_out bigint NOT NULL DEFAULT 0,
  cost_cents bigint NOT NULL DEFAULT 0,
  latency_ms_p50 integer,
  latency_ms_p95 integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, surface)
);
GRANT ALL ON public.agent_metrics_daily TO service_role;
ALTER TABLE public.agent_metrics_daily ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.feature_funnel_daily (
  day date NOT NULL,
  feature text NOT NULL,
  step text NOT NULL,          -- initiated|completed|value_delivered
  users integer NOT NULL DEFAULT 0,
  events integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, feature, step)
);
GRANT ALL ON public.feature_funnel_daily TO service_role;
ALTER TABLE public.feature_funnel_daily ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.product_cohorts_weekly (
  cohort_week date NOT NULL,   -- semana de ativação (segunda)
  reference_week date NOT NULL,-- semana observada
  activated_users integer NOT NULL DEFAULT 0,
  retained_users integer NOT NULL DEFAULT 0,
  week_offset integer NOT NULL,-- 0,1,2,4,8
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cohort_week, reference_week)
);
GRANT ALL ON public.product_cohorts_weekly TO service_role;
ALTER TABLE public.product_cohorts_weekly ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_lifecycle_daily (
  day date NOT NULL,
  new_users integer NOT NULL DEFAULT 0,
  active_users integer NOT NULL DEFAULT 0,
  dormant_users integer NOT NULL DEFAULT 0,
  churned_users integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day)
);
GRANT ALL ON public.user_lifecycle_daily TO service_role;
ALTER TABLE public.user_lifecycle_daily ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 4) Função de bucket helper
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.amount_to_bucket(_amount numeric)
RETURNS public.value_bucket
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN _amount IS NULL THEN NULL
    WHEN _amount < 50 THEN '0_50'::public.value_bucket
    WHEN _amount < 100 THEN '50_100'::public.value_bucket
    WHEN _amount < 250 THEN '100_250'::public.value_bucket
    WHEN _amount < 500 THEN '250_500'::public.value_bucket
    ELSE '500_plus'::public.value_bucket
  END
$$;

-- ---------------------------------------------------------------------
-- 5) Refresh incremental / full
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_product_aggregates_full(_days integer DEFAULT 3)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from date := (now() AT TIME ZONE 'America/Sao_Paulo')::date - _days;
  v_to date   := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  -- product_daily_value
  DELETE FROM public.product_daily_value WHERE day BETWEEN v_from AND v_to;
  INSERT INTO public.product_daily_value (day, wvu_count, activated_count, value_delivered_count, significant_entry_users, sample_size)
  SELECT
    d::date AS day,
    -- WVU rolling 7d: usuários com evento significativo E de valor entregue
    (SELECT COUNT(DISTINCT e.pseudo_id) FROM public.product_events e
      WHERE e.occurred_at >= (d::date - 6) AND e.occurred_at < (d::date + 1)
        AND e.pseudo_id IN (
          SELECT pseudo_id FROM public.product_events
          WHERE occurred_at >= (d::date - 6) AND occurred_at < (d::date + 1)
            AND event_name IN ('financial_entry_created','goal_progress_recorded','split_participant_paid')
        )
        AND e.pseudo_id IN (
          SELECT pseudo_id FROM public.product_events
          WHERE occurred_at >= (d::date - 6) AND occurred_at < (d::date + 1)
            AND event_name IN ('insight_delivered','forecast_delivered','personalized_response_delivered',
                               'goal_progress_explained','split_result_delivered','split_reminder_prepared',
                               'agent_response_delivered')
        )
    ) AS wvu_count,
    (SELECT COUNT(DISTINCT pseudo_id) FROM public.product_events
      WHERE occurred_at::date = d::date
        AND event_name IN ('financial_entry_created','goal_created','split_created')) AS activated_count,
    (SELECT COUNT(*) FROM public.product_events
      WHERE occurred_at::date = d::date
        AND event_name IN ('insight_delivered','forecast_delivered','personalized_response_delivered',
                           'goal_progress_explained','split_result_delivered','agent_response_delivered')) AS value_delivered_count,
    (SELECT COUNT(DISTINCT pseudo_id) FROM public.product_events
      WHERE occurred_at::date = d::date
        AND event_name = 'financial_entry_created'
        AND value_bucket IN ('100_250','250_500','500_plus')) AS significant_entry_users,
    (SELECT COUNT(DISTINCT pseudo_id) FROM public.product_events
      WHERE occurred_at::date = d::date) AS sample_size
  FROM generate_series(v_from, v_to, '1 day'::interval) d;

  -- outbound_metrics_daily (usa outbound_messages para métricas técnicas — não expõe PII)
  DELETE FROM public.outbound_metrics_daily WHERE day BETWEEN v_from AND v_to;
  INSERT INTO public.outbound_metrics_daily (day, surface, feature, sent, delivered, read, failed)
  SELECT
    (created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
    COALESCE(channel, 'unknown') AS surface,
    COALESCE(feature, 'unknown') AS feature,
    COUNT(*) FILTER (WHERE sent_at IS NOT NULL) AS sent,
    COUNT(*) FILTER (WHERE delivered_at IS NOT NULL) AS delivered,
    COUNT(*) FILTER (WHERE read_at IS NOT NULL) AS read,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed
  FROM public.outbound_messages
  WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
  GROUP BY 1,2,3;

  -- agent_metrics_daily
  DELETE FROM public.agent_metrics_daily WHERE day BETWEEN v_from AND v_to;
  INSERT INTO public.agent_metrics_daily (day, surface, runs, runs_ok, runs_error, tokens_in, tokens_out, cost_cents, latency_ms_p50, latency_ms_p95)
  SELECT
    (started_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
    COALESCE(path, 'unknown') AS surface,
    COUNT(*) AS runs,
    COUNT(*) FILTER (WHERE status = 'done') AS runs_ok,
    COUNT(*) FILTER (WHERE status = 'error') AS runs_error,
    COALESCE(SUM(tokens_in), 0) AS tokens_in,
    COALESCE(SUM(tokens_out), 0) AS tokens_out,
    COALESCE(SUM(cost_cents), 0) AS cost_cents,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)::int AS p50,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::int AS p95
  FROM public.agent_runs
  WHERE (started_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
  GROUP BY 1,2;

  -- feature_funnel_daily
  DELETE FROM public.feature_funnel_daily WHERE day BETWEEN v_from AND v_to;
  INSERT INTO public.feature_funnel_daily (day, feature, step, users, events)
  SELECT
    (occurred_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
    COALESCE(feature, 'unknown') AS feature,
    CASE
      WHEN event_name IN ('ocr_document_uploaded','split_created','goal_created') THEN 'initiated'
      WHEN event_name IN ('ocr_document_confirmed','split_participant_paid','goal_progress_recorded','financial_entry_created') THEN 'completed'
      WHEN event_name IN ('insight_delivered','forecast_delivered','personalized_response_delivered',
                          'goal_progress_explained','split_result_delivered','agent_response_delivered') THEN 'value_delivered'
      ELSE 'other'
    END AS step,
    COUNT(DISTINCT pseudo_id) AS users,
    COUNT(*) AS events
  FROM public.product_events
  WHERE (occurred_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
  GROUP BY 1,2,3;

  -- user_lifecycle_daily
  DELETE FROM public.user_lifecycle_daily WHERE day BETWEEN v_from AND v_to;
  INSERT INTO public.user_lifecycle_daily (day, new_users, active_users, dormant_users, churned_users)
  SELECT
    d::date AS day,
    (SELECT COUNT(*) FROM public.user_pseudonyms up
      JOIN auth.users u ON u.id = up.user_id
      WHERE u.created_at::date = d::date) AS new_users,
    (SELECT COUNT(DISTINCT pseudo_id) FROM public.product_events
      WHERE occurred_at::date = d::date) AS active_users,
    (SELECT COUNT(DISTINCT up.pseudo_id) FROM public.user_pseudonyms up
      WHERE NOT EXISTS (SELECT 1 FROM public.product_events e
        WHERE e.pseudo_id = up.pseudo_id AND e.occurred_at >= (d::date - 13) AND e.occurred_at < (d::date + 1))
      AND EXISTS (SELECT 1 FROM public.product_events e
        WHERE e.pseudo_id = up.pseudo_id AND e.occurred_at < (d::date - 13))) AS dormant_users,
    (SELECT COUNT(DISTINCT up.pseudo_id) FROM public.user_pseudonyms up
      WHERE NOT EXISTS (SELECT 1 FROM public.product_events e
        WHERE e.pseudo_id = up.pseudo_id AND e.occurred_at >= (d::date - 29) AND e.occurred_at < (d::date + 1))
      AND EXISTS (SELECT 1 FROM public.product_events e
        WHERE e.pseudo_id = up.pseudo_id AND e.occurred_at < (d::date - 29))) AS churned_users
  FROM generate_series(v_from, v_to, '1 day'::interval) d;

  -- Heartbeat
  INSERT INTO public.job_heartbeats (job_key, last_run_at, last_ok, processed, updated_at)
  VALUES ('product_aggregates_full', now(), true, _days, now())
  ON CONFLICT (job_key) DO UPDATE
  SET last_run_at = EXCLUDED.last_run_at, last_ok = true, processed = EXCLUDED.processed, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_product_aggregates_incremental()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Janela de 1 dia (hoje) — full-refresh do dia corrente
  PERFORM public.refresh_product_aggregates_full(1);
  INSERT INTO public.job_heartbeats (job_key, last_run_at, last_ok, processed, updated_at)
  VALUES ('product_aggregates_incremental', now(), true, 1, now())
  ON CONFLICT (job_key) DO UPDATE
  SET last_run_at = EXCLUDED.last_run_at, last_ok = true, processed = EXCLUDED.processed, updated_at = now();
END;
$$;

-- ---------------------------------------------------------------------
-- 6) Backfill determinístico a partir de dados existentes
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.backfill_product_events_from_history(_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from timestamptz := now() - make_interval(days => _days);
  v_inserted_total int := 0;
  v_step int;
BEGIN
  -- transactions -> financial_entry_created (backfill)
  INSERT INTO public.product_events (pseudo_id, event_name, event_source, value_bucket, feature, surface, outcome, occurred_at, idempotency_key)
  SELECT
    up.pseudo_id,
    'financial_entry_created',
    'backfill'::public.event_source,
    public.amount_to_bucket(t.amount),
    'entry',
    'app',
    'success',
    t.created_at,
    'bf:txn:'|| t.id::text
  FROM public.transactions t
  JOIN public.user_pseudonyms up ON up.user_id = t.user_id
  WHERE t.created_at >= v_from
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_inserted_total := v_inserted_total + v_step;

  -- document_imports -> ocr_document_uploaded / confirmed
  INSERT INTO public.product_events (pseudo_id, event_name, event_source, feature, surface, outcome, occurred_at, idempotency_key)
  SELECT up.pseudo_id, 'ocr_document_uploaded', 'backfill', 'ocr', 'app', 'success', di.created_at, 'bf:doc_up:'||di.id::text
  FROM public.document_imports di
  JOIN public.user_pseudonyms up ON up.user_id = di.user_id
  WHERE di.created_at >= v_from
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_inserted_total := v_inserted_total + v_step;

  INSERT INTO public.product_events (pseudo_id, event_name, event_source, feature, surface, outcome, occurred_at, idempotency_key)
  SELECT up.pseudo_id, 'ocr_document_confirmed', 'backfill', 'ocr', 'app', 'success', di.created_at, 'bf:doc_ok:'||di.id::text
  FROM public.document_imports di
  JOIN public.user_pseudonyms up ON up.user_id = di.user_id
  WHERE di.created_at >= v_from AND di.status IN ('confirmed','completed')
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_inserted_total := v_inserted_total + v_step;

  -- goals -> goal_created
  INSERT INTO public.product_events (pseudo_id, event_name, event_source, feature, surface, outcome, occurred_at, idempotency_key)
  SELECT up.pseudo_id, 'goal_created', 'backfill', 'goal', 'app', 'success', g.created_at, 'bf:goal:'||g.id::text
  FROM public.goals g
  JOIN public.user_pseudonyms up ON up.user_id = g.user_id
  WHERE g.created_at >= v_from
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_inserted_total := v_inserted_total + v_step;

  -- shared_expenses -> split_created
  INSERT INTO public.product_events (pseudo_id, event_name, event_source, feature, surface, outcome, occurred_at, idempotency_key)
  SELECT up.pseudo_id, 'split_created', 'backfill', 'split', 'app', 'success', se.created_at, 'bf:split:'||se.id::text
  FROM public.shared_expenses se
  JOIN public.user_pseudonyms up ON up.user_id = se.owner_user_id
  WHERE se.created_at >= v_from
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_inserted_total := v_inserted_total + v_step;

  -- agent_runs -> agent_response_delivered (proxy — sucesso não é garantido só por status=done)
  INSERT INTO public.product_events (pseudo_id, event_name, event_source, feature, surface, outcome, occurred_at, idempotency_key)
  SELECT up.pseudo_id, 'agent_response_delivered', 'backfill_proxy', 'agent',
         CASE WHEN ar.path = 'whatsapp' THEN 'whatsapp' ELSE 'app' END,
         CASE WHEN ar.status = 'done' THEN 'success' WHEN ar.status = 'error' THEN 'failure' ELSE 'partial' END,
         ar.started_at, 'bf:run:'||ar.id::text
  FROM public.agent_runs ar
  JOIN public.user_pseudonyms up ON up.user_id = ar.user_id
  WHERE ar.started_at >= v_from
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_inserted_total := v_inserted_total + v_step;

  -- outbound_messages -> whatsapp_message_sent / delivered / read
  INSERT INTO public.product_events (pseudo_id, event_name, event_source, feature, surface, outcome, occurred_at, idempotency_key)
  SELECT up.pseudo_id, 'whatsapp_message_sent', 'backfill', COALESCE(om.feature,'agent'), 'whatsapp', 'success', COALESCE(om.sent_at, om.created_at), 'bf:om_s:'||om.id::text
  FROM public.outbound_messages om
  JOIN public.user_pseudonyms up ON up.user_id = om.user_id
  WHERE om.created_at >= v_from AND om.sent_at IS NOT NULL AND om.channel = 'whatsapp'
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_inserted_total := v_inserted_total + v_step;

  INSERT INTO public.product_events (pseudo_id, event_name, event_source, feature, surface, outcome, occurred_at, idempotency_key)
  SELECT up.pseudo_id, 'whatsapp_message_delivered', 'backfill', COALESCE(om.feature,'agent'), 'whatsapp', 'success', om.delivered_at, 'bf:om_d:'||om.id::text
  FROM public.outbound_messages om
  JOIN public.user_pseudonyms up ON up.user_id = om.user_id
  WHERE om.created_at >= v_from AND om.delivered_at IS NOT NULL AND om.channel = 'whatsapp'
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_inserted_total := v_inserted_total + v_step;

  INSERT INTO public.product_events (pseudo_id, event_name, event_source, feature, surface, outcome, occurred_at, idempotency_key)
  SELECT up.pseudo_id, 'whatsapp_message_read', 'backfill', COALESCE(om.feature,'agent'), 'whatsapp', 'success', om.read_at, 'bf:om_r:'||om.id::text
  FROM public.outbound_messages om
  JOIN public.user_pseudonyms up ON up.user_id = om.user_id
  WHERE om.created_at >= v_from AND om.read_at IS NOT NULL AND om.channel = 'whatsapp'
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_inserted_total := v_inserted_total + v_step;

  RETURN jsonb_build_object('inserted', v_inserted_total, 'days', _days, 'ran_at', now());
END;
$$;

-- ---------------------------------------------------------------------
-- 7) Retenção — poda de eventos brutos (agregados são perpétuos)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prune_product_events(_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int;
BEGIN
  -- Bypass do trigger append-only usando session_replication_role apenas para prune (owner)
  SET LOCAL session_replication_role = replica;
  DELETE FROM public.product_events WHERE occurred_at < now() - make_interval(days => _days);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  SET LOCAL session_replication_role = origin;
  RETURN v_deleted;
END;
$$;

-- ---------------------------------------------------------------------
-- 8) Registros iniciais de heartbeat
-- ---------------------------------------------------------------------
INSERT INTO public.job_heartbeats (job_key, last_run_at, last_ok, processed, updated_at)
VALUES
  ('product_aggregates_incremental', NULL, NULL, 0, now()),
  ('product_aggregates_full',        NULL, NULL, 0, now()),
  ('product_events_prune',           NULL, NULL, 0, now())
ON CONFLICT (job_key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 9) Grants finais para as funções (execute) — apenas service_role/admin usam
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.refresh_product_aggregates_full(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_product_aggregates_incremental() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backfill_product_events_from_history(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prune_product_events(integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.refresh_product_aggregates_full(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_product_aggregates_incremental() TO service_role;
GRANT EXECUTE ON FUNCTION public.backfill_product_events_from_history(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_product_events(integer) TO service_role;