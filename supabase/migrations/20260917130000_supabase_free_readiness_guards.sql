-- Supabase Free readiness: stop technical write amplification before migration.
-- This migration is intentionally non-destructive. Historical compaction lives in
-- supabase/scripts/supabase_free_readiness_cleanup.sql and is executed explicitly.

-- 1) Do not persist the same financial evidence every 30-minute diagnosis cycle.
CREATE OR REPLACE FUNCTION public.nino_diag_evidence_dedupe_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_last public.financial_situation_evidence;
BEGIN
  SELECT * INTO v_last
  FROM public.financial_situation_evidence
  WHERE situation_id = NEW.situation_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  IF FOUND
     AND v_last.evidence_type IS NOT DISTINCT FROM NEW.evidence_type
     AND v_last.metric_key IS NOT DISTINCT FROM NEW.metric_key
     AND v_last.value IS NOT DISTINCT FROM NEW.value
     AND v_last.contribution_amount IS NOT DISTINCT FROM NEW.contribution_amount
     AND v_last.contribution_pct IS NOT DISTINCT FROM NEW.contribution_pct
     AND v_last.confidence IS NOT DISTINCT FROM NEW.confidence
     AND v_last.metadata IS NOT DISTINCT FROM NEW.metadata
  THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS nino_diag_evidence_dedupe_guard ON public.financial_situation_evidence;
CREATE TRIGGER nino_diag_evidence_dedupe_guard
BEFORE INSERT ON public.financial_situation_evidence
FOR EACH ROW EXECUTE FUNCTION public.nino_diag_evidence_dedupe_guard();

-- 2) The diagnosis evaluator temporarily marks current situations as `observed`
-- before revalidating them. Those internal transitions are not business events.
CREATE OR REPLACE FUNCTION public.nino_diag_situation_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.financial_situation_events(
      user_id, situation_id, event_type, to_status, delta_amount, narrative
    ) VALUES (
      NEW.user_id, NEW.id, 'detected', NEW.status, NEW.impact_amount,
      coalesce(NEW.one_line_summary, NEW.headline)
    ) ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  -- Ignore the synthetic state used only while the scheduled evaluator runs.
  IF OLD.status IN ('active','confirmed','improving','worsening')
     AND NEW.status = 'observed'
     AND NEW.severity IS NOT DISTINCT FROM OLD.severity
     AND NEW.impact_amount IS NOT DISTINCT FROM OLD.impact_amount
  THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'observed'
     AND NEW.status IN ('active','confirmed','improving','worsening')
     AND NEW.severity IS NOT DISTINCT FROM OLD.severity
     AND NEW.impact_amount IS NOT DISTINCT FROM OLD.impact_amount
  THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.severity IS NOT DISTINCT FROM OLD.severity
     AND NEW.impact_amount IS NOT DISTINCT FROM OLD.impact_amount
  THEN
    RETURN NEW;
  END IF;

  v_type := CASE
    WHEN NEW.status = 'resolved' THEN 'resolved'
    WHEN NEW.status = 'expired' THEN 'expired'
    WHEN NEW.supersedes_id IS NOT NULL AND OLD.supersedes_id IS NULL THEN 'superseded'
    WHEN NEW.status = 'confirmed' AND OLD.status <> 'confirmed' THEN 'confirmed'
    WHEN NEW.status = 'improving' OR coalesce(NEW.impact_amount,0) < coalesce(OLD.impact_amount,0) THEN 'improved'
    ELSE 'worsened'
  END;

  INSERT INTO public.financial_situation_events(
    user_id, situation_id, event_type, from_status, to_status,
    delta_amount, narrative, metadata
  ) VALUES (
    NEW.user_id, NEW.id, v_type, OLD.status, NEW.status,
    coalesce(NEW.impact_amount,0)-coalesce(OLD.impact_amount,0),
    CASE v_type
      WHEN 'improved' THEN 'A situação melhorou desde a leitura anterior.'
      WHEN 'resolved' THEN 'A situação foi resolvida.'
      WHEN 'expired' THEN 'A janela desta situação terminou.'
      WHEN 'confirmed' THEN 'A situação foi confirmada por novas evidências.'
      ELSE 'A situação exige mais atenção do que na leitura anterior.'
    END,
    jsonb_build_object('from_severity',OLD.severity,'to_severity',NEW.severity)
  );
  RETURN NEW;
