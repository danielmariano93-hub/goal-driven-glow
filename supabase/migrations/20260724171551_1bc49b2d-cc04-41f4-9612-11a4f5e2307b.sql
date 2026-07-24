-- Reaplica a migration versionada no repositório
-- Fonte: supabase/migrations/20260724180000_admin_control_center_contract_repair.sql

INSERT INTO public.platform_permissions (role, action, allowed) VALUES
  ('platform_owner','cockpit.read',true),
  ('platform_admin','cockpit.read',true),
  ('support','cockpit.read',true),
  ('analyst','cockpit.read',true),
  ('platform_owner','growth.read',true),
  ('platform_admin','growth.read',true),
  ('support','growth.read',false),
  ('analyst','growth.read',true),
  ('platform_owner','product_intel.read',true),
  ('platform_admin','product_intel.read',true),
  ('support','product_intel.read',false),
  ('analyst','product_intel.read',true),
  ('platform_owner','clients.read',true),
  ('platform_admin','clients.read',true),
  ('support','clients.read',true),
  ('analyst','clients.read',false),
  ('platform_owner','clients.identity.read',true),
  ('platform_admin','clients.identity.read',true),
  ('support','clients.identity.read',false),
  ('analyst','clients.identity.read',false),
  ('platform_owner','clients.identity.masked',true),
  ('platform_admin','clients.identity.masked',true),
  ('support','clients.identity.masked',true),
  ('analyst','clients.identity.masked',false),
  ('platform_owner','operations.read',true),
  ('platform_admin','operations.read',true),
  ('support','operations.read',true),
  ('analyst','operations.read',true),
  ('platform_owner','messaging.read',true),
  ('platform_admin','messaging.read',true),
  ('support','messaging.read',true),
  ('analyst','messaging.read',true),
  ('platform_owner','whatsapp.read',true),
  ('platform_admin','whatsapp.read',true),
  ('support','whatsapp.read',true),
  ('analyst','whatsapp.read',true),
  ('platform_owner','audit.read',true),
  ('platform_admin','audit.read',true),
  ('support','audit.read',false),
  ('analyst','audit.read',true)
ON CONFLICT (role, action)
DO UPDATE SET allowed = excluded.allowed, updated_at = now();

DROP FUNCTION IF EXISTS public.admin_v2_operations_health();

CREATE OR REPLACE FUNCTION public.admin_v2_operations_health(_hours integer DEFAULT 24)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cutoff timestamptz := now() - make_interval(hours => greatest(_hours, 1));
BEGIN
  PERFORM public._require_perm('operations.read');
  RETURN jsonb_build_object(
    'services',
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'job_key', j.job_key, 'last_run_at', j.last_run_at, 'next_run_at', j.next_run_at,
        'last_ok', j.last_ok, 'processed', coalesce(j.processed,0), 'failed', coalesce(j.failed,0),
        'last_error_code', j.last_error_code) ORDER BY j.job_key), '[]'::jsonb)
     FROM public.job_heartbeats j),
    'agent',
    (SELECT jsonb_build_object(
        'runs', count(*)::int,
        'runs_ok', count(*) filter (where status::text = 'done')::int,
        'runs_error', count(*) filter (where status::text = 'error')::int,
        'success_rate', CASE WHEN count(*)=0 THEN null
          ELSE round((count(*) filter (where status::text='done'))::numeric/count(*)*100,1) END,
        'p50_ms', percentile_cont(0.50) within group (order by latency_ms) filter (where latency_ms is not null),
        'p95_ms', percentile_cont(0.95) within group (order by latency_ms) filter (where latency_ms is not null))
     FROM public.agent_runs WHERE started_at >= v_cutoff),
    'measurement_started_at', v_cutoff,
    'timezone', 'America/Sao_Paulo',
    'formula_version', 'operations.health.v3'
  );
END; $$;

