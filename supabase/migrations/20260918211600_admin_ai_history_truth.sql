-- Align the detailed AI history with two different truths:
-- agent_runs = Nino interactions/runtime; ai_usage_ledger = provider tokens/model latency.
CREATE OR REPLACE FUNCTION public.admin_v3_ai_history(
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_channel text DEFAULT NULL,
  p_path text DEFAULT NULL,
  p_capability text DEFAULT NULL,
  p_model_tier text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_workload text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_to date := coalesce(p_to,(now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_from date := coalesce(p_from,v_to-29);
  v_base jsonb;
  v_series jsonb;
  v_totals jsonb;
  v_by_model jsonb;
  v_filter_scope_complete boolean := p_channel IS NULL AND p_path IS NULL AND p_capability IS NULL AND p_model_tier IS NULL;
BEGIN
  PERFORM public._require_perm('cockpit.read');
  IF v_from>v_to THEN RAISE EXCEPTION 'invalid_period'; END IF;

  v_base := public.admin_v2_ai_history(v_from,v_to,p_channel,p_path,p_capability,p_model_tier,p_model);

  WITH days AS (
    SELECT generate_series(v_from,v_to,'1 day'::interval)::date AS day
  ), base_series AS (
    SELECT (x->>'day')::date AS day,x
    FROM jsonb_array_elements(coalesce(v_base->'series','[]'::jsonb)) x
  ), ledger_day AS (
    SELECT (l.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
      count(*)::bigint ai_calls,
      sum(coalesce(l.input_tokens,0))::bigint tokens_in,
      sum(coalesce(l.output_tokens,0))::bigint tokens_out,
      sum(coalesce(l.input_tokens,0)+coalesce(l.output_tokens,0))::bigint tokens_total,
      round(avg(l.latency_ms) FILTER (WHERE l.latency_ms IS NOT NULL)::numeric,0) ai_avg_latency_ms,
      percentile_disc(.5) WITHIN GROUP(ORDER BY l.latency_ms) FILTER (WHERE l.latency_ms IS NOT NULL) ai_p50_latency_ms,
      percentile_disc(.95) WITHIN GROUP(ORDER BY l.latency_ms) FILTER (WHERE l.latency_ms IS NOT NULL) ai_p95_latency_ms
    FROM public.ai_usage_ledger l
    JOIN public.v_client_users v ON v.user_id=l.user_id
    WHERE (l.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
      AND (p_workload IS NULL OR l.workload::text=p_workload)
      AND (p_model IS NULL OR l.model=p_model)
    GROUP BY 1
  )
  SELECT coalesce(jsonb_agg(
    coalesce(b.x,jsonb_build_object('day',d.day,'runs',0,'llm_runs',0,'no_llm_runs',0,'no_llm_rate',0,'avg_llm_calls',0))
    || jsonb_build_object(
      'day',d.day,
      'ai_calls',coalesce(l.ai_calls,0),
      'tokens_in',CASE WHEN v_filter_scope_complete THEN coalesce(l.tokens_in,0) ELSE NULL END,
      'tokens_out',CASE WHEN v_filter_scope_complete THEN coalesce(l.tokens_out,0) ELSE NULL END,
      'tokens_total',CASE WHEN v_filter_scope_complete THEN coalesce(l.tokens_total,0) ELSE NULL END,
      'tokens_per_run',CASE WHEN NOT v_filter_scope_complete OR coalesce((b.x->>'runs')::numeric,0)=0 THEN NULL ELSE round(coalesce(l.tokens_total,0)::numeric/(b.x->>'runs')::numeric,1) END,
      'ai_avg_latency_ms',CASE WHEN v_filter_scope_complete THEN l.ai_avg_latency_ms ELSE NULL END,
      'ai_p50_latency_ms',CASE WHEN v_filter_scope_complete THEN l.ai_p50_latency_ms ELSE NULL END,
      'ai_p95_latency_ms',CASE WHEN v_filter_scope_complete THEN l.ai_p95_latency_ms ELSE NULL END,
      -- Legacy key kept for frontend compatibility: this is total backend run time,
      -- not measured user-perceived/network end-to-end latency.
      'e2e_avg_latency_ms',(b.x->>'avg_latency_ms')::numeric,
      'e2e_p50_latency_ms',(b.x->>'p50_latency_ms')::numeric,
      'e2e_p95_latency_ms',(b.x->>'p95_latency_ms')::numeric
    ) ORDER BY d.day
  ),'[]'::jsonb) INTO v_series
  FROM days d LEFT JOIN base_series b USING(day) LEFT JOIN ledger_day l USING(day);

  WITH ledger AS (
    SELECT l.* FROM public.ai_usage_ledger l JOIN public.v_client_users v ON v.user_id=l.user_id
    WHERE (l.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
      AND (p_workload IS NULL OR l.workload::text=p_workload)
      AND (p_model IS NULL OR l.model=p_model)
  ), t AS (
    SELECT count(*)::bigint ai_calls,
      coalesce(sum(coalesce(input_tokens,0)),0)::bigint tokens_in,
      coalesce(sum(coalesce(output_tokens,0)),0)::bigint tokens_out,
      coalesce(sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)),0)::bigint tokens_total,
      round(avg(latency_ms) FILTER (WHERE latency_ms IS NOT NULL)::numeric,0) ai_avg_latency_ms,
      percentile_disc(.5) WITHIN GROUP(ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL) ai_p50_latency_ms,
      percentile_disc(.95) WITHIN GROUP(ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL) ai_p95_latency_ms
    FROM ledger
  )
  SELECT coalesce(v_base->'totals','{}'::jsonb) || jsonb_build_object(
    'ai_calls',t.ai_calls,
    'tokens_in',CASE WHEN v_filter_scope_complete THEN t.tokens_in ELSE NULL END,
    'tokens_out',CASE WHEN v_filter_scope_complete THEN t.tokens_out ELSE NULL END,
    'tokens_total',CASE WHEN v_filter_scope_complete THEN t.tokens_total ELSE NULL END,
    'tokens_per_run',CASE WHEN NOT v_filter_scope_complete OR coalesce((v_base#>>'{totals,runs}')::numeric,0)=0 THEN NULL ELSE round(t.tokens_total::numeric/(v_base#>>'{totals,runs}')::numeric,1) END,
    'tokens_per_llm_run',CASE WHEN NOT v_filter_scope_complete OR coalesce((v_base#>>'{totals,llm_runs}')::numeric,0)=0 THEN NULL ELSE round(t.tokens_total::numeric/(v_base#>>'{totals,llm_runs}')::numeric,1) END,
    'ai_avg_latency_ms',CASE WHEN v_filter_scope_complete THEN t.ai_avg_latency_ms ELSE NULL END,
    'ai_p50_latency_ms',CASE WHEN v_filter_scope_complete THEN t.ai_p50_latency_ms ELSE NULL END,
    'ai_p95_latency_ms',CASE WHEN v_filter_scope_complete THEN t.ai_p95_latency_ms ELSE NULL END,
    'e2e_avg_latency_ms',(v_base#>>'{totals,avg_latency_ms}')::numeric,
    'e2e_p50_latency_ms',(v_base#>>'{totals,p50_latency_ms}')::numeric,
    'e2e_p95_latency_ms',(v_base#>>'{totals,p95_latency_ms}')::numeric
  ) INTO v_totals FROM t;

  WITH grouped AS (
    SELECT l.model,NULL::text AS model_tier,count(*)::bigint AS runs,
      sum(coalesce(l.input_tokens,0))::bigint AS tokens_in,
      sum(coalesce(l.output_tokens,0))::bigint AS tokens_out,
      0::numeric AS estimated_cost_usd
    FROM public.ai_usage_ledger l JOIN public.v_client_users v ON v.user_id=l.user_id
    WHERE (l.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
      AND (p_workload IS NULL OR l.workload::text=p_workload)
      AND (p_model IS NULL OR l.model=p_model)
    GROUP BY l.model ORDER BY sum(coalesce(l.input_tokens,0)+coalesce(l.output_tokens,0)) DESC
  ) SELECT coalesce(jsonb_agg(row_to_json(grouped)),'[]'::jsonb) INTO v_by_model FROM grouped;

  RETURN v_base || jsonb_build_object(
    'contract_version','admin_ai_history.v3.2',
    'totals',v_totals,
    'series',v_series,
    'by_model',v_by_model,
    'coverage',coalesce(v_base->'coverage','{}'::jsonb)||jsonb_build_object(
      'first_ai_usage_at',(SELECT min(occurred_at) FROM public.ai_usage_ledger WHERE input_tokens IS NOT NULL OR output_tokens IS NOT NULL),
      'provider_metric_filter_scope_complete',v_filter_scope_complete,
      'provider_metric_source','ai_usage_ledger',
      'interaction_metric_source','agent_runs'
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_v3_ai_history(date,date,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_v3_ai_history(date,date,text,text,text,text,text,text) TO authenticated;