END;
$function$;

-- 3) Keep at most one identical live diagnosis snapshot per user/day. A new
-- snapshot is still created immediately whenever any material diagnosis field changes.
CREATE OR REPLACE FUNCTION public.nino_assemble_diagnosis(
  _user_id uuid,
  _as_of date DEFAULT CURRENT_DATE,
  _run_mode text DEFAULT 'live'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_primary public.financial_situations;
  v_supporting uuid[] := '{}';
  v_action uuid;
  v_state text := 'stable';
  v_conf numeric := 0;
  v_snapshot uuid;
  v_quality jsonb;
  v_payload jsonb;
  v_narrative jsonb;
  v_counter jsonb;
  v_max int := 3;
  v_min numeric := .60;
  v_suppressed uuid[] := '{}';
  v_forecast jsonb;
  v_rationale jsonb;
  v_current public.nino_diagnosis_snapshots;
BEGIN
  PERFORM public.nino_diag_resolve_conflicts(_user_id,_run_mode);
  SELECT max_supporting,min_primary_confidence
    INTO v_max,v_min
  FROM public.nino_diagnosis_config WHERE singleton;

  SELECT coalesce(array_agg(s),'{}') INTO v_suppressed
  FROM public.nino_diag_feedback_suppressed(_user_id) s;

  SELECT * INTO v_primary
  FROM public.financial_situations s
  WHERE s.user_id=_user_id AND s.run_mode=_run_mode
    AND s.status IN ('active','confirmed','improving','worsening')
    AND s.temporal_scope IN ('now','future')
    AND s.situation_type NOT IN ('data_quality_issue','duplicate_review','shared_payment_confirmation','behavioral_pattern')
    AND s.confidence>=v_min
    AND (s.valid_until IS NULL OR s.valid_until>now())
    AND (s.severity='critical' OR NOT (s.id = ANY(v_suppressed)))
  ORDER BY CASE s.severity WHEN 'critical' THEN 4 WHEN 'attention' THEN 3 WHEN 'positive' THEN 2 ELSE 1 END DESC,
           s.relevance_score DESC
  LIMIT 1;

  IF v_primary.id IS NOT NULL THEN
    UPDATE public.financial_situations
       SET narrative_role='primary', one_line_summary=coalesce(one_line_summary,headline)
     WHERE id=v_primary.id;

    SELECT id INTO v_action
    FROM public.financial_situation_actions
    WHERE situation_id=v_primary.id AND status IN ('proposed','accepted','in_progress')
    ORDER BY priority DESC LIMIT 1;

    v_state := CASE v_primary.severity
      WHEN 'critical' THEN 'critical'
      WHEN 'attention' THEN 'attention'
      WHEN 'positive' THEN 'positive'
      ELSE 'stable' END;
    v_conf := v_primary.confidence;
  ELSIF NOT EXISTS(
    SELECT 1 FROM public.transactions WHERE user_id=_user_id AND status='confirmed'
  ) THEN
    v_state := 'insufficient_data';
  END IF;

  SELECT coalesce(array_agg(id ORDER BY role_order,relevance_score DESC),'{}')
    INTO v_supporting
  FROM (
    SELECT s.id,s.relevance_score,
           CASE s.narrative_role WHEN 'counterpoint' THEN 1 ELSE 2 END role_order
    FROM public.financial_situations s
    WHERE s.user_id=_user_id AND s.run_mode=_run_mode
      AND s.id IS DISTINCT FROM v_primary.id
      AND s.status IN ('active','confirmed','improving','worsening')
      AND s.temporal_scope IN ('now','future')
      AND s.situation_type NOT IN ('data_quality_issue','duplicate_review','shared_payment_confirmation','behavioral_pattern')
      AND (s.valid_until IS NULL OR s.valid_until>now())
      AND (s.severity='critical' OR NOT (s.id = ANY(v_suppressed)))
    ORDER BY role_order,relevance_score DESC LIMIT v_max
  ) q;

  SELECT to_jsonb(s) INTO v_counter
  FROM public.financial_situations s
  WHERE s.id=ANY(v_supporting) AND s.narrative_role='counterpoint'
  ORDER BY s.relevance_score DESC LIMIT 1;

  v_narrative := jsonb_build_object(
    'conclusion',v_primary.headline,
    'cause',v_primary.cause_summary,
    'counterpoint',v_counter->>'one_line_summary',
    'consequence',v_primary.consequence_summary,
    'forecast',v_primary.forecast_summary,
    'action',(SELECT to_jsonb(a) FROM public.financial_situation_actions a WHERE a.id=v_action)
  );

  v_quality := jsonb_build_object(
    'uncategorized_count',coalesce((
      SELECT (evaluation->>'uncategorized_count')::int
      FROM public.financial_situations
      WHERE user_id=_user_id AND run_mode=_run_mode AND situation_type='data_quality_issue'
      ORDER BY updated_at DESC LIMIT 1
    ),0)
  );

  v_payload := jsonb_build_object(
    'narrative',v_narrative,
    'primary_situation',(SELECT to_jsonb(s) FROM public.financial_situations s WHERE s.id=v_primary.id),
    'primary_action',(SELECT to_jsonb(a) FROM public.financial_situation_actions a WHERE a.id=v_action),
    'supporting_situations',coalesce((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY array_position(v_supporting,s.id))
      FROM public.financial_situations s WHERE s.id=ANY(v_supporting)
    ),'[]')
  );

  v_forecast := jsonb_build_object('summary',v_primary.forecast_summary);
  v_rationale := jsonb_build_object(
    'primary_score',v_primary.relevance_score,
    'supporting_roles',(SELECT coalesce(jsonb_object_agg(id,narrative_role),'{}') FROM public.financial_situations WHERE id=ANY(v_supporting)),
    'conflict_resolution','counterpoints_preserved',
    'feedback_suppressed',coalesce(array_length(v_suppressed,1),0)
  );

  IF _run_mode='live' THEN
    SELECT * INTO v_current
    FROM public.nino_diagnosis_snapshots
    WHERE user_id=_user_id AND run_mode='live' AND is_current
    ORDER BY created_at DESC LIMIT 1;

    IF v_current.id IS NOT NULL
       AND v_current.as_of IS NOT DISTINCT FROM _as_of
       AND v_current.overall_state IS NOT DISTINCT FROM v_state
       AND v_current.primary_situation_id IS NOT DISTINCT FROM v_primary.id
       AND v_current.supporting_situation_ids IS NOT DISTINCT FROM v_supporting
       AND v_current.primary_action_id IS NOT DISTINCT FROM v_action
       AND v_current.forecast IS NOT DISTINCT FROM v_forecast
       AND v_current.data_quality IS NOT DISTINCT FROM v_quality
       AND v_current.confidence IS NOT DISTINCT FROM v_conf
       AND v_current.rationale IS NOT DISTINCT FROM v_rationale
       AND v_current.payload IS NOT DISTINCT FROM v_payload
       AND v_current.contract_version='nino_diagnosis_contract.v1.1'
    THEN
      RETURN v_current.id;
    END IF;

    UPDATE public.nino_diagnosis_snapshots
       SET is_current=false
     WHERE user_id=_user_id AND run_mode='live' AND is_current;
  END IF;

  INSERT INTO public.nino_diagnosis_snapshots(
    user_id,run_mode,as_of,overall_state,primary_situation_id,
    supporting_situation_ids,primary_action_id,forecast,data_quality,
    confidence,rationale,payload,contract_version,is_current
  ) VALUES (
    _user_id,_run_mode,_as_of,v_state,v_primary.id,v_supporting,v_action,
    v_forecast,v_quality,v_conf,v_rationale,v_payload,
    'nino_diagnosis_contract.v1.1',_run_mode='live'
  ) RETURNING id INTO v_snapshot;

  RETURN v_snapshot;