CREATE OR REPLACE FUNCTION public.admin_v2_ia_ocr_metrics(_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cutoff timestamptz := now() - make_interval(days => greatest(_days, 1));
BEGIN
  PERFORM public._require_perm('operations.read');
  RETURN jsonb_build_object(
    'totals',
    (SELECT jsonb_build_object(
        'uploaded', count(*)::int,
        'confirmed', count(*) filter (where status='confirmed')::int,
        'partially_confirmed', count(*) filter (where status='partially_confirmed')::int,
        'partial', count(*) filter (where status='partial')::int,
        'failed', count(*) filter (where status='failed')::int,
        'canceled', count(*) filter (where status='canceled')::int,
        'eligible', count(*) filter (where status <> 'canceled')::int,
        'confirmation_rate', CASE WHEN count(*) filter (where status <> 'canceled')=0 THEN null
          ELSE round((count(*) filter (where status='confirmed'))::numeric/(count(*) filter (where status <> 'canceled'))*100,1) END,
        'failure_rate', CASE WHEN count(*) filter (where status <> 'canceled')=0 THEN null
          ELSE round((count(*) filter (where status='failed'))::numeric/(count(*) filter (where status <> 'canceled'))*100,1) END,
        'p50_ms', percentile_cont(0.50) within group (order by extraction_ms) filter (where extraction_ms is not null),
        'p95_ms', percentile_cont(0.95) within group (order by extraction_ms) filter (where extraction_ms is not null),
        'backlog', count(*) filter (where status not in ('confirmed','partially_confirmed','partial','failed','canceled'))::int)
     FROM public.document_imports WHERE created_at >= v_cutoff),
    'daily',
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'day', day, 'uploaded', uploaded, 'confirmed', confirmed,
        'partial', partial, 'failed', failed, 'canceled', canceled) ORDER BY day), '[]'::jsonb)
     FROM (SELECT (created_at at time zone 'America/Sao_Paulo')::date as day,
             count(*)::int as uploaded,
             count(*) filter (where status='confirmed')::int as confirmed,
             count(*) filter (where status in ('partial','partially_confirmed'))::int as partial,
             count(*) filter (where status='failed')::int as failed,
             count(*) filter (where status='canceled')::int as canceled
           FROM public.document_imports WHERE created_at >= v_cutoff GROUP BY 1) d),
    'source_kind', 'live',
    'timezone', 'America/Sao_Paulo',
    'formula_version', 'ocr.v3'
  );
END; $$;

CREATE OR REPLACE FUNCTION public.admin_v2_whatsapp_monitor(_days integer DEFAULT 14)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cutoff timestamptz := now() - make_interval(days => greatest(_days, 1));
  v_receipts boolean;
BEGIN
  PERFORM public._require_perm('whatsapp.read');
  SELECT exists(SELECT 1 FROM public.outbound_messages
    WHERE created_at >= v_cutoff AND provider::text='waha'
      AND (delivered_at is not null OR read_at is not null)) INTO v_receipts;
  RETURN jsonb_build_object(
    'receipts_available', v_receipts,
    'last_inbound_at', (SELECT max(received_at) FROM public.inbound_messages WHERE provider::text='waha'),
    'last_outbound_at', (SELECT max(coalesce(sent_at, created_at)) FROM public.outbound_messages WHERE provider::text='waha'),
    'totals',
    (SELECT jsonb_build_object(
        'attempts', count(*)::int,
        'sent', count(*) filter (where status::text in ('sent','delivered','read') or sent_at is not null)::int,
        'delivered', count(*) filter (where delivered_at is not null)::int,
        'read', count(*) filter (where read_at is not null)::int,
        'failed', count(*) filter (where status::text in ('failed','dead'))::int,
        'backlog', count(*) filter (where status::text not in ('sent','delivered','read','failed','dead'))::int)
     FROM public.outbound_messages WHERE created_at >= v_cutoff AND provider::text='waha'),
    'daily',
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'day', day, 'attempts', attempts, 'sent', sent, 'failed', failed) ORDER BY day), '[]'::jsonb)
     FROM (SELECT (created_at at time zone 'America/Sao_Paulo')::date as day,
             count(*)::int as attempts,
             count(*) filter (where status::text in ('sent','delivered','read') or sent_at is not null)::int as sent,
             count(*) filter (where status::text in ('failed','dead'))::int as failed
           FROM public.outbound_messages WHERE created_at >= v_cutoff AND provider::text='waha' GROUP BY 1) d),
    'timezone', 'America/Sao_Paulo',
    'formula_version', 'whatsapp.v3'
  );
END; $$;

