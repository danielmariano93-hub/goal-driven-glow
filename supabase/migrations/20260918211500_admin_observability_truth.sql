-- Admin observability truth: live AI usage, live Nino activity and missing admin panels.
-- Deliberately focused: no diagnosis/retention side effects from the broader readiness migration.

CREATE OR REPLACE FUNCTION public.admin_ai_ops_snapshot(
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_workload text DEFAULT 'AGENT_CONVERSATION'
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

  WITH days AS (
    SELECT generate_series(v_from, v_to, interval '1 day')::date AS day
  ), runs AS (
    SELECT
      (ar.started_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
      ar.user_id,
      ar.conversation_id,
      ar.latency_ms,
      ar.perceived_latency_ms,
      ar.started_at
    FROM public.agent_runs ar
    JOIN public.v_client_users v ON v.user_id = ar.user_id
    WHERE (ar.started_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
  ), run_day AS (
    SELECT day,
      count(*)::bigint AS interactions,
      count(DISTINCT user_id)::bigint AS unique_users,
      count(DISTINCT conversation_id)::bigint AS conversation_threads,
      round(avg(latency_ms) FILTER (WHERE latency_ms IS NOT NULL)::numeric,0) AS run_avg_latency_ms,
      percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL) AS run_p50_latency_ms,
      percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL) AS run_p95_latency_ms,
      round(avg(perceived_latency_ms) FILTER (WHERE perceived_latency_ms IS NOT NULL)::numeric,0) AS perceived_avg_latency_ms,
      percentile_disc(0.5) WITHIN GROUP (ORDER BY perceived_latency_ms) FILTER (WHERE perceived_latency_ms IS NOT NULL) AS perceived_p50_latency_ms,
      percentile_disc(0.95) WITHIN GROUP (ORDER BY perceived_latency_ms) FILTER (WHERE perceived_latency_ms IS NOT NULL) AS perceived_p95_latency_ms,
      max(started_at) AS latest_run_at
    FROM runs GROUP BY day
  ), ledger AS (
    SELECT
      (l.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
      l.user_id,
      coalesce(l.input_tokens,0)::bigint AS tokens_in,
      coalesce(l.output_tokens,0)::bigint AS tokens_out,
      l.latency_ms,
      l.provider,
      l.model,
      l.occurred_at
    FROM public.ai_usage_ledger l
    JOIN public.v_client_users v ON v.user_id = l.user_id
    WHERE (l.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
      AND (p_workload IS NULL OR l.workload::text = p_workload)
  ), ledger_day AS (
    SELECT day,
      count(*)::bigint AS ai_calls,
      sum(tokens_in)::bigint AS tokens_in,
      sum(tokens_out)::bigint AS tokens_out,
      sum(tokens_in + tokens_out)::bigint AS tokens_total,
      round(avg(latency_ms) FILTER (WHERE latency_ms IS NOT NULL)::numeric,0) AS ai_avg_latency_ms,
      percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL) AS ai_p50_latency_ms,
      percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL) AS ai_p95_latency_ms,
      max(occurred_at) AS latest_ai_at
    FROM ledger GROUP BY day
  ), series AS (
    SELECT d.day,
      coalesce(r.interactions,0) AS interactions,
      coalesce(r.unique_users,0) AS unique_users,
      coalesce(r.conversation_threads,0) AS conversation_threads,
      coalesce(l.ai_calls,0) AS ai_calls,
      coalesce(l.tokens_in,0) AS tokens_in,
      coalesce(l.tokens_out,0) AS tokens_out,
      coalesce(l.tokens_total,0) AS tokens_total,
      CASE WHEN coalesce(r.interactions,0)=0 THEN NULL
           ELSE round(coalesce(l.tokens_total,0)::numeric / r.interactions,1) END AS tokens_per_interaction,
      l.ai_avg_latency_ms,l.ai_p50_latency_ms,l.ai_p95_latency_ms,
      r.run_avg_latency_ms,r.run_p50_latency_ms,r.run_p95_latency_ms,
      r.perceived_avg_latency_ms,r.perceived_p50_latency_ms,r.perceived_p95_latency_ms
    FROM days d
    LEFT JOIN run_day r USING(day)
    LEFT JOIN ledger_day l USING(day)
    ORDER BY d.day
  ), run_totals AS (
    SELECT
      count(*)::bigint AS interactions,
      count(DISTINCT user_id)::bigint AS unique_users,
      count(DISTINCT conversation_id)::bigint AS conversation_threads,
      round(avg(latency_ms) FILTER (WHERE latency_ms IS NOT NULL)::numeric,0) AS run_avg_latency_ms,
      percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL) AS run_p50_latency_ms,
      percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL) AS run_p95_latency_ms,
      round(avg(perceived_latency_ms) FILTER (WHERE perceived_latency_ms IS NOT NULL)::numeric,0) AS perceived_avg_latency_ms,
      percentile_disc(0.5) WITHIN GROUP (ORDER BY perceived_latency_ms) FILTER (WHERE perceived_latency_ms IS NOT NULL) AS perceived_p50_latency_ms,
      percentile_disc(0.95) WITHIN GROUP (ORDER BY perceived_latency_ms) FILTER (WHERE perceived_latency_ms IS NOT NULL) AS perceived_p95_latency_ms,
      max(started_at) AS latest_run_at
    FROM runs
  ), ledger_totals AS (
    SELECT
      count(*)::bigint AS ai_calls,
      coalesce(sum(tokens_in),0)::bigint AS tokens_in,
      coalesce(sum(tokens_out),0)::bigint AS tokens_out,
      coalesce(sum(tokens_in+tokens_out),0)::bigint AS tokens_total,
      round(avg(latency_ms) FILTER (WHERE latency_ms IS NOT NULL)::numeric,0) AS ai_avg_latency_ms,
      percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL) AS ai_p50_latency_ms,
      percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL) AS ai_p95_latency_ms,
      mode() WITHIN GROUP (ORDER BY provider) AS provider,
      mode() WITHIN GROUP (ORDER BY model) AS model,
      max(occurred_at) AS latest_ai_at
    FROM ledger
  )
  SELECT jsonb_build_object(
    'contract_version','admin_ai_ops.v1',
    'period',jsonb_build_object('from',v_from,'to',v_to,'timezone','America/Sao_Paulo'),
    'workload',p_workload,
    'totals',jsonb_build_object(
      'interactions',r.interactions,
      'unique_users',r.unique_users,
      'conversation_threads',r.conversation_threads,
      'ai_calls',l.ai_calls,
      'tokens_in',l.tokens_in,
      'tokens_out',l.tokens_out,
      'tokens_total',l.tokens_total,
      'tokens_per_interaction',CASE WHEN r.interactions=0 THEN NULL ELSE round(l.tokens_total::numeric/r.interactions,1) END,
      'tokens_per_ai_call',CASE WHEN l.ai_calls=0 THEN NULL ELSE round(l.tokens_total::numeric/l.ai_calls,1) END,
      'ai_avg_latency_ms',l.ai_avg_latency_ms,
      'ai_p50_latency_ms',l.ai_p50_latency_ms,
      'ai_p95_latency_ms',l.ai_p95_latency_ms,
      'run_avg_latency_ms',r.run_avg_latency_ms,
      'run_p50_latency_ms',r.run_p50_latency_ms,
      'run_p95_latency_ms',r.run_p95_latency_ms,
      'perceived_avg_latency_ms',r.perceived_avg_latency_ms,
      'perceived_p50_latency_ms',r.perceived_p50_latency_ms,
      'perceived_p95_latency_ms',r.perceived_p95_latency_ms,
      'provider',l.provider,'model',l.model,
      'latest_run_at',r.latest_run_at,'latest_ai_at',l.latest_ai_at
    ),
    'series',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.day),'[]'::jsonb) FROM series s),
    'coverage',jsonb_build_object(
      'first_run_at',(SELECT min(started_at) FROM public.agent_runs),
      'first_ai_usage_at',(SELECT min(occurred_at) FROM public.ai_usage_ledger WHERE input_tokens IS NOT NULL OR output_tokens IS NOT NULL),
      'days_with_runs',(SELECT count(*) FROM run_day),
      'days_with_ai_usage',(SELECT count(*) FROM ledger_day),
      'perceived_latency_available',r.perceived_p50_latency_ms IS NOT NULL
    ),
    'measured_at',now()
  ) INTO v_result
  FROM run_totals r CROSS JOIN ledger_totals l;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_ai_ops_snapshot(date,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_ai_ops_snapshot(date,date,text) TO authenticated;

-- Recent activity must come from a live source. product_events stopped being a
-- reliable live feed, so Nino usage is derived from client agent_runs.
CREATE OR REPLACE FUNCTION public.admin_v2_daily_evolution(
  _from date,
  _to date,
  _tz text DEFAULT 'America/Sao_Paulo'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tz text := coalesce(_tz,'America/Sao_Paulo');
  v_from date := coalesce(_from,((now() AT TIME ZONE v_tz)::date-29));
  v_to date := coalesce(_to,(now() AT TIME ZONE v_tz)::date);
  v_sample int;
BEGIN
  PERFORM public._require_perm('cockpit.read');
  IF (v_to-v_from)>365 OR v_to<v_from THEN RAISE EXCEPTION 'invalid_period'; END IF;
  SELECT count(*)::int INTO v_sample FROM public.v_client_users;

  RETURN jsonb_build_object(
    'series',(
      SELECT coalesce(jsonb_agg(row_to_json(x) ORDER BY x.day),'[]'::jsonb)
      FROM (
        WITH days AS (
          SELECT generate_series(v_from,v_to,'1 day'::interval)::date AS day
        ), first_run AS (
          SELECT ar.user_id,min((ar.started_at AT TIME ZONE v_tz)::date) AS first_d
          FROM public.agent_runs ar JOIN public.v_client_users v ON v.user_id=ar.user_id
          GROUP BY ar.user_id
        )
        SELECT d.day,
          (SELECT count(*)::int FROM public.v_client_users v WHERE (v.registered_at AT TIME ZONE v_tz)::date=d.day) AS new_clients,
          (SELECT count(*)::int FROM first_run fr WHERE fr.first_d=d.day) AS activated,
          (SELECT count(DISTINCT ar.user_id)::int FROM public.agent_runs ar JOIN public.v_client_users v ON v.user_id=ar.user_id WHERE (ar.started_at AT TIME ZONE v_tz)::date=d.day) AS active_unique,
          0::int AS went_dormant,
          (SELECT count(*)::int FROM public.v_client_users v WHERE (v.registered_at AT TIME ZONE v_tz)::date<=d.day) AS cumulative_clients,
          (SELECT count(DISTINCT t.user_id)::int FROM public.transactions t JOIN public.v_client_users v ON v.user_id=t.user_id
             WHERE (t.created_at AT TIME ZONE v_tz)::date=d.day
               AND NOT EXISTS (SELECT 1 FROM public.transactions t2 WHERE t2.user_id=t.user_id AND (t2.created_at AT TIME ZONE v_tz)::date<d.day)) AS first_financial_action
        FROM days d
      ) x
    ),
    'totals',jsonb_build_object(
      'new_clients',(SELECT count(*)::int FROM public.v_client_users v WHERE (v.registered_at AT TIME ZONE v_tz)::date BETWEEN v_from AND v_to),
      'activated_period',(SELECT count(*)::int FROM (SELECT ar.user_id,min((ar.started_at AT TIME ZONE v_tz)::date) first_d FROM public.agent_runs ar JOIN public.v_client_users v ON v.user_id=ar.user_id GROUP BY ar.user_id) q WHERE q.first_d BETWEEN v_from AND v_to)
    ),
    'period',jsonb_build_object('from',v_from,'to',v_to,'timezone',v_tz),
    'sample_size',v_sample,
    'sufficient_sample',v_sample>=10,
    'formula_version','daily.evolution.v3.agent_runs_live',
    'activity_source','agent_runs',
    'universe','clients_only',
    'measured_at',now()
  );
END;
$function$;

-- Capacity RPC extracted from the readiness migration so the panel does not
-- depend on unrelated diagnosis/cron changes.
CREATE OR REPLACE FUNCTION public.admin_supabase_capacity_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','storage','auth'
AS $function$
DECLARE
  v_db_bytes bigint; v_public_bytes bigint; v_storage_bytes bigint;
  v_users bigint; v_mau bigint; v_top jsonb;
  v_db_limit bigint := 500*1024*1024;
  v_storage_limit bigint := 1024*1024*1024;
  v_mau_limit bigint := 50000;
BEGIN
  PERFORM public._require_perm('cockpit.read');
  SELECT pg_database_size(current_database()) INTO v_db_bytes;
  SELECT coalesce(sum(pg_total_relation_size(relid)),0) INTO v_public_bytes
    FROM pg_catalog.pg_statio_user_tables WHERE schemaname='public';
  SELECT coalesce(sum(CASE WHEN coalesce(metadata->>'size','')~'^[0-9]+$' THEN (metadata->>'size')::bigint ELSE 0 END),0)
    INTO v_storage_bytes FROM storage.objects;
  SELECT count(*),count(*) FILTER (WHERE last_sign_in_at>=now()-interval '30 days') INTO v_users,v_mau FROM auth.users;
  SELECT coalesce(jsonb_agg(jsonb_build_object('table',relname,'rows_estimate',n_live_tup,'bytes',bytes) ORDER BY bytes DESC),'[]'::jsonb)
    INTO v_top FROM (
      SELECT s.relname,s.n_live_tup,pg_total_relation_size(s.relid) AS bytes
      FROM pg_catalog.pg_stat_user_tables s WHERE s.schemaname='public'
      ORDER BY pg_total_relation_size(s.relid) DESC LIMIT 8
    ) q;
  RETURN jsonb_build_object(
    'captured_at',now(),
    'database',jsonb_build_object('bytes',v_db_bytes,'free_limit_bytes',v_db_limit,'usage_pct',round((100.0*v_db_bytes/nullif(v_db_limit,0))::numeric,1)),
    'public_schema',jsonb_build_object('bytes',v_public_bytes),
    'storage',jsonb_build_object('bytes',v_storage_bytes,'free_limit_bytes',v_storage_limit,'usage_pct',round((100.0*v_storage_bytes/nullif(v_storage_limit,0))::numeric,1)),
    'auth',jsonb_build_object('users',v_users,'mau_30d',v_mau,'free_mau_limit',v_mau_limit,'mau_usage_pct',round((100.0*v_mau/nullif(v_mau_limit,0))::numeric,2)),
    'top_tables',v_top
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_supabase_capacity_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_supabase_capacity_snapshot() TO authenticated;

-- Benchmark RPC copied as a focused install because its original repo migration
-- was skipped during the database cutover.
CREATE OR REPLACE FUNCTION public.admin_ai_provider_benchmark(
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_shadow_provider text DEFAULT NULL,
  p_shadow_model text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_to date := coalesce(p_to,(now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_from date := coalesce(p_from,v_to-29);
  v_result jsonb;
BEGIN
  PERFORM public._require_perm('cockpit.read');
  IF v_from>v_to THEN RAISE EXCEPTION 'invalid_period'; END IF;
  WITH base AS (
    SELECT * FROM public.ai_provider_shadow_evaluations e
    WHERE (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
      AND (p_shadow_provider IS NULL OR e.shadow_provider=p_shadow_provider)
      AND (p_shadow_model IS NULL OR e.shadow_model=p_shadow_model)
  ), bench_users AS (SELECT DISTINCT user_id FROM base),
  prod_usage AS (
    SELECT (l.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
      coalesce(l.input_tokens,0)::numeric tokens_in,coalesce(l.output_tokens,0)::numeric tokens_out,l.latency_ms
    FROM public.ai_usage_ledger l
    WHERE (l.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
      AND l.user_id IN (SELECT user_id FROM bench_users)
      AND l.workload::text='AGENT_CONVERSATION' AND l.operation='conversation_brain' AND coalesce(l.success,true)
  ), shadow_daily AS (
    SELECT (created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,count(*)::bigint turns,
      count(*) FILTER (WHERE status='ok')::bigint ok_turns,
      round(avg(official_latency_ms) FILTER (WHERE official_latency_ms IS NOT NULL)::numeric,1) official_avg_latency_ms,
      round(avg(shadow_latency_ms) FILTER (WHERE status='ok' AND shadow_latency_ms IS NOT NULL)::numeric,1) shadow_avg_latency_ms,
      percentile_cont(.95) WITHIN GROUP(ORDER BY official_latency_ms) FILTER (WHERE official_latency_ms IS NOT NULL) official_p95_latency_ms,
      percentile_cont(.95) WITHIN GROUP(ORDER BY shadow_latency_ms) FILTER (WHERE status='ok' AND shadow_latency_ms IS NOT NULL) shadow_p95_latency_ms,
      round((sum(shadow_tokens_in+shadow_tokens_out) FILTER (WHERE status='ok'))::numeric/nullif(count(*) FILTER (WHERE status='ok'),0),1) shadow_tokens_per_turn,
      round((100.0*avg(((same_act IS TRUE)::int+(same_mode IS TRUE)::int+(same_canonical_request IS TRUE)::int+(same_focus IS TRUE)::int+(same_action_kind IS TRUE)::int)/5.0) FILTER (WHERE status='ok'))::numeric,1) semantic_parity_pct
    FROM base GROUP BY 1
  ), prod_daily AS (
    SELECT day,count(*)::bigint calls,round(avg(latency_ms) FILTER (WHERE latency_ms IS NOT NULL)::numeric,1) ledger_avg_latency_ms,
      round(sum(tokens_in+tokens_out)::numeric/nullif(count(*),0),1) tokens_per_turn FROM prod_usage GROUP BY day
  ), daily AS (
    SELECT s.day,s.turns,s.ok_turns,s.official_avg_latency_ms,s.shadow_avg_latency_ms,s.official_p95_latency_ms,s.shadow_p95_latency_ms,
      p.tokens_per_turn official_tokens_per_turn,s.shadow_tokens_per_turn,s.semantic_parity_pct
    FROM shadow_daily s LEFT JOIN prod_daily p USING(day) ORDER BY s.day
  ), totals AS (
    SELECT count(*)::bigint turns,count(*) FILTER (WHERE status='ok')::bigint shadow_ok_turns,
      mode() WITHIN GROUP(ORDER BY official_provider) official_provider,mode() WITHIN GROUP(ORDER BY official_model) official_model,
      mode() WITHIN GROUP(ORDER BY shadow_provider) shadow_provider,mode() WITHIN GROUP(ORDER BY shadow_model) shadow_model,
      round(avg(official_latency_ms) FILTER (WHERE official_latency_ms IS NOT NULL)::numeric,1) official_avg_latency_ms,
      percentile_cont(.95) WITHIN GROUP(ORDER BY official_latency_ms) FILTER (WHERE official_latency_ms IS NOT NULL) official_p95_latency_ms,
      round(avg(shadow_latency_ms) FILTER (WHERE status='ok' AND shadow_latency_ms IS NOT NULL)::numeric,1) shadow_avg_latency_ms,
      percentile_cont(.95) WITHIN GROUP(ORDER BY shadow_latency_ms) FILTER (WHERE status='ok' AND shadow_latency_ms IS NOT NULL) shadow_p95_latency_ms,
      round((100.0*count(*) FILTER (WHERE status='ok')/nullif(count(*),0))::numeric,1) shadow_success_pct,
      round((100.0*count(*) FILTER (WHERE same_act IS TRUE)/nullif(count(*) FILTER (WHERE status='ok'),0))::numeric,1) act_match_pct,
      round((100.0*count(*) FILTER (WHERE same_mode IS TRUE)/nullif(count(*) FILTER (WHERE status='ok'),0))::numeric,1) mode_match_pct,
      round((100.0*count(*) FILTER (WHERE same_canonical_request IS TRUE)/nullif(count(*) FILTER (WHERE status='ok'),0))::numeric,1) canonical_match_pct,
      round((100.0*count(*) FILTER (WHERE same_focus IS TRUE)/nullif(count(*) FILTER (WHERE status='ok'),0))::numeric,1) focus_match_pct,
      round((100.0*count(*) FILTER (WHERE same_action_kind IS TRUE)/nullif(count(*) FILTER (WHERE status='ok'),0))::numeric,1) action_match_pct,
      round((100.0*avg(((same_act IS TRUE)::int+(same_mode IS TRUE)::int+(same_canonical_request IS TRUE)::int+(same_focus IS TRUE)::int+(same_action_kind IS TRUE)::int)/5.0) FILTER (WHERE status='ok'))::numeric,1) semantic_parity_pct,
      round((sum(shadow_tokens_in+shadow_tokens_out) FILTER (WHERE status='ok'))::numeric/nullif(count(*) FILTER (WHERE status='ok'),0),1) shadow_tokens_per_turn
    FROM base
  ), prod_totals AS (
    SELECT count(*)::bigint calls,round(sum(tokens_in+tokens_out)::numeric/nullif(count(*),0),1) tokens_per_turn FROM prod_usage
  )
  SELECT jsonb_build_object(
    'period',jsonb_build_object('from',v_from,'to',v_to),
    'sample',jsonb_build_object('paired_turns',t.turns,'shadow_successful_turns',t.shadow_ok_turns,'official_usage_calls',p.calls),
    'official',jsonb_build_object('provider',t.official_provider,'model',t.official_model,'avg_latency_ms',t.official_avg_latency_ms,'p95_latency_ms',t.official_p95_latency_ms,'tokens_per_turn',p.tokens_per_turn,'success_pct',CASE WHEN t.turns>0 THEN 100.0 ELSE NULL END),
    'shadow',jsonb_build_object('provider',t.shadow_provider,'model',t.shadow_model,'avg_latency_ms',t.shadow_avg_latency_ms,'p95_latency_ms',t.shadow_p95_latency_ms,'tokens_per_turn',t.shadow_tokens_per_turn,'success_pct',t.shadow_success_pct),
    'semantic',jsonb_build_object('parity_pct',t.semantic_parity_pct,'act_match_pct',t.act_match_pct,'mode_match_pct',t.mode_match_pct,'canonical_match_pct',t.canonical_match_pct,'focus_match_pct',t.focus_match_pct,'action_match_pct',t.action_match_pct),
    'delta',jsonb_build_object(
      'shadow_latency_vs_official_pct',CASE WHEN t.official_avg_latency_ms IS NULL OR t.official_avg_latency_ms=0 OR t.shadow_avg_latency_ms IS NULL THEN NULL ELSE round((100.0*(t.shadow_avg_latency_ms-t.official_avg_latency_ms)/t.official_avg_latency_ms)::numeric,1) END,
      'shadow_tokens_vs_official_pct',CASE WHEN p.tokens_per_turn IS NULL OR p.tokens_per_turn=0 OR t.shadow_tokens_per_turn IS NULL THEN NULL ELSE round((100.0*(t.shadow_tokens_per_turn-p.tokens_per_turn)/p.tokens_per_turn)::numeric,1) END),
    'daily',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.day) FROM daily d),'[]'::jsonb),
    'notes',jsonb_build_object('semantic_parity_is_not_ground_truth',true,'token_comparison_basis','same_period_same_pilot_users')
  ) INTO v_result FROM totals t CROSS JOIN prod_totals p;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_ai_provider_benchmark(date,date,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_ai_provider_benchmark(date,date,text,text) TO authenticated;