END;
$function$;

-- 4) Keep pg_cron history bounded. The current Lovable database already has
-- physical bloat here; a fresh Supabase project will not carry that bloat, and
-- this retention prevents it from rebuilding.
DO $block$
DECLARE v_jobid bigint;
BEGIN
  IF to_regclass('cron.job') IS NULL OR to_regclass('cron.job_run_details') IS NULL THEN
    RETURN;
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname='nino-cron-history-retention-7d' LIMIT 1;
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    'nino-cron-history-retention-7d',
    '20 4 * * *',
    $cmd$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days';$cmd$
  );
EXCEPTION WHEN undefined_function OR insufficient_privilege THEN
  RAISE NOTICE 'pg_cron retention schedule could not be created in this environment';
END;
$block$;

-- 5) Admin-only capacity snapshot for the migration/free-tier cockpit.
CREATE OR REPLACE FUNCTION public.admin_supabase_capacity_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','storage','auth'
AS $function$
DECLARE
  v_db_bytes bigint;
  v_public_bytes bigint;
  v_storage_bytes bigint;
  v_users bigint;
  v_mau bigint;
  v_top jsonb;
  v_db_limit bigint := 500 * 1024 * 1024;
  v_storage_limit bigint := 1024 * 1024 * 1024;
  v_mau_limit bigint := 50000;
