
-- =========================================================
-- Admin: source of truth for "consumer users" + platform status
-- =========================================================

-- 1) Consumer users view (single source of truth)
CREATE OR REPLACE VIEW public.admin_consumer_users
WITH (security_invoker = false)
AS
SELECT u.id AS user_id, u.email::text AS email, u.created_at, u.last_sign_in_at
FROM auth.users u
WHERE public.is_platform_admin()  -- gate: only admins see this view
  AND NOT EXISTS (
    SELECT 1 FROM public.platform_admins pa
    WHERE pa.user_id = u.id AND pa.active = true
  )
  AND (
    EXISTS (SELECT 1 FROM public.user_financial_settings ufs
            WHERE ufs.user_id = u.id AND ufs.approximate_monthly_income IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.profiles p
               WHERE p.id = u.id AND p.onboarding_completed_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.transactions t WHERE t.user_id = u.id)
    OR EXISTS (SELECT 1 FROM public.goals g WHERE g.user_id = u.id)
    OR EXISTS (SELECT 1 FROM public.accounts a WHERE a.user_id = u.id)
    OR EXISTS (SELECT 1 FROM public.investments i WHERE i.user_id = u.id)
    OR EXISTS (SELECT 1 FROM public.debts d WHERE d.user_id = u.id)
    OR EXISTS (SELECT 1 FROM public.whatsapp_links wl
               WHERE wl.user_id = u.id AND wl.status = 'active')
  );

GRANT SELECT ON public.admin_consumer_users TO authenticated;
GRANT ALL ON public.admin_consumer_users TO service_role;

-- Variant used inside SECURITY DEFINER functions (no gate; caller already gated)
CREATE OR REPLACE FUNCTION public.admin_consumer_users_set()
RETURNS TABLE(user_id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT u.id, u.email::text, u.created_at, u.last_sign_in_at
  FROM auth.users u
  WHERE NOT EXISTS (
    SELECT 1 FROM public.platform_admins pa
    WHERE pa.user_id = u.id AND pa.active = true
  )
  AND (
    EXISTS (SELECT 1 FROM public.user_financial_settings ufs
            WHERE ufs.user_id = u.id AND ufs.approximate_monthly_income IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.profiles p
               WHERE p.id = u.id AND p.onboarding_completed_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.transactions t WHERE t.user_id = u.id)
    OR EXISTS (SELECT 1 FROM public.goals g WHERE g.user_id = u.id)
    OR EXISTS (SELECT 1 FROM public.accounts a WHERE a.user_id = u.id)
    OR EXISTS (SELECT 1 FROM public.investments i WHERE i.user_id = u.id)
    OR EXISTS (SELECT 1 FROM public.debts d WHERE d.user_id = u.id)
    OR EXISTS (SELECT 1 FROM public.whatsapp_links wl
               WHERE wl.user_id = u.id AND wl.status = 'active')
  );
$$;
REVOKE ALL ON FUNCTION public.admin_consumer_users_set() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_consumer_users_set() TO service_role;

-- 2) Rewrite RPCs to use consumer set

CREATE OR REPLACE FUNCTION public.admin_dashboard_stats()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE res jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  WITH c AS (SELECT * FROM public.admin_consumer_users_set())
  SELECT jsonb_build_object(
    'total_users', (SELECT count(*) FROM c),
    'new_users_7d', (SELECT count(*) FROM c WHERE created_at > now() - interval '7 days'),
    'new_users_30d', (SELECT count(*) FROM c WHERE created_at > now() - interval '30 days'),
    'onboarded_users', (SELECT count(*) FROM public.profiles p
                       JOIN c ON c.user_id = p.id
                       WHERE p.onboarding_completed_at IS NOT NULL),
    'total_transactions', (SELECT count(*) FROM public.transactions t
                          WHERE t.user_id IN (SELECT user_id FROM c)),
    'total_accounts', (SELECT count(*) FROM public.accounts a
                       WHERE a.user_id IN (SELECT user_id FROM c)),
    'total_goals', (SELECT count(*) FROM public.goals g
                    WHERE g.user_id IN (SELECT user_id FROM c)),
    'total_investments', (SELECT count(*) FROM public.investments i
                          WHERE i.user_id IN (SELECT user_id FROM c)),
    'total_debts', (SELECT count(*) FROM public.debts d
                    WHERE d.user_id IN (SELECT user_id FROM c))
  ) INTO res;
  RETURN res;
END $$;