CREATE OR REPLACE FUNCTION public.admin_v2_growth_funnel(_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cutoff timestamptz := now() - make_interval(days => greatest(_days, 1));
BEGIN
  PERFORM public._require_perm('growth.read');
  RETURN jsonb_build_object(
    'funnel',
    (WITH normalized AS (
       SELECT feature, pseudo_id,
         CASE WHEN event_name IN ('ocr_document_uploaded','split_created') THEN 'initiated'
              WHEN event_name IN ('financial_entry_created','goal_created','ocr_document_confirmed') THEN 'completed'
              WHEN event_name IN ('agent_response_delivered','whatsapp_message_sent') AND outcome IN ('success','partial') THEN 'value_delivered'
              ELSE NULL END AS step
       FROM public.product_events WHERE occurred_at >= v_cutoff),
     grouped AS (
       SELECT feature, step, count(distinct pseudo_id)::int as users, count(*)::int as events
       FROM normalized WHERE step IS NOT NULL GROUP BY feature, step)
     SELECT coalesce(jsonb_agg(jsonb_build_object(
       'feature', feature, 'step', step, 'users', users, 'events', events) ORDER BY feature, step), '[]'::jsonb)
     FROM grouped),
    'source_quality',
    (SELECT jsonb_build_object(
        'live', count(*) filter (where event_source::text='live')::int,
        'backfill', count(*) filter (where event_source::text='backfill')::int,
        'proxy', count(*) filter (where event_source::text='backfill_proxy')::int)
     FROM public.product_events WHERE occurred_at >= v_cutoff),
    'timezone', 'America/Sao_Paulo',
    'formula_version', 'growth.funnel.v3'
  );
END; $$;

CREATE OR REPLACE FUNCTION public.admin_v2_clients_identity(_pseudo_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._require_perm('clients.identity.read');
  INSERT INTO public.platform_admin_audit (actor_user_id, target_user_id, action, meta)
  SELECT auth.uid(), up.user_id, 'clients.identity.read',
         jsonb_build_object('pseudo_id', up.pseudo_id)
  FROM public.user_pseudonyms up WHERE up.pseudo_id = any(_pseudo_ids);
  RETURN jsonb_build_object('clients',
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
       'pseudo_id', up.pseudo_id, 'display_name', pr.display_name, 'email', au.email)), '[]'::jsonb)
     FROM public.user_pseudonyms up
     LEFT JOIN public.profiles pr ON pr.id = up.user_id
     LEFT JOIN auth.users au ON au.id = up.user_id
     WHERE up.pseudo_id = any(_pseudo_ids)));
END; $$;

CREATE OR REPLACE FUNCTION public.admin_v2_clients_identity_masked(_pseudo_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._require_perm('clients.identity.masked');
  INSERT INTO public.platform_admin_audit (actor_user_id, target_user_id, action, meta)
  SELECT auth.uid(), up.user_id, 'clients.identity.masked',
         jsonb_build_object('pseudo_id', up.pseudo_id)
  FROM public.user_pseudonyms up WHERE up.pseudo_id = any(_pseudo_ids);
  RETURN jsonb_build_object('clients',
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
       'pseudo_id', up.pseudo_id,
       'display_name', case when pr.display_name is null then null
                        else split_part(pr.display_name,' ',1)||' ***' end,
       'email', case when au.email is null or position('@' in au.email)=0 then null
                 else left(split_part(au.email,'@',1),2)||'***@'||split_part(au.email,'@',2) end)), '[]'::jsonb)
     FROM public.user_pseudonyms up
     LEFT JOIN public.profiles pr ON pr.id = up.user_id
     LEFT JOIN auth.users au ON au.id = up.user_id
     WHERE up.pseudo_id = any(_pseudo_ids)));
END; $$;

CREATE OR REPLACE FUNCTION public.admin_v2_audit_list(_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._require_perm('audit.read');
  RETURN jsonb_build_object(
    'events',
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
       'action', a.action, 'actor_user_id', a.actor_user_id, 'actor_email', actor.email,
       'target_user_id', a.target_user_id, 'target_email', target.email,
       'meta', a.meta, 'created_at', a.created_at) ORDER BY a.created_at DESC), '[]'::jsonb)
     FROM (SELECT * FROM public.platform_admin_audit ORDER BY created_at DESC LIMIT least(greatest(_limit,1),500)) a
     LEFT JOIN auth.users actor ON actor.id = a.actor_user_id
     LEFT JOIN auth.users target ON target.id = a.target_user_id),
    'instrumentation_started_at', (SELECT min(created_at) FROM public.platform_admin_audit),
    'formula_version', 'audit.v3'
  );
END; $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS signature
           FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname LIKE 'admin_v2_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.signature);
    BEGIN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.signature);
    EXCEPTION WHEN OTHERS THEN NULL; END;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.signature);
  END LOOP;
END $$;