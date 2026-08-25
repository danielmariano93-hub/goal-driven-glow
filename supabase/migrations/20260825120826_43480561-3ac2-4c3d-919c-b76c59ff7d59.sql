CREATE OR REPLACE FUNCTION public.admin_v2_ai_history(
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_channel text DEFAULT NULL,
  p_path text DEFAULT NULL,
  p_capability text DEFAULT NULL,
  p_model_tier text DEFAULT NULL,
  p_model text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_to date := coalesce(p_to, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_from date := coalesce(p_from, v_to - 29);
  v_out jsonb;
BEGIN
  PERFORM public._require_perm('cockpit.read');

  IF v_from > v_to THEN
    RAISE EXCEPTION 'invalid_period';
  END IF;

  WITH runs AS (
    SELECT
      (started_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
      coalesce(tokens_in, 0) AS tokens_in,
      coalesce(tokens_out, 0) AS tokens_out,
      coalesce(llm_calls, 0) AS llm_calls,
      latency_ms,
      coalesce(estimated_cost_usd, 0) AS estimated_cost_usd,
      coalesce(tool_result_full_chars, 0) AS full_chars,
      coalesce(tool_result_llm_chars, 0) AS llm_chars,
      path,
      model,
      model_tier,
      system_prompt_chars
    FROM public.agent_runs
    WHERE (started_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
      AND (p_channel IS NULL OR channel = p_channel)
      AND (p_path IS NULL OR path = p_path)
      AND (p_capability IS NULL OR capability = p_capability)
      AND (p_model_tier IS NULL OR model_tier = p_model_tier)
      AND (p_model IS NULL OR model = p_model)
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'filters', jsonb_build_object(
      'channel', p_channel, 'path', p_path, 'capability', p_capability,
      'model_tier', p_model_tier, 'model', p_model),
    'totals', (
      SELECT jsonb_build_object(
        'runs', count(*),
        'llm_runs', count(*) FILTER (WHERE llm_calls > 0),
        'no_llm_runs', count(*) FILTER (WHERE llm_calls = 0),
        'no_llm_rate', round((count(*) FILTER (WHERE llm_calls = 0))::numeric / greatest(1, count(*))::numeric, 4),
        'tokens_in', sum(tokens_in),
        'tokens_out', sum(tokens_out),
        'tokens_total', sum(tokens_in + tokens_out),
        'tokens_per_run', round(sum(tokens_in + tokens_out)::numeric / greatest(1, count(*))::numeric, 1),
        'tokens_per_llm_run', round(
          sum(tokens_in + tokens_out) FILTER (WHERE llm_calls > 0)::numeric
          / greatest(1, count(*) FILTER (WHERE llm_calls > 0))::numeric, 1),
        'avg_llm_calls', round(avg(llm_calls)::numeric, 3),
        'avg_latency_ms', round(avg(latency_ms)::numeric, 0),
        'p50_latency_ms', percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms),
        'p95_latency_ms', percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms),
        'estimated_cost_usd', round(sum(estimated_cost_usd)::numeric, 6),
        'avg_system_prompt_chars', round(avg(system_prompt_chars)::numeric, 0),
        'compression_ratio', CASE WHEN sum(full_chars) > 0
          THEN round(sum(llm_chars)::numeric / sum(full_chars)::numeric, 4) ELSE NULL END
      ) FROM runs
    ),
    'series', coalesce((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.day) FROM (
        SELECT day,
          count(*) AS runs,
          count(*) FILTER (WHERE llm_calls > 0) AS llm_runs,
          count(*) FILTER (WHERE llm_calls = 0) AS no_llm_runs,
          round((count(*) FILTER (WHERE llm_calls = 0))::numeric / greatest(1, count(*))::numeric, 4) AS no_llm_rate,
          sum(tokens_in) AS tokens_in,
          sum(tokens_out) AS tokens_out,
          sum(tokens_in + tokens_out) AS tokens_total,
          round(sum(tokens_in + tokens_out)::numeric / greatest(1, count(*))::numeric, 1) AS tokens_per_run,
          round(avg(llm_calls)::numeric, 3) AS avg_llm_calls,
          round(avg(latency_ms)::numeric, 0) AS avg_latency_ms,
          percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50_latency_ms,
          percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms,
          round(sum(estimated_cost_usd)::numeric, 6) AS estimated_cost_usd
        FROM runs GROUP BY day
      ) t
    ), '[]'::jsonb),
    'by_path', coalesce((
      SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT coalesce(path, 'unknown') AS path,
          count(*) AS runs,
          round(sum(tokens_in + tokens_out)::numeric / greatest(1, count(*))::numeric, 1) AS tokens_per_run,
          percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50_latency_ms,
          percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms
        FROM runs GROUP BY coalesce(path, 'unknown') ORDER BY count(*) DESC
      ) t
    ), '[]'::jsonb),
    'by_model', coalesce((
      SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT model, model_tier, count(*) AS runs,
          sum(tokens_in) AS tokens_in, sum(tokens_out) AS tokens_out,
          round(sum(estimated_cost_usd)::numeric, 6) AS estimated_cost_usd
        FROM runs WHERE model IS NOT NULL GROUP BY model, model_tier ORDER BY count(*) DESC LIMIT 25
      ) t
    ), '[]'::jsonb),
    'coverage', (
      SELECT jsonb_build_object(
        'first_run_at', min(started_at),
        'first_llm_calls_at', min(started_at) FILTER (WHERE llm_calls IS NOT NULL),
        'first_model_tier_at', min(started_at) FILTER (WHERE model_tier IS NOT NULL),
        'first_compression_at', min(started_at) FILTER (WHERE tool_result_full_chars IS NOT NULL),
        'first_system_prompt_chars_at', min(started_at) FILTER (WHERE system_prompt_chars IS NOT NULL)
      ) FROM public.agent_runs
    ),
    'available_filters', jsonb_build_object(
      'channels', coalesce((SELECT jsonb_agg(DISTINCT channel) FROM public.agent_runs WHERE channel IS NOT NULL), '[]'::jsonb),
      'paths', coalesce((SELECT jsonb_agg(DISTINCT path) FROM public.agent_runs WHERE path IS NOT NULL), '[]'::jsonb),
      'model_tiers', coalesce((SELECT jsonb_agg(DISTINCT model_tier) FROM public.agent_runs WHERE model_tier IS NOT NULL), '[]'::jsonb),
      'models', coalesce((SELECT jsonb_agg(DISTINCT model) FROM public.agent_runs WHERE model IS NOT NULL), '[]'::jsonb),
      'capabilities', coalesce((SELECT jsonb_agg(DISTINCT capability) FROM public.agent_runs WHERE capability IS NOT NULL), '[]'::jsonb)
    )
  ) INTO v_out;

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_v2_ai_history(date, date, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_v2_ai_history(date, date, text, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_v2_ai_milestone_compare(
  p_milestone date,
  p_window_days integer DEFAULT 14,
  p_channel text DEFAULT NULL,
  p_path text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_window integer := greatest(1, least(120, coalesce(p_window_days, 14)));
  v_before jsonb;
  v_after jsonb;
BEGIN
  PERFORM public._require_perm('cockpit.read');

  IF p_milestone IS NULL THEN
    RAISE EXCEPTION 'milestone_required';
  END IF;

  WITH runs AS (
    SELECT
      CASE
        WHEN (started_at AT TIME ZONE 'America/Sao_Paulo')::date < p_milestone THEN 'before'
        ELSE 'after'
      END AS side,
      coalesce(tokens_in, 0) + coalesce(tokens_out, 0) AS tokens,
      coalesce(llm_calls, 0) AS llm_calls,
      latency_ms,
      coalesce(estimated_cost_usd, 0) AS cost
    FROM public.agent_runs
    WHERE (started_at AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN p_milestone - v_window AND p_milestone + v_window - 1
      AND (p_channel IS NULL OR channel = p_channel)
      AND (p_path IS NULL OR path = p_path)
  ), agg AS (
    SELECT side,
      count(*) AS runs,
      round(sum(tokens)::numeric / greatest(1, count(*))::numeric, 1) AS tokens_per_run,
      round((count(*) FILTER (WHERE llm_calls = 0))::numeric / greatest(1, count(*))::numeric, 4) AS no_llm_rate,
      round(avg(llm_calls)::numeric, 3) AS avg_llm_calls,
      percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50_latency_ms,
      percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms,
      round(sum(cost)::numeric, 6) AS estimated_cost_usd
    FROM runs GROUP BY side
  )
  SELECT
    (SELECT to_jsonb(a) FROM agg a WHERE a.side = 'before'),
    (SELECT to_jsonb(a) FROM agg a WHERE a.side = 'after')
  INTO v_before, v_after;

  RETURN jsonb_build_object(
    'milestone', p_milestone,
    'window_days', v_window,
    'filters', jsonb_build_object('channel', p_channel, 'path', p_path),
    'before', coalesce(v_before, jsonb_build_object('runs', 0)),
    'after', coalesce(v_after, jsonb_build_object('runs', 0)),
    'delta', CASE
      WHEN v_before IS NULL OR v_after IS NULL THEN NULL
      ELSE jsonb_build_object(
        'tokens_per_run_pct', CASE WHEN (v_before->>'tokens_per_run')::numeric > 0
          THEN round((((v_after->>'tokens_per_run')::numeric - (v_before->>'tokens_per_run')::numeric)
                      / (v_before->>'tokens_per_run')::numeric) * 100, 1) ELSE NULL END,
        'no_llm_rate_pp', round(((v_after->>'no_llm_rate')::numeric - (v_before->>'no_llm_rate')::numeric) * 100, 1),
        'p50_latency_pct', CASE WHEN (v_before->>'p50_latency_ms')::numeric > 0
          THEN round((((v_after->>'p50_latency_ms')::numeric - (v_before->>'p50_latency_ms')::numeric)
                      / (v_before->>'p50_latency_ms')::numeric) * 100, 1) ELSE NULL END,
        'p95_latency_pct', CASE WHEN (v_before->>'p95_latency_ms')::numeric > 0
          THEN round((((v_after->>'p95_latency_ms')::numeric - (v_before->>'p95_latency_ms')::numeric)
                      / (v_before->>'p95_latency_ms')::numeric) * 100, 1) ELSE NULL END
      ) END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_v2_ai_milestone_compare(date, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_v2_ai_milestone_compare(date, integer, text, text) TO authenticated;