CREATE OR REPLACE FUNCTION public.admin_engagement_stats()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE res jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  WITH c AS (SELECT user_id FROM public.admin_consumer_users_set())
  SELECT jsonb_build_object(
    'dau', (SELECT count(DISTINCT t.user_id) FROM public.transactions t
            JOIN c ON c.user_id = t.user_id WHERE t.created_at > now() - interval '1 day'),
    'wau', (SELECT count(DISTINCT t.user_id) FROM public.transactions t
            JOIN c ON c.user_id = t.user_id WHERE t.created_at > now() - interval '7 days'),
    'mau', (SELECT count(DISTINCT t.user_id) FROM public.transactions t
            JOIN c ON c.user_id = t.user_id WHERE t.created_at > now() - interval '30 days'),
    'activation_first_transaction', (SELECT count(DISTINCT t.user_id) FROM public.transactions t
                                     JOIN c ON c.user_id = t.user_id),
    'activation_first_goal', (SELECT count(DISTINCT g.user_id) FROM public.goals g
                              JOIN c ON c.user_id = g.user_id),
    'activation_whatsapp', (SELECT count(*) FROM public.whatsapp_links wl
                            JOIN c ON c.user_id = wl.user_id WHERE wl.status = 'active'),
    'total_splits', (SELECT count(*) FROM public.shared_expenses se
                     WHERE se.owner_user_id IN (SELECT user_id FROM c)),
    'total_recurring_rules', (SELECT count(*) FROM public.recurring_rules rr
                              WHERE rr.user_id IN (SELECT user_id FROM c)),
    'total_challenges_joined', (SELECT count(*) FROM public.user_challenges uc
                                WHERE uc.user_id IN (SELECT user_id FROM c))
  ) INTO res;
  RETURN res;
END $$;

CREATE OR REPLACE FUNCTION public.admin_agent_stats()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE res jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  WITH c AS (SELECT user_id FROM public.admin_consumer_users_set()),
       r AS (SELECT ar.* FROM public.agent_runs ar WHERE ar.user_id IN (SELECT user_id FROM c))
  SELECT jsonb_build_object(
    'runs_total', (SELECT count(*) FROM r),
    'runs_7d', (SELECT count(*) FROM r WHERE started_at > now() - interval '7 days'),
    'runs_failed_7d', (SELECT count(*) FROM r WHERE started_at > now() - interval '7 days' AND status = 'error'),
    'tokens_7d', (SELECT coalesce(sum(coalesce(tokens_in,0)+coalesce(tokens_out,0)),0) FROM r
                  WHERE started_at > now() - interval '7 days'),
    'cost_usd_7d', (SELECT coalesce(sum(coalesce(cost_cents,0))/100.0,0) FROM r
                    WHERE started_at > now() - interval '7 days')
  ) INTO res;
  RETURN res;
END $$;

