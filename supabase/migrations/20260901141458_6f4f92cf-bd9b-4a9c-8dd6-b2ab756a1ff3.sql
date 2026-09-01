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
    AND p.proname = 'admin_v3_ai_history'
    AND pg_get_function_identity_arguments(p.oid) = 'p_from date, p_to date, p_channel text, p_path text, p_capability text, p_model_tier text, p_model text, p_workload text';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'admin_v3_ai_history canonical signature not found';
  END IF;

  v_ddl := pg_get_functiondef(v_oid);
  v_next := replace(v_ddl, 'total_latency_ms AS lat', 'latency_ms AS lat');
  v_next := replace(
    v_next,
    '''latency_source'', CASE WHEN l.ai_avg_latency_ms IS NOT NULL THEN ''ai_usage_ledger''
                             WHEN r.e2e_avg_latency_ms IS NOT NULL THEN ''agent_runs'' ELSE ''none'' END',
    '''latency_source'', CASE WHEN l.ai_avg_latency_ms IS NOT NULL THEN ''ai_usage_ledger'' ELSE ''none'' END'
  );

  IF v_next = v_ddl OR position('total_latency_ms' IN v_next) > 0 THEN
    RAISE EXCEPTION 'admin_v3_ai_history stale latency column pattern not fully replaced';
  END IF;

  EXECUTE v_next;
END
$migration$;

REVOKE ALL ON FUNCTION public.admin_v3_ai_history(date, date, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_v3_ai_history(date, date, text, text, text, text, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';