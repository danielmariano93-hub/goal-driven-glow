-- nino_change_agent.v1 — hardening: lifecycle real, constraints físicas,
-- backfill de aprendizado e telemetria honesta.

-- 1) Compromissos: colunas de estratégia/intervenção
ALTER TABLE public.nino_change_commitments
  ADD COLUMN IF NOT EXISTS strategy_reason text,
  ADD COLUMN IF NOT EXISTS last_outcome text,
  ADD COLUMN IF NOT EXISTS intervention_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_strategy_change_at timestamptz;

-- Só um compromisso ativo por pessoa: proteção física, não convenção.
UPDATE public.nino_change_commitments c
SET status = 'superseded', ended_at = coalesce(c.ended_at, now()),
    end_reason = coalesce(c.end_reason, 'superseded_by_unique_active_guard')
WHERE c.status = 'active'
  AND EXISTS (
    SELECT 1 FROM public.nino_change_commitments b
    WHERE b.user_id = c.user_id AND b.status = 'active'
      AND (b.accepted_at, b.id) > (c.accepted_at, c.id)
  );

CREATE UNIQUE INDEX IF NOT EXISTS nino_change_commitments_one_active_idx
  ON public.nino_change_commitments (user_id) WHERE status = 'active';

-- 2) Check-ins: entrega real é parte do registro
ALTER TABLE public.nino_change_checkins
  ADD COLUMN IF NOT EXISTS communicated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS channel text,
  ADD COLUMN IF NOT EXISTS communication_kind text,
  ADD COLUMN IF NOT EXISTS dedup_key text;

CREATE UNIQUE INDEX IF NOT EXISTS nino_change_checkins_dedup_idx
  ON public.nino_change_checkins (user_id, dedup_key) WHERE dedup_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS nino_change_checkins_recent_idx
  ON public.nino_change_checkins (user_id, commitment_id, created_at DESC);

-- 3) Constraints de domínio (aplicadas depois de normalizar o que existe)
UPDATE public.nino_change_commitments SET cadence_days = 7 WHERE cadence_days IS NULL OR cadence_days < 1;
UPDATE public.nino_change_commitments SET last_progress_score = least(1, greatest(0, last_progress_score))
  WHERE last_progress_score IS NOT NULL;
UPDATE public.nino_change_checkins SET progress_score = least(1, greatest(0, progress_score));

ALTER TABLE public.nino_change_recommendations DROP CONSTRAINT IF EXISTS nino_change_recommendations_stage_chk;
ALTER TABLE public.nino_change_recommendations ADD CONSTRAINT nino_change_recommendations_stage_chk
  CHECK (stage IN ('repair_truth','stabilize_cash','reduce_debt_pressure','fund_goal','build_wealth','protect_progress'));
ALTER TABLE public.nino_change_recommendations DROP CONSTRAINT IF EXISTS nino_change_recommendations_status_chk;
ALTER TABLE public.nino_change_recommendations ADD CONSTRAINT nino_change_recommendations_status_chk
  CHECK (status IN ('proposed','accepted','superseded','expired','declined'));
ALTER TABLE public.nino_change_recommendations DROP CONSTRAINT IF EXISTS nino_change_recommendations_conf_chk;
ALTER TABLE public.nino_change_recommendations ADD CONSTRAINT nino_change_recommendations_conf_chk
  CHECK (confidence >= 0 AND confidence <= 1);

ALTER TABLE public.nino_change_commitments DROP CONSTRAINT IF EXISTS nino_change_commitments_stage_chk;
ALTER TABLE public.nino_change_commitments ADD CONSTRAINT nino_change_commitments_stage_chk
  CHECK (stage IN ('repair_truth','stabilize_cash','reduce_debt_pressure','fund_goal','build_wealth','protect_progress'));
ALTER TABLE public.nino_change_commitments DROP CONSTRAINT IF EXISTS nino_change_commitments_status_chk;
ALTER TABLE public.nino_change_commitments ADD CONSTRAINT nino_change_commitments_status_chk
  CHECK (status IN ('active','paused','completed','superseded','cancelled'));
ALTER TABLE public.nino_change_commitments DROP CONSTRAINT IF EXISTS nino_change_commitments_strategy_chk;
ALTER TABLE public.nino_change_commitments ADD CONSTRAINT nino_change_commitments_strategy_chk
  CHECK (strategy IN ('reinforce','remind','reframe','pause'));
