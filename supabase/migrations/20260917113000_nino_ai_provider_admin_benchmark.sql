-- nino_ai_provider_shadow admin benchmark
-- Exposes only aggregate operational telemetry to authorized cockpit admins.

CREATE OR REPLACE FUNCTION public.admin_ai_provider_benchmark(
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_shadow_provider text DEFAULT NULL,
  p_shadow_model text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_to date := coalesce(p_to, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_from date := coalesce(p_from, v_to - 29);
  v_result jsonb;
BEGIN
  PERFORM public._require_perm('cockpit.read');
  IF v_from > v_to THEN RAISE EXCEPTION 'invalid_period'; END IF;

  WITH base AS (
    SELECT *
    FROM public.ai_provider_shadow_evaluations e
    WHERE (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
      AND (p_shadow_provider IS NULL OR e.shadow_provider = p_shadow_provider)
      AND (p_shadow_model IS NULL OR e.shadow_model = p_shadow_model)
  ),
  bench_users AS (
    SELECT DISTINCT user_id FROM base
  ),
  prod_usage AS (
    SELECT
      (l.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
      coalesce(l.input_tokens, 0)::numeric AS tokens_in,
      coalesce(l.output_tokens, 0)::numeric AS tokens_out,
      l.latency_ms
    FROM public.ai_usage_ledger l
    WHERE (l.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
      AND l.user_id IN (SELECT user_id FROM bench_users)
      AND l.workload = 'AGENT_CONVERSATION'
      AND l.operation = 'conversation_brain'
      AND coalesce(l.success, true)
  ),
  shadow_daily AS (
    SELECT
      (created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
      count(*)::bigint AS turns,
      count(*) FILTER (WHERE status = 'ok')::bigint AS ok_turns,
      round(avg(official_latency_ms) FILTER (WHERE official_latency_ms IS NOT NULL)::numeric, 1) AS official_avg_latency_ms,
      round(avg(shadow_latency_ms) FILTER (WHERE status = 'ok' AND shadow_latency_ms IS NOT NULL)::numeric, 1) AS shadow_avg_latency_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY official_latency_ms)
        FILTER (WHERE official_latency_ms IS NOT NULL) AS official_p95_latency_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY shadow_latency_ms)
        FILTER (WHERE status = 'ok' AND shadow_latency_ms IS NOT NULL) AS shadow_p95_latency_ms,
      round((sum(shadow_tokens_in + shadow_tokens_out) FILTER (WHERE status = 'ok'))::numeric
        / nullif(count(*) FILTER (WHERE status = 'ok'), 0), 1) AS shadow_tokens_per_turn,
      round((100.0 * avg(
        ((same_act IS TRUE)::int + (same_mode IS TRUE)::int +
         (same_canonical_request IS TRUE)::int + (same_focus IS TRUE)::int +
         (same_action_kind IS TRUE)::int) / 5.0
      ) FILTER (WHERE status = 'ok'))::numeric, 1) AS semantic_parity_pct
    FROM base
    GROUP BY 1
  ),
  prod_daily AS (
    SELECT
      day,
      count(*)::bigint AS calls,
      round(avg(latency_ms) FILTER (WHERE latency_ms IS NOT NULL)::numeric, 1) AS ledger_avg_latency_ms,
      round(sum(tokens_in + tokens_out)::numeric / nullif(count(*), 0), 1) AS tokens_per_turn
    FROM prod_usage
    GROUP BY day
  ),
  daily AS (
    SELECT
      s.day,
      s.turns,
      s.ok_turns,
      s.official_avg_latency_ms,
      s.shadow_avg_latency_ms,
      s.official_p95_latency_ms,
      s.shadow_p95_latency_ms,
      p.tokens_per_turn AS official_tokens_per_turn,
      s.shadow_tokens_per_turn,
      s.semantic_parity_pct
    FROM shadow_daily s
    LEFT JOIN prod_daily p USING (day)
    ORDER BY s.day
  ),
  totals AS (
    SELECT
      count(*)::bigint AS turns,
      count(*) FILTER (WHERE status = 'ok')::bigint AS shadow_ok_turns,
      mode() WITHIN GROUP (ORDER BY official_provider) AS official_provider,
      mode() WITHIN GROUP (ORDER BY official_model) AS official_model,
      mode() WITHIN GROUP (ORDER BY shadow_provider) AS shadow_provider,
      mode() WITHIN GROUP (ORDER BY shadow_model) AS shadow_model,
      round(avg(official_latency_ms) FILTER (WHERE official_latency_ms IS NOT NULL)::numeric, 1) AS official_avg_latency_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY official_latency_ms)
        FILTER (WHERE official_latency_ms IS NOT NULL) AS official_p95_latency_ms,
      round(avg(shadow_latency_ms) FILTER (WHERE status = 'ok' AND shadow_latency_ms IS NOT NULL)::numeric, 1) AS shadow_avg_latency_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY shadow_latency_ms)
        FILTER (WHERE status = 'ok' AND shadow_latency_ms IS NOT NULL) AS shadow_p95_latency_ms,
      round((100.0 * count(*) FILTER (WHERE status = 'ok') / nullif(count(*), 0))::numeric, 1) AS shadow_success_pct,
      round((100.0 * count(*) FILTER (WHERE same_act IS TRUE) / nullif(count(*) FILTER (WHERE status = 'ok'), 0))::numeric, 1) AS act_match_pct,
      round((100.0 * count(*) FILTER (WHERE same_mode IS TRUE) / nullif(count(*) FILTER (WHERE status = 'ok'), 0))::numeric, 1) AS mode_match_pct,
      round((100.0 * count(*) FILTER (WHERE same_canonical_request IS TRUE) / nullif(count(*) FILTER (WHERE status = 'ok'), 0))::numeric, 1) AS canonical_match_pct,
      round((100.0 * count(*) FILTER (WHERE same_focus IS TRUE) / nullif(count(*) FILTER (WHERE status = 'ok'), 0))::numeric, 1) AS focus_match_pct,
      round((100.0 * count(*) FILTER (WHERE same_action_kind IS TRUE) / nullif(count(*) FILTER (WHERE status = 'ok'), 0))::numeric, 1) AS action_match_pct,
      round((100.0 * avg(
        ((same_act IS TRUE)::int + (same_mode IS TRUE)::int +
         (same_canonical_request IS TRUE)::int + (same_focus IS TRUE)::int +
         (same_action_kind IS TRUE)::int) / 5.0
      ) FILTER (WHERE status = 'ok'))::numeric, 1) AS semantic_parity_pct,
      round((sum(shadow_tokens_in + shadow_tokens_out) FILTER (WHERE status = 'ok'))::numeric
        / nullif(count(*) FILTER (WHERE status = 'ok'), 0), 1) AS shadow_tokens_per_turn
    FROM base
  ),
  prod_totals AS (
    SELECT
      count(*)::bigint AS calls,
      round(sum(tokens_in + tokens_out)::numeric / nullif(count(*), 0), 1) AS tokens_per_turn
    FROM prod_usage
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'sample', jsonb_build_object(
      'paired_turns', t.turns,
      'shadow_successful_turns', t.shadow_ok_turns,
      'official_usage_calls', p.calls
    ),
    'official', jsonb_build_object(
      'provider', t.official_provider,
      'model', t.official_model,
      'avg_latency_ms', t.official_avg_latency_ms,
      'p95_latency_ms', t.official_p95_latency_ms,
      'tokens_per_turn', p.tokens_per_turn,
      'success_pct', CASE WHEN t.turns > 0 THEN 100.0 ELSE NULL END
    ),
    'shadow', jsonb_build_object(
      'provider', t.shadow_provider,
      'model', t.shadow_model,
      'avg_latency_ms', t.shadow_avg_latency_ms,
      'p95_latency_ms', t.shadow_p95_latency_ms,
      'tokens_per_turn', t.shadow_tokens_per_turn,
      'success_pct', t.shadow_success_pct
    ),
    'semantic', jsonb_build_object(
      'parity_pct', t.semantic_parity_pct,
      'act_match_pct', t.act_match_pct,
      'mode_match_pct', t.mode_match_pct,
      'canonical_match_pct', t.canonical_match_pct,
      'focus_match_pct', t.focus_match_pct,
      'action_match_pct', t.action_match_pct
    ),
    'delta', jsonb_build_object(
      'shadow_latency_vs_official_pct', CASE
        WHEN t.official_avg_latency_ms IS NULL OR t.official_avg_latency_ms = 0 OR t.shadow_avg_latency_ms IS NULL THEN NULL
        ELSE round((100.0 * (t.shadow_avg_latency_ms - t.official_avg_latency_ms) / t.official_avg_latency_ms)::numeric, 1)
      END,
      'shadow_tokens_vs_official_pct', CASE
        WHEN p.tokens_per_turn IS NULL OR p.tokens_per_turn = 0 OR t.shadow_tokens_per_turn IS NULL THEN NULL
        ELSE round((100.0 * (t.shadow_tokens_per_turn - p.tokens_per_turn) / p.tokens_per_turn)::numeric, 1)
      END
    ),
    'daily', coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.day) FROM daily d), '[]'::jsonb),
    'notes', jsonb_build_object(
      'semantic_parity_is_not_ground_truth', true,
      'token_comparison_basis', 'same_period_same_pilot_users'
    )
  ) INTO v_result
  FROM totals t CROSS JOIN prod_totals p;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_ai_provider_benchmark(date,date,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_ai_provider_benchmark(date,date,text,text) TO authenticated;