BEGIN
  PERFORM public._require_perm('cockpit.read');

  SELECT pg_database_size(current_database()) INTO v_db_bytes;
  SELECT coalesce(sum(pg_total_relation_size(relid)),0)
    INTO v_public_bytes
  FROM pg_catalog.pg_statio_user_tables
  WHERE schemaname='public';

  SELECT coalesce(sum(
    CASE WHEN coalesce(metadata->>'size','') ~ '^[0-9]+$'
         THEN (metadata->>'size')::bigint ELSE 0 END
  ),0) INTO v_storage_bytes
  FROM storage.objects;

  SELECT count(*), count(*) FILTER (WHERE last_sign_in_at >= now()-interval '30 days')
    INTO v_users,v_mau
  FROM auth.users;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table',relname,
      'rows_estimate',n_live_tup,
      'bytes',bytes
    ) ORDER BY bytes DESC),'[]'::jsonb)
    INTO v_top
  FROM (
    SELECT s.relname,s.n_live_tup,pg_total_relation_size(s.relid) AS bytes
    FROM pg_catalog.pg_stat_user_tables s
    WHERE s.schemaname='public'
    ORDER BY pg_total_relation_size(s.relid) DESC
    LIMIT 8
  ) q;

  RETURN jsonb_build_object(
    'captured_at',now(),
    'database',jsonb_build_object(
      'bytes',v_db_bytes,
      'free_limit_bytes',v_db_limit,
      'usage_pct',round((100.0*v_db_bytes/nullif(v_db_limit,0))::numeric,1)
    ),
    'public_schema',jsonb_build_object('bytes',v_public_bytes),
    'storage',jsonb_build_object(
      'bytes',v_storage_bytes,
      'free_limit_bytes',v_storage_limit,
      'usage_pct',round((100.0*v_storage_bytes/nullif(v_storage_limit,0))::numeric,1)
    ),
    'auth',jsonb_build_object(
      'users',v_users,
      'mau_30d',v_mau,
      'free_mau_limit',v_mau_limit,
      'mau_usage_pct',round((100.0*v_mau/nullif(v_mau_limit,0))::numeric,2)
    ),
    'top_tables',v_top,
    'free_target',jsonb_build_object(
      'database_bytes',v_db_limit,
      'storage_bytes',v_storage_limit,
      'mau',v_mau_limit
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_supabase_capacity_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_supabase_capacity_snapshot() TO authenticated;