ALTER TABLE public.nino_change_commitments DROP CONSTRAINT IF EXISTS nino_change_commitments_outcome_chk;
ALTER TABLE public.nino_change_commitments ADD CONSTRAINT nino_change_commitments_outcome_chk
  CHECK (last_outcome IS NULL OR last_outcome IN ('completed','progress','stalled','regressed','no_evidence'));
ALTER TABLE public.nino_change_commitments DROP CONSTRAINT IF EXISTS nino_change_commitments_cadence_chk;
ALTER TABLE public.nino_change_commitments ADD CONSTRAINT nino_change_commitments_cadence_chk
  CHECK (cadence_days >= 1);
ALTER TABLE public.nino_change_commitments DROP CONSTRAINT IF EXISTS nino_change_commitments_score_chk;
ALTER TABLE public.nino_change_commitments ADD CONSTRAINT nino_change_commitments_score_chk
  CHECK (last_progress_score IS NULL OR (last_progress_score >= 0 AND last_progress_score <= 1));

ALTER TABLE public.nino_change_checkins DROP CONSTRAINT IF EXISTS nino_change_checkins_outcome_chk;
ALTER TABLE public.nino_change_checkins ADD CONSTRAINT nino_change_checkins_outcome_chk
  CHECK (outcome IN ('completed','progress','stalled','regressed','no_evidence'));
ALTER TABLE public.nino_change_checkins DROP CONSTRAINT IF EXISTS nino_change_checkins_score_chk;
ALTER TABLE public.nino_change_checkins ADD CONSTRAINT nino_change_checkins_score_chk
  CHECK (progress_score >= 0 AND progress_score <= 1);

ALTER TABLE public.nino_learning_events DROP CONSTRAINT IF EXISTS nino_learning_events_conf_chk;
ALTER TABLE public.nino_learning_events ADD CONSTRAINT nino_learning_events_conf_chk
  CHECK (confidence >= 0 AND confidence <= 1);

-- 4) Backfill do aprendizado a partir de agent_memory (sem conteúdo sensível)
INSERT INTO public.nino_learning_events (
  user_id, occurred_at, event_type, source, signal, subject_key,
  confidence, weight, metadata, applied, applied_at, dedup_key
)
SELECT m.user_id,
       coalesce(m.updated_at, m.created_at, now()),
       CASE m.kind
         WHEN 'correction' THEN 'correction'
         WHEN 'frequent_merchant' THEN 'merchant_observation'
         WHEN 'favorite_category' THEN 'category_observation'
         ELSE 'memory_snapshot' END,
       'agent_memory_backfill',
       coalesce(m.kind, 'memory'),
       left(coalesce(m.key, ''), 120),
       least(1, greatest(0, coalesce(m.confidence, 0.5))),
       1,
       jsonb_build_object('backfill', true, 'memory_kind', m.kind, 'memory_source', m.source),
       true,
       coalesce(m.updated_at, m.created_at, now()),
       'backfill:agent_memory:' || m.id::text