CREATE OR REPLACE FUNCTION public.admin_users_list(
  p_search text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
)
RETURNS TABLE(user_id uuid, email text, display_name text, created_at timestamptz,
              onboarding_completed_at timestamptz, last_sign_in_at timestamptz,
              whatsapp_linked boolean, is_platform_admin boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    c.user_id,
    c.email,
    p.display_name,
    c.created_at,
    p.onboarding_completed_at,
    c.last_sign_in_at,
    EXISTS(SELECT 1 FROM public.whatsapp_links wl WHERE wl.user_id = c.user_id AND wl.status = 'active'),
    EXISTS(SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = c.user_id AND pa.active = true)
  FROM public.admin_consumer_users_set() c
  LEFT JOIN public.profiles p ON p.id = c.user_id
  WHERE public.is_platform_admin()
    AND (p_search IS NULL OR p_search = ''
         OR c.email ILIKE '%' || p_search || '%'
         OR coalesce(p.display_name,'') ILIKE '%' || p_search || '%')
  ORDER BY c.created_at DESC
  LIMIT LEAST(coalesce(p_limit, 50), 200)
  OFFSET GREATEST(coalesce(p_offset, 0), 0);
$$;

REVOKE ALL ON FUNCTION public.admin_dashboard_stats() FROM anon;
REVOKE ALL ON FUNCTION public.admin_engagement_stats() FROM anon;
REVOKE ALL ON FUNCTION public.admin_agent_stats() FROM anon;
REVOKE ALL ON FUNCTION public.admin_users_list(text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_engagement_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_agent_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_users_list(text, integer, integer) TO authenticated;

-- 3) Job heartbeats table
CREATE TABLE IF NOT EXISTS public.job_heartbeats (
  job_key text PRIMARY KEY,
  last_run_at timestamptz,
  last_ok boolean,
  last_error_code text,
  processed integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  next_run_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.job_heartbeats TO authenticated;
GRANT ALL ON public.job_heartbeats TO service_role;
ALTER TABLE public.job_heartbeats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "platform admins read heartbeats" ON public.job_heartbeats;
CREATE POLICY "platform admins read heartbeats" ON public.job_heartbeats
  FOR SELECT TO authenticated USING (public.is_platform_admin());

-- 4) admin_platform_status: unified operational status
CREATE OR REPLACE FUNCTION public.admin_platform_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  res jsonb;
  v_active_prompt boolean;
  v_last_health record;
  v_outbox_queued int;
  v_outbox_failed int;
  v_wa_status text;
  v_wa_error_code text;
  v_agent_failures_24h int;
  v_agent_status text;
  v_active_links int;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT EXISTS(SELECT 1 FROM public.agent_prompt_versions WHERE status = 'active')
    INTO v_active_prompt;

  SELECT * INTO v_last_health FROM public.provider_health_events
    WHERE provider = 'waha' ORDER BY occurred_at DESC LIMIT 1;

  SELECT count(*) FILTER (WHERE status = 'queued'),
         count(*) FILTER (WHERE status IN ('failed','dead'))
    INTO v_outbox_queued, v_outbox_failed
    FROM public.outbound_messages
    WHERE created_at > now() - interval '24 hours';

  SELECT count(*) FROM public.whatsapp_links WHERE status = 'active' INTO v_active_links;

  SELECT count(*) INTO v_agent_failures_24h
    FROM public.agent_runs
    WHERE started_at > now() - interval '24 hours' AND status = 'error';

  -- WhatsApp status derivation
  IF v_last_health IS NULL THEN
    v_wa_status := 'not_configured';
    v_wa_error_code := NULL;
  ELSIF v_last_health.occurred_at < now() - interval '15 minutes' THEN
    v_wa_status := 'needs_attention';
    v_wa_error_code := 'stale_health';
  ELSIF v_last_health.ok = false THEN
    v_wa_status := 'needs_attention';
    v_wa_error_code := coalesce(v_last_health.error_masked, 'provider_error');
  ELSIF v_active_links = 0 THEN
    v_wa_status := 'disconnected';
    v_wa_error_code := NULL;
  ELSE
    v_wa_status := 'connected';
    v_wa_error_code := NULL;
  END IF;

  -- Agent status derivation
  IF NOT v_active_prompt THEN
    v_agent_status := 'not_setup';
  ELSIF v_wa_status IN ('not_configured','disconnected') THEN
    v_agent_status := 'attention';
  ELSIF v_wa_status = 'needs_attention' OR v_agent_failures_24h > 10 THEN
    v_agent_status := 'attention';
  ELSE
    v_agent_status := 'working';
  END IF;

  WITH jobs AS (
    SELECT job_key, last_run_at, last_ok, last_error_code, processed, failed, next_run_at
    FROM public.job_heartbeats
    WHERE job_key IN ('whatsapp-send','whatsapp-ack-watchdog','split-reminders-dispatch','recurring-generate')
  ),
  keys AS (
    SELECT unnest(ARRAY['whatsapp-send','whatsapp-ack-watchdog','split-reminders-dispatch','recurring-generate']) AS job_key
  ),
  merged AS (
    SELECT
      k.job_key,
      j.last_run_at,
      j.last_ok,
      j.last_error_code,
      coalesce(j.processed, 0) AS processed,
      coalesce(j.failed, 0) AS failed,
      j.next_run_at,
      CASE
        WHEN j.last_run_at IS NULL THEN 'not_scheduled'
        WHEN j.last_run_at < now() - interval '30 minutes' THEN 'delayed'
        WHEN j.last_ok = false THEN 'failing'
        WHEN coalesce(j.processed, 0) = 0 AND j.last_run_at > now() - interval '30 minutes' THEN 'idle'
        ELSE 'healthy'
      END AS status
    FROM keys k LEFT JOIN jobs j USING (job_key)
  )
  SELECT jsonb_build_object(
    'whatsapp', jsonb_build_object(
      'status', v_wa_status,
      'error_code', v_wa_error_code,
      'latency_ms', v_last_health.latency_ms,
      'last_seen_at', v_last_health.occurred_at,
      'active_links', v_active_links
    ),
    'agent', jsonb_build_object(
      'status', v_agent_status,
      'active_prompt', v_active_prompt,
      'failures_24h', v_agent_failures_24h
    ),
    'jobs', (SELECT jsonb_object_agg(job_key, jsonb_build_object(
      'status', status,
      'last_run_at', last_run_at,
      'next_run_at', next_run_at,
      'last_error_code', last_error_code,
      'processed', processed,
      'failed', failed
    )) FROM merged),
    'outbox', jsonb_build_object('queued', v_outbox_queued, 'failed', v_outbox_failed)
  ) INTO res;

  RETURN res;
END $$;

REVOKE ALL ON FUNCTION public.admin_platform_status() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_platform_status() TO authenticated;

-- 5) Ops actions
CREATE OR REPLACE FUNCTION public.admin_reprocess_failed(p_job_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count int := 0;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  IF p_job_key = 'whatsapp-send' THEN
    UPDATE public.outbound_messages
      SET status = 'queued', attempts = 0, next_attempt_at = now(),
          last_error = NULL, updated_at = now()
      WHERE status IN ('failed','dead');
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSIF p_job_key = 'split-reminders-dispatch' THEN
    UPDATE public.reminder_jobs
      SET status = 'queued', attempts = 0, last_error = NULL, updated_at = now()
      WHERE status = 'failed';
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'unknown_job';
  END IF;

  INSERT INTO public.platform_admin_audit(action, actor_user_id, target, metadata)
    VALUES ('reprocess_failed', auth.uid(), p_job_key,
            jsonb_build_object('count', v_count))
    ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'requeued', v_count);
END $$;

REVOKE ALL ON FUNCTION public.admin_reprocess_failed(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_reprocess_failed(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_run_check(p_job_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  INSERT INTO public.platform_admin_audit(action, actor_user_id, target, metadata)
    VALUES ('run_check', auth.uid(), p_job_key, '{}'::jsonb)
    ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.admin_run_check(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_run_check(text) TO authenticated;
