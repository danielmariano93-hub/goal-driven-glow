DROP FUNCTION IF EXISTS public.admin_v2_ai_latency_drilldown(date, date, date, text, text, text, text, text, integer);

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
      id,
      started_at,
      (started_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
      status,
      channel,
      coalesce(tokens_in, 0) AS tokens_in,
      coalesce(tokens_out, 0) AS tokens_out,
      coalesce(llm_calls, 0) AS llm_calls,
      latency_ms,
      coalesce(estimated_cost_usd, 0) AS estimated_cost_usd,
      coalesce(tool_result_full_chars, 0) AS full_chars,
      coalesce(tool_result_llm_chars, 0) AS llm_chars,
      path,
      capability,
      model,
      model_tier,
      system_prompt_chars,
      CASE
        WHEN error_message IS NULL THEN NULL
        ELSE left(regexp_replace(error_message, '(Bearer|token|key|secret|password|authorization)[^[:space:]]*', '[removido]', 'gi'), 180)
      END AS error_summary
    FROM public.agent_runs
    WHERE (started_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
      AND (p_channel IS NULL OR channel = p_channel)
      AND (p_path IS NULL OR path = p_path)
      AND (p_capability IS NULL OR capability = p_capability)
      AND (p_model_tier IS NULL OR model_tier = p_model_tier)
      AND (p_model IS NULL OR model = p_model)
  ), latency_thresholds AS (
    SELECT
      percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50_latency_ms,
      percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms
    FROM runs
    WHERE latency_ms IS NOT NULL
  ), shaped_runs AS (
    SELECT
      jsonb_build_object(
        'run_id', id,
        'started_at', started_at,
        'day', day,
        'status', status,
        'channel', channel,
        'path', path,
        'capability', capability,
        'model_tier', model_tier,
        'model', model,
        'latency_ms', latency_ms,
        'tokens_total', tokens_in + tokens_out,
        'tokens_in', tokens_in,
        'tokens_out', tokens_out,
        'llm_calls', llm_calls,
        'estimated_cost_usd', round(estimated_cost_usd::numeric, 6),
        'error_summary', error_summary
      ) AS row_json,
      latency_ms
    FROM runs
    WHERE latency_ms IS NOT NULL
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
    'latency_drilldown', jsonb_build_object(
      'thresholds', (SELECT jsonb_build_object('p50_latency_ms', p50_latency_ms, 'p95_latency_ms', p95_latency_ms) FROM latency_thresholds),
      'p50_runs', coalesce((
        SELECT jsonb_agg(row_json ORDER BY abs(latency_ms - coalesce((SELECT p50_latency_ms FROM latency_thresholds), latency_ms)), latency_ms DESC)
        FROM (
          SELECT row_json, latency_ms FROM shaped_runs
          ORDER BY abs(latency_ms - coalesce((SELECT p50_latency_ms FROM latency_thresholds), latency_ms)), latency_ms DESC
          LIMIT 10
        ) s
      ), '[]'::jsonb),
      'p95_runs', coalesce((
        SELECT jsonb_agg(row_json ORDER BY latency_ms DESC)
        FROM (
          SELECT row_json, latency_ms FROM shaped_runs
          WHERE (SELECT p95_latency_ms FROM latency_thresholds) IS NULL
             OR latency_ms >= (SELECT p95_latency_ms FROM latency_thresholds)
          ORDER BY latency_ms DESC
          LIMIT 10
        ) s
      ), '[]'::jsonb),
      'outlier_runs', coalesce((
        SELECT jsonb_agg(row_json ORDER BY latency_ms DESC)
        FROM (SELECT row_json, latency_ms FROM shaped_runs ORDER BY latency_ms DESC LIMIT 10) s
      ), '[]'::jsonb)
    ),
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

NOTIFY pgrst, 'reload schema';