FROM public.agent_memory m
ON CONFLICT (user_id, dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;

-- 5) Telemetria de IA v3: série temporal real e workload separado
CREATE OR REPLACE FUNCTION public.admin_v3_ai_history(
  p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_channel text DEFAULT NULL,
  p_path text DEFAULT NULL, p_capability text DEFAULT NULL,
  p_model_tier text DEFAULT NULL, p_model text DEFAULT NULL,
  p_workload text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_to date := coalesce(p_to, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_from date := coalesce(p_from, v_to - 29);
  v_base jsonb;
  v_series jsonb;
  v_totals jsonb;
BEGIN
  PERFORM public._require_perm('cockpit.read');
  IF v_from > v_to THEN RAISE EXCEPTION 'invalid_period'; END IF;

  v_base := public.admin_v2_ai_history(v_from, v_to, p_channel, p_path, p_capability, p_model_tier, p_model);

  WITH days AS (
    SELECT generate_series(v_from, v_to, interval '1 day')::date AS day
  ), led AS (
    SELECT (occurred_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
           coalesce(input_tokens, 0) AS tin,
           coalesce(output_tokens, 0) AS tout,
           latency_ms,
           coalesce(estimated_cost_usd, 0) AS cost
    FROM public.ai_usage_ledger
    WHERE (occurred_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
      AND (p_model IS NULL OR model = p_model)
      AND (p_workload IS NULL OR workload::text = p_workload)
  ), led_day AS (
    SELECT day, count(*) AS calls,
           sum(tin) AS tokens_in, sum(tout) AS tokens_out, sum(tin + tout) AS tokens_total,
           round(avg(latency_ms)::numeric, 0) AS ai_avg_latency_ms,
           percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms) AS ai_p50_latency_ms,
           percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) AS ai_p95_latency_ms,
           round(sum(cost)::numeric, 6) AS estimated_cost_usd
    FROM led GROUP BY day
  ), runs AS (
    SELECT (started_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
           total_latency_ms AS lat
    FROM public.agent_runs
    WHERE (started_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
      AND (p_channel IS NULL OR channel = p_channel)
  ), runs_day AS (
    SELECT day, count(*) AS runs,
           round(avg(lat)::numeric, 0) AS e2e_avg_latency_ms,
           percentile_disc(0.5) WITHIN GROUP (ORDER BY lat) AS e2e_p50_latency_ms,
           percentile_disc(0.95) WITHIN GROUP (ORDER BY lat) AS e2e_p95_latency_ms
    FROM runs GROUP BY day
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'day', d.day::text,
      'calls', coalesce(l.calls, 0),
      'runs', coalesce(r.runs, 0),
      'tokens_in', coalesce(l.tokens_in, 0),
      'tokens_out', coalesce(l.tokens_out, 0),
      'tokens_total', coalesce(l.tokens_total, 0),
      'estimated_cost_usd', coalesce(l.estimated_cost_usd, 0),
      'ai_avg_latency_ms', l.ai_avg_latency_ms,
      'ai_p50_latency_ms', l.ai_p50_latency_ms,
      'ai_p95_latency_ms', l.ai_p95_latency_ms,
      'e2e_avg_latency_ms', r.e2e_avg_latency_ms,
      'e2e_p50_latency_ms', r.e2e_p50_latency_ms,
      'e2e_p95_latency_ms', r.e2e_p95_latency_ms,
      'avg_latency_ms', coalesce(l.ai_avg_latency_ms, r.e2e_avg_latency_ms),
      'p50_latency_ms', coalesce(l.ai_p50_latency_ms, r.e2e_p50_latency_ms),
      'p95_latency_ms', coalesce(l.ai_p95_latency_ms, r.e2e_p95_latency_ms),
      'tokens_source', CASE WHEN coalesce(l.calls, 0) > 0 THEN 'ai_usage_ledger' ELSE 'none' END,
      'latency_source', CASE WHEN l.ai_avg_latency_ms IS NOT NULL THEN 'ai_usage_ledger'
                            WHEN r.e2e_avg_latency_ms IS NOT NULL THEN 'agent_runs' ELSE 'none' END
    ) ORDER BY d.day), '[]'::jsonb)
  INTO v_series
  FROM days d
  LEFT JOIN led_day l ON l.day = d.day
  LEFT JOIN runs_day r ON r.day = d.day;

  WITH led AS (
    SELECT coalesce(input_tokens, 0) AS tin, coalesce(output_tokens, 0) AS tout,
           latency_ms, coalesce(estimated_cost_usd, 0) AS cost
    FROM public.ai_usage_ledger
    WHERE (occurred_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
      AND (p_model IS NULL OR model = p_model)
      AND (p_workload IS NULL OR workload::text = p_workload)
  ), runs AS (
    SELECT total_latency_ms AS lat FROM public.agent_runs
    WHERE (started_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
      AND (p_channel IS NULL OR channel = p_channel)
  )
  SELECT jsonb_build_object(
    'calls', (SELECT count(*) FROM led),
    'runs', (SELECT count(*) FROM runs),
    'tokens_in', (SELECT coalesce(sum(tin), 0) FROM led),
    'tokens_out', (SELECT coalesce(sum(tout), 0) FROM led),
    'tokens_total', (SELECT coalesce(sum(tin + tout), 0) FROM led),
    'estimated_cost_usd', (SELECT round(coalesce(sum(cost), 0)::numeric, 6) FROM led),
    'ai_avg_latency_ms', (SELECT round(avg(latency_ms)::numeric, 0) FROM led),
    'ai_p50_latency_ms', (SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms) FROM led),
    'ai_p95_latency_ms', (SELECT percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) FROM led),
    'e2e_avg_latency_ms', (SELECT round(avg(lat)::numeric, 0) FROM runs),
    'e2e_p50_latency_ms', (SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY lat) FROM runs),
    'e2e_p95_latency_ms', (SELECT percentile_disc(0.95) WITHIN GROUP (ORDER BY lat) FROM runs)
  ) INTO v_totals;

  RETURN coalesce(v_base, '{}'::jsonb)
    || jsonb_build_object(
      'contract_version', 'admin_ai_history.v3.1',
      'period', jsonb_build_object('from', v_from, 'to', v_to, 'days', (v_to - v_from) + 1),
      'workload', p_workload,
      'series', v_series,
      'ledger_totals', v_totals,
      'totals', coalesce(v_base->'totals', '{}'::jsonb) || v_totals);
END; $function$;

-- 6) Painel de aprendizado com lifecycle e cobertura do backfill
CREATE OR REPLACE FUNCTION public.admin_nino_learning_overview(_user_id uuid, _days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_days int := greatest(1, least(180, coalesce(_days, 30)));
  v_since timestamptz := now() - make_interval(days => v_days);
  v_events int; v_runs int; v_last timestamptz; v_backfill int;
  v_health text; v_reason text;
BEGIN
  PERFORM public._require_perm('cockpit.read');

  SELECT count(*), max(occurred_at) INTO v_events, v_last
  FROM public.nino_learning_events WHERE user_id = _user_id AND occurred_at >= v_since;

  SELECT count(*) INTO v_runs
  FROM public.agent_runs WHERE user_id = _user_id AND started_at >= v_since;

  SELECT count(*) INTO v_backfill
  FROM public.nino_learning_events
  WHERE user_id = _user_id AND source = 'agent_memory_backfill';

  IF v_runs > 3 AND v_events = 0 THEN
    v_health := 'attention';
    v_reason := 'Há conversas no período, mas nenhum evento de aprendizado foi registrado.';
  ELSIF v_events = 0 THEN
    v_health := 'warming_up';
    v_reason := 'Ainda sem eventos no recorte.';
  ELSE
    v_health := 'healthy';
    v_reason := 'Aprendizado sendo registrado e aplicado.';
  END IF;

  RETURN jsonb_build_object(
    'period_days', v_days,
    'contract_version', 'nino_learning_overview.v2',
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
      'delivered_checkins', (SELECT count(*) FROM public.nino_change_checkins
                             WHERE user_id = _user_id AND created_at >= v_since AND communicated),
      'memory_items', (SELECT count(*) FROM public.agent_memory WHERE user_id = _user_id),
      'backfilled_events', v_backfill,
      'active_commitments', (SELECT count(*) FROM public.nino_change_commitments
                             WHERE user_id = _user_id AND status = 'active'),
      'paused_commitments', (SELECT count(*) FROM public.nino_change_commitments
                             WHERE user_id = _user_id AND status = 'paused'),
      'completed_commitments', (SELECT count(*) FROM public.nino_change_commitments
                                WHERE user_id = _user_id AND status = 'completed'),
      'recent_agent_runs', v_runs
    ),
    'current_strategy', (
      SELECT jsonb_build_object('strategy', strategy, 'strategy_reason', strategy_reason,
                                'stage', stage, 'title', title, 'last_outcome', last_outcome,
                                'intervention_attempts', intervention_attempts,
                                'next_check_at', next_check_at)
      FROM public.nino_change_commitments
      WHERE user_id = _user_id AND status = 'active'
      ORDER BY accepted_at DESC LIMIT 1),
    'by_type', coalesce((
      SELECT jsonb_agg(jsonb_build_object('event_type', event_type, 'total', total, 'applied', applied_count)
             ORDER BY total DESC)
      FROM (SELECT event_type, count(*) AS total, count(*) FILTER (WHERE applied) AS applied_count
            FROM public.nino_learning_events
            WHERE user_id = _user_id AND occurred_at >= v_since
            GROUP BY event_type) t), '[]'::jsonb),
    'recent', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', id, 'occurred_at', occurred_at, 'event_type', event_type,
                                          'source', source, 'signal', signal, 'subject_key', subject_key,
                                          'confidence', confidence, 'applied', applied) ORDER BY occurred_at DESC)
      FROM (SELECT * FROM public.nino_learning_events
            WHERE user_id = _user_id AND occurred_at >= v_since
            ORDER BY occurred_at DESC LIMIT 20) r), '[]'::jsonb),
    'last_learned_at', v_last,
    'health', v_health,
    'health_reason', v_reason);
END; $function$;