-- nino_change_agent.v1 + admin hardening

CREATE TABLE IF NOT EXISTS public.nino_change_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  dedup_key text NOT NULL,
  source text NOT NULL DEFAULT 'chat',
  behavior_wealth_version text,
  stage text NOT NULL,
  stage_reason text,
  confidence numeric NOT NULL DEFAULT 0,
  title text NOT NULL,
  detail text,
  route text,
  amount numeric,
  amount_role text,
  goal_id uuid,
  goal_name text,
  financial_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  truth_gate jsonb NOT NULL DEFAULT '{}'::jsonb,
  behavior_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  principles jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'proposed',
  accepted_at timestamptz,
  superseded_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedup_key)
);
GRANT SELECT ON public.nino_change_recommendations TO authenticated;
GRANT ALL ON public.nino_change_recommendations TO service_role;
ALTER TABLE public.nino_change_recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own change recommendations" ON public.nino_change_recommendations;
CREATE POLICY "own change recommendations" ON public.nino_change_recommendations
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.nino_change_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  recommendation_id uuid REFERENCES public.nino_change_recommendations(id) ON DELETE SET NULL,
  stage text NOT NULL,
  title text NOT NULL,
  detail text,
  route text,
  target_amount numeric,
  target_amount_role text,
  goal_id uuid,
  goal_name text,
  baseline_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  baseline_truth_gate jsonb NOT NULL DEFAULT '{}'::jsonb,
  principles jsonb NOT NULL DEFAULT '[]'::jsonb,
  strategy text NOT NULL DEFAULT 'reinforce',
  status text NOT NULL DEFAULT 'active',
  accepted_at timestamptz NOT NULL DEFAULT now(),
  cadence_days integer NOT NULL DEFAULT 7,
  next_check_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  last_check_at timestamptz,
  last_progress_score numeric,
  dismissals integer NOT NULL DEFAULT 0,
  ended_at timestamptz,
  end_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.nino_change_commitments TO authenticated;
GRANT ALL ON public.nino_change_commitments TO service_role;
ALTER TABLE public.nino_change_commitments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own change commitments" ON public.nino_change_commitments;
CREATE POLICY "own change commitments" ON public.nino_change_commitments
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS nino_change_commitments_active_idx
  ON public.nino_change_commitments (user_id, status, next_check_at);

CREATE TABLE IF NOT EXISTS public.nino_change_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  commitment_id uuid NOT NULL REFERENCES public.nino_change_commitments(id) ON DELETE CASCADE,
  outcome text NOT NULL,
  progress_score numeric NOT NULL DEFAULT 0,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'proactive_governor',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.nino_change_checkins TO authenticated;
GRANT ALL ON public.nino_change_checkins TO service_role;
ALTER TABLE public.nino_change_checkins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own change checkins" ON public.nino_change_checkins;
CREATE POLICY "own change checkins" ON public.nino_change_checkins
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.nino_learning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL,
  source text NOT NULL,
  signal text NOT NULL,
  subject_key text,
  confidence numeric NOT NULL DEFAULT 0.8,
  weight numeric NOT NULL DEFAULT 1,
  before_value jsonb,
  after_value jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied boolean NOT NULL DEFAULT true,
  applied_at timestamptz,
  dedup_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.nino_learning_events TO authenticated;
GRANT ALL ON public.nino_learning_events TO service_role;
ALTER TABLE public.nino_learning_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own learning events" ON public.nino_learning_events;
CREATE POLICY "own learning events" ON public.nino_learning_events
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE UNIQUE INDEX IF NOT EXISTS nino_learning_events_dedup_idx
  ON public.nino_learning_events (user_id, dedup_key) WHERE dedup_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS nino_learning_events_recent_idx
  ON public.nino_learning_events (user_id, occurred_at DESC);

DROP TRIGGER IF EXISTS touch_nino_change_recommendations ON public.nino_change_recommendations;
CREATE TRIGGER touch_nino_change_recommendations BEFORE UPDATE ON public.nino_change_recommendations
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();
DROP TRIGGER IF EXISTS touch_nino_change_commitments ON public.nino_change_commitments;
CREATE TRIGGER touch_nino_change_commitments BEFORE UPDATE ON public.nino_change_commitments
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

-- Fim do teto escondido de mensagens proativas.
ALTER TABLE public.proactive_global_limits DROP CONSTRAINT IF EXISTS proactive_global_limits_day_range;
ALTER TABLE public.proactive_global_limits DROP CONSTRAINT IF EXISTS proactive_global_limits_week_range;
ALTER TABLE public.proactive_global_limits
  ADD CONSTRAINT proactive_global_limits_day_range CHECK (max_per_day >= 0);
ALTER TABLE public.proactive_global_limits
  ADD CONSTRAINT proactive_global_limits_week_range CHECK (max_per_week >= 0);

