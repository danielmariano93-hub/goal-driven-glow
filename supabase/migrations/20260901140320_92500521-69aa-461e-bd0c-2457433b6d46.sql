DO $migration$
DECLARE
  v_oid oid;
  v_ddl text;
  v_next text;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'admin_v2_ai_history'
    AND pg_get_function_identity_arguments(p.oid) = 'p_from date, p_to date, p_channel text, p_path text, p_capability text, p_model_tier text, p_model text';
  IF v_oid IS NULL THEN RAISE EXCEPTION 'admin_v2_ai_history canonical signature not found'; END IF;
  v_ddl := pg_get_functiondef(v_oid);
  v_next := replace(v_ddl, 'WHEN error_message IS NULL THEN NULL', 'WHEN error_sanitized IS NULL THEN NULL');
  v_next := replace(v_next, 'regexp_replace(error_message,', 'regexp_replace(error_sanitized,');
  IF v_next = v_ddl THEN RAISE EXCEPTION 'admin_v2_ai_history stale error column pattern not found'; END IF;
  EXECUTE v_next;

  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'admin_v3_ai_history'
    AND pg_get_function_identity_arguments(p.oid) = 'p_from date, p_to date, p_channel text, p_path text, p_capability text, p_model_tier text, p_model text, p_workload text';
  IF v_oid IS NULL THEN RAISE EXCEPTION 'admin_v3_ai_history canonical signature not found'; END IF;
  v_ddl := pg_get_functiondef(v_oid);
  v_next := replace(v_ddl, '''avg_latency_ms'', coalesce(l.ai_avg_latency_ms, r.e2e_avg_latency_ms)', '''avg_latency_ms'', l.ai_avg_latency_ms');
  v_next := replace(v_next, '''p50_latency_ms'', coalesce(l.ai_p50_latency_ms, r.e2e_p50_latency_ms)', '''p50_latency_ms'', l.ai_p50_latency_ms');
  v_next := replace(v_next, '''p95_latency_ms'', coalesce(l.ai_p95_latency_ms, r.e2e_p95_latency_ms)', '''p95_latency_ms'', l.ai_p95_latency_ms');
  v_next := replace(v_next, '''latency_source'', CASE WHEN l.ai_avg_latency_ms IS NOT NULL THEN ''ai_usage_ledger''
                             WHEN r.e2e_avg_latency_ms IS NOT NULL THEN ''agent_runs'' ELSE ''none'' END', '''latency_source'', CASE WHEN l.ai_avg_latency_ms IS NOT NULL THEN ''ai_usage_ledger'' ELSE ''none'' END');
  IF v_next = v_ddl THEN RAISE EXCEPTION 'admin_v3_ai_history latency fallback pattern not found'; END IF;
  EXECUTE v_next;

  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'admin_nino_learning_overview'
    AND pg_get_function_identity_arguments(p.oid) = '_user_id uuid, _days integer';
  IF v_oid IS NULL THEN RAISE EXCEPTION 'admin_nino_learning_overview canonical signature not found'; END IF;
  v_ddl := pg_get_functiondef(v_oid);
  v_next := replace(v_ddl, 'coalesce(p.pseudonym, left(e.user_id::text, 8))', 'coalesce(p.pseudo_id::text, left(e.user_id::text, 8))');
  IF v_next = v_ddl THEN RAISE EXCEPTION 'admin_nino_learning_overview stale pseudonym pattern not found'; END IF;
  EXECUTE v_next;
END
$migration$;

REVOKE ALL ON FUNCTION public.admin_v2_ai_history(date, date, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_v2_ai_history(date, date, text, text, text, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_v3_ai_history(date, date, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_v3_ai_history(date, date, text, text, text, text, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_nino_learning_overview(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_nino_learning_overview(uuid, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';