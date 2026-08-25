REVOKE EXECUTE ON FUNCTION public.ai_workload_budget_snapshot(public.ai_workload) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_workload_budget_snapshot(public.ai_workload) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_ai_usage_summary(_days integer DEFAULT 7)
 RETURNS TABLE(
  day date,
  workload text,
  calls bigint,
  successful_calls bigint,
  input_tokens bigint,
  output_tokens bigint,
  estimated_cost_usd numeric,
  avg_latency_ms numeric,
  p95_latency_ms numeric
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    date_trunc('day', occurred_at)::date AS day,
    workload::text,
    count(*) AS calls,
    count(*) FILTER (WHERE success) AS successful_calls,
    coalesce(sum(input_tokens),0)::bigint AS input_tokens,
    coalesce(sum(output_tokens),0)::bigint AS output_tokens,
    coalesce(sum(coalesce(estimated_cost_usd,0)),0)::numeric AS estimated_cost_usd,
    avg(latency_ms)::numeric AS avg_latency_ms,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::numeric AS p95_latency_ms
  FROM public.ai_usage_ledger
  WHERE public.has_role(auth.uid(), 'admin')
    AND occurred_at >= now() - make_interval(days => greatest(1, least(coalesce(_days,7), 365)))
  GROUP BY 1,2
  ORDER BY 1 DESC,2;
$function$;
REVOKE ALL ON FUNCTION public.admin_ai_usage_summary(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ai_usage_summary(integer) TO authenticated, service_role;