CREATE OR REPLACE FUNCTION public.admin_proactive_limits_update(_max_per_day integer, _max_per_week integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_day int := greatest(0, coalesce(_max_per_day, 1));
        v_week int := greatest(0, coalesce(_max_per_week, 3));
BEGIN
  PERFORM public._require_perm('messaging.write');

  INSERT INTO public.proactive_global_limits (id, max_per_day, max_per_week, updated_at, updated_by)
  VALUES (true, v_day, v_week, now(), auth.uid())
  ON CONFLICT (id) DO UPDATE
    SET max_per_day = excluded.max_per_day,
        max_per_week = excluded.max_per_week,
        updated_at = now(),
        updated_by = excluded.updated_by;

  INSERT INTO public.platform_admin_audit (actor_user_id, action, meta)
  VALUES (auth.uid(), 'proactive_limits_update',
          jsonb_build_object('max_per_day', v_day, 'max_per_week', v_week));

  RETURN jsonb_build_object('max_per_day', v_day, 'max_per_week', v_week);
END; $function$;

-- Telemetria v3: tokens e latência vindos do ledger moderno quando o run não os tem.
CREATE OR REPLACE FUNCTION public.admin_v3_ai_history(
  p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_channel text DEFAULT NULL,
  p_path text DEFAULT NULL, p_capability text DEFAULT NULL,
  p_model_tier text DEFAULT NULL, p_model text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_to date := coalesce(p_to, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_from date := coalesce(p_from, v_to - 29);
  v_base jsonb;
  v_ledger jsonb;
  v_series jsonb;
BEGIN
  PERFORM public._require_perm('cockpit.read');
  IF v_from > v_to THEN RAISE EXCEPTION 'invalid_period'; END IF;

  v_base := public.admin_v2_ai_history(v_from, v_to, p_channel, p_path, p_capability, p_model_tier, p_model);

  WITH led AS (
    SELECT (occurred_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
           coalesce(input_tokens, 0) AS tin,
           coalesce(output_tokens, 0) AS tout,
           latency_ms,
           coalesce(estimated_cost_usd, 0) AS cost
    FROM public.ai_usage_ledger
    WHERE (occurred_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
      AND (p_model IS NULL OR model = p_model)
  )
  SELECT jsonb_build_object(
    'totals', (
      SELECT jsonb_build_object(
        'calls', count(*),
        'tokens_in', coalesce(sum(tin), 0),
        'tokens_out', coalesce(sum(tout), 0),
        'tokens_total', coalesce(sum(tin + tout), 0),
        'avg_latency_ms', round(avg(latency_ms)::numeric, 0),
        'p50_latency_ms', percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms),
        'p95_latency_ms', percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms),
        'estimated_cost_usd', round(coalesce(sum(cost), 0)::numeric, 6)
      ) FROM led),
    'series', coalesce((
      SELECT jsonb_object_agg(day::text, jsonb_build_object(
        'tokens_in', tokens_in, 'tokens_out', tokens_out, 'tokens_total', tokens_total,
        'avg_latency_ms', avg_latency_ms, 'p50_latency_ms', p50_latency_ms, 'p95_latency_ms', p95_latency_ms,
        'estimated_cost_usd', estimated_cost_usd))
      FROM (
        SELECT day,
          sum(tin) AS tokens_in, sum(tout) AS tokens_out, sum(tin + tout) AS tokens_total,
          round(avg(latency_ms)::numeric, 0) AS avg_latency_ms,
          percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50_latency_ms,
          percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms,
          round(sum(cost)::numeric, 6) AS estimated_cost_usd
        FROM led GROUP BY day) d
    ), '{}'::jsonb)
  ) INTO v_ledger;

  -- Cada dia da série assume o valor do ledger quando o run não registrou tokens/latência.
  SELECT coalesce(jsonb_agg(
    CASE
      WHEN v_ledger->'series' ? (row_json->>'day') THEN row_json || jsonb_strip_nulls(jsonb_build_object(
        'tokens_in', CASE WHEN coalesce((row_json->>'tokens_in')::numeric, 0) = 0
          THEN v_ledger->'series'->(row_json->>'day')->'tokens_in' END,
        'tokens_out', CASE WHEN coalesce((row_json->>'tokens_out')::numeric, 0) = 0
          THEN v_ledger->'series'->(row_json->>'day')->'tokens_out' END,
        'tokens_total', CASE WHEN coalesce((row_json->>'tokens_total')::numeric, 0) = 0
          THEN v_ledger->'series'->(row_json->>'day')->'tokens_total' END,
        'avg_latency_ms', CASE WHEN row_json->>'avg_latency_ms' IS NULL
          THEN v_ledger->'series'->(row_json->>'day')->'avg_latency_ms' END,
        'p50_latency_ms', CASE WHEN row_json->>'p50_latency_ms' IS NULL
          THEN v_ledger->'series'->(row_json->>'day')->'p50_latency_ms' END,
        'p95_latency_ms', CASE WHEN row_json->>'p95_latency_ms' IS NULL
          THEN v_ledger->'series'->(row_json->>'day')->'p95_latency_ms' END
      ))
      ELSE row_json
    END ORDER BY row_json->>'day'), '[]'::jsonb)
  INTO v_series
  FROM jsonb_array_elements(coalesce(v_base->'series', '[]'::jsonb)) AS s(row_json);

  RETURN v_base
    || jsonb_build_object('series', v_series)
    || jsonb_build_object('contract_version', 'admin_ai_history.v3')
    || jsonb_build_object('ledger_totals', v_ledger->'totals')
    || jsonb_build_object('totals', (v_base->'totals')
        || jsonb_strip_nulls(jsonb_build_object(
          'tokens_total', CASE WHEN coalesce((v_base->'totals'->>'tokens_total')::numeric, 0) = 0
            THEN v_ledger->'totals'->'tokens_total' END,
          'tokens_in', CASE WHEN coalesce((v_base->'totals'->>'tokens_in')::numeric, 0) = 0
            THEN v_ledger->'totals'->'tokens_in' END,
          'tokens_out', CASE WHEN coalesce((v_base->'totals'->>'tokens_out')::numeric, 0) = 0
            THEN v_ledger->'totals'->'tokens_out' END,
          'avg_latency_ms', CASE WHEN v_base->'totals'->>'avg_latency_ms' IS NULL
            THEN v_ledger->'totals'->'avg_latency_ms' END,
          'p50_latency_ms', CASE WHEN v_base->'totals'->>'p50_latency_ms' IS NULL
            THEN v_ledger->'totals'->'p50_latency_ms' END,
          'p95_latency_ms', CASE WHEN v_base->'totals'->>'p95_latency_ms' IS NULL
            THEN v_ledger->'totals'->'p95_latency_ms' END)));
END; $function$;

-- Visão auditável do aprendizado por usuário.
CREATE OR REPLACE FUNCTION public.admin_nino_learning_overview(_user_id uuid, _days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_days int := greatest(1, least(180, coalesce(_days, 30)));
  v_since timestamptz := now() - make_interval(days => v_days);
  v_events int; v_runs int; v_last timestamptz;
  v_out jsonb;
BEGIN
  PERFORM public._require_perm('cockpit.read');

  SELECT count(*), max(occurred_at) INTO v_events, v_last
  FROM public.nino_learning_events WHERE user_id = _user_id AND occurred_at >= v_since;

  SELECT count(*) INTO v_runs
  FROM public.agent_runs WHERE user_id = _user_id AND started_at >= v_since;

  SELECT jsonb_build_object(
    'period_days', v_days,
    'totals', jsonb_build_object(
      'events', v_events,
      'applied', (SELECT count(*) FROM public.nino_learning_events
                  WHERE user_id = _user_id AND occurred_at >= v_since AND applied),
      'corrections', (SELECT count(*) FROM public.nino_learning_events
                      WHERE user_id = _user_id AND occurred_at >= v_since AND event_type = 'correction'),
      'commitments', (SELECT count(*) FROM public.nino_change_commitments
                      WHERE user_id = _user_id AND accepted_at >= v_since),
      'checkins', (SELECT count(*) FROM public.nino_change_checkins
                   WHERE user_id = _user_id AND created_at >= v_since),
      'memory_items', (SELECT count(*) FROM public.agent_memory WHERE user_id = _user_id),
      'active_commitments', (SELECT count(*) FROM public.nino_change_commitments
                             WHERE user_id = _user_id AND status = 'active'),
      'completed_commitments', (SELECT count(*) FROM public.nino_change_commitments
                                WHERE user_id = _user_id AND status = 'completed'),
      'recent_agent_runs', v_runs
    ),
    'by_type', coalesce((
      SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT event_type, count(*) AS total, count(*) FILTER (WHERE applied) AS applied
        FROM public.nino_learning_events
        WHERE user_id = _user_id AND occurred_at >= v_since
        GROUP BY event_type ORDER BY count(*) DESC) t), '[]'::jsonb),
    'recent', coalesce((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.occurred_at DESC) FROM (
        SELECT id, occurred_at, event_type, source, signal, subject_key, confidence, applied
        FROM public.nino_learning_events
        WHERE user_id = _user_id AND occurred_at >= v_since
        ORDER BY occurred_at DESC LIMIT 30) t), '[]'::jsonb),
    'last_learned_at', v_last,
    'health', CASE
      WHEN v_events > 0 THEN 'healthy'
      WHEN v_runs = 0 THEN 'warming_up'
      ELSE 'attention' END,
    'health_reason', CASE
      WHEN v_events > 0 THEN 'Aprendizado sendo registrado no ledger auditável.'
      WHEN v_runs = 0 THEN 'Sem conversas recentes deste usuário no recorte.'
      ELSE 'Existem conversas recentes, mas nenhum evento de aprendizado gravado.' END
  ) INTO v_out;

  RETURN v_out;
END; $function$;