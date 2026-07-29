-- Meu Nino P0 — operational truth, admin commands and queue contracts.
-- Additive/idempotent migration. No user data is deleted or rewritten.

CREATE OR REPLACE FUNCTION public.admin_platform_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $function$
DECLARE
  res jsonb;
  v_active_prompt boolean;
  v_last_health record;
  v_recent_health_failures integer := 0;
  v_outbox_queued integer := 0;
  v_outbox_failed integer := 0;
  v_due_outbox integer := 0;
  v_oldest_due_outbox timestamptz;
  v_due_split integer := 0;
  v_oldest_due_split timestamptz;
  v_wa_status text;
  v_wa_error_code text;
  v_agent_failures_24h integer := 0;
  v_agent_status text;
  v_active_links integer := 0;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.agent_prompt_versions WHERE status = 'active'
  ) INTO v_active_prompt;

  SELECT *
    INTO v_last_health
    FROM public.provider_health_events
   WHERE provider = 'waha'
   ORDER BY occurred_at DESC
   LIMIT 1;

  SELECT count(*) FILTER (WHERE NOT h.ok)
    INTO v_recent_health_failures
    FROM (
      SELECT ok
        FROM public.provider_health_events
       WHERE provider = 'waha'
       ORDER BY occurred_at DESC
       LIMIT 2
    ) h;

  SELECT
    count(*) FILTER (WHERE status = 'queued'),
    count(*) FILTER (WHERE status IN ('failed', 'dead'))
    INTO v_outbox_queued, v_outbox_failed
    FROM public.outbound_messages
   WHERE created_at > now() - interval '24 hours';

  SELECT count(*), min(coalesce(next_attempt_at, created_at))
    INTO v_due_outbox, v_oldest_due_outbox
    FROM public.outbound_messages
   WHERE status IN ('queued', 'processing')
     AND coalesce(next_attempt_at, created_at) <= now();

  SELECT count(*), min(coalesce(next_attempt_at, created_at))
    INTO v_due_split, v_oldest_due_split
    FROM public.outbound_messages
   WHERE status IN ('queued', 'processing')
     AND coalesce(next_attempt_at, created_at) <= now()
     AND (
       coalesce(kind, '') LIKE 'split%'
       OR coalesce(context_type, '') LIKE 'split%'
       OR coalesce(feature, '') IN ('split', 'split_invite', 'split_reminder')
     );

  SELECT count(*)
    INTO v_active_links
    FROM public.whatsapp_links
   WHERE status = 'active';

  SELECT count(*)
    INTO v_agent_failures_24h
    FROM public.agent_runs
   WHERE started_at > now() - interval '24 hours'
     AND status = 'error';

  -- A customer link is not a provider session. Never infer that the official
  -- WhatsApp is disconnected from whatsapp_links.
  IF v_last_health IS NULL THEN
    v_wa_status := 'unverifiable';
    v_wa_error_code := 'no_health_signal';
  ELSIF v_last_health.occurred_at < now() - interval '15 minutes' THEN
    v_wa_status := 'unverifiable';
    v_wa_error_code := 'stale_health';
  ELSIF v_last_health.ok THEN
    v_wa_status := 'connected';
    v_wa_error_code := NULL;
  ELSIF upper(coalesce(v_last_health.error_masked, '')) = 'STOPPED' THEN
    v_wa_status := 'disconnected';
    v_wa_error_code := 'session_stopped';
  ELSE
    -- A single transient STARTING/FAILED event is not a disconnection.
    v_wa_status := 'unstable';
    v_wa_error_code := CASE
      WHEN v_recent_health_failures >= 2
        THEN coalesce(v_last_health.error_masked, 'provider_unstable')
      ELSE 'transient_health_failure'
    END;
  END IF;

  -- The Nino engine and the WhatsApp transport are independent capabilities.
  IF NOT v_active_prompt THEN
    v_agent_status := 'not_setup';
  ELSIF v_agent_failures_24h > 10 THEN
    v_agent_status := 'attention';
  ELSE
    v_agent_status := 'working';
  END IF;

  WITH expected_jobs(job_key, cron_job, due_count, oldest_due, tolerance) AS (
    VALUES
      ('whatsapp-send', 'whatsapp-send-dispatch-1m', v_due_outbox, v_oldest_due_outbox, interval '5 minutes'),
      ('split-reminders-dispatch', 'split-message-pipeline-1m', v_due_split, v_oldest_due_split, interval '10 minutes'),
      ('whatsapp-ack-watchdog', NULL::text, 0::integer, NULL::timestamptz, interval '10 minutes'),
      ('recurring-generate', NULL::text, 0::integer, NULL::timestamptz, interval '10 minutes')
  ),
  merged AS (
    SELECT
      e.job_key,
      h.last_run_at,
      h.last_ok,
      h.last_error_code,
      coalesce(h.processed, 0) AS processed,
      coalesce(h.failed, 0) AS failed,
      h.next_run_at,
      e.due_count,
      e.oldest_due,
      e.tolerance,
      CASE
        WHEN e.cron_job IS NULL THEN false
        ELSE EXISTS (
          SELECT 1 FROM cron.job c
           WHERE c.jobname = e.cron_job AND c.active
        )
      END AS cron_active
    FROM expected_jobs e
    LEFT JOIN public.job_heartbeats h USING (job_key)
  ),
  classified AS (
    SELECT
      *,
      CASE
        WHEN NOT cron_active AND job_key IN ('whatsapp-ack-watchdog', 'recurring-generate')
          THEN 'not_scheduled'
        WHEN NOT cron_active THEN 'failing'
        WHEN last_ok = false THEN 'failing'
        WHEN due_count > 0 AND oldest_due < now() - tolerance THEN 'delayed'
        WHEN due_count = 0 THEN 'idle'
        ELSE 'healthy'
      END AS job_status,
      CASE
        WHEN NOT cron_active AND job_key NOT IN ('whatsapp-ack-watchdog', 'recurring-generate')
          THEN 'cron_inactive'
        ELSE last_error_code
      END AS effective_error
    FROM merged
  )
  SELECT jsonb_build_object(
    'whatsapp', jsonb_build_object(
      'status', v_wa_status,
      'error_code', v_wa_error_code,
      'latency_ms', v_last_health.latency_ms,
      'last_seen_at', v_last_health.occurred_at,
      'active_links', v_active_links,
      'source', 'provider_health'
    ),
    'agent', jsonb_build_object(
      'status', v_agent_status,
      'active_prompt', v_active_prompt,
      'failures_24h', v_agent_failures_24h
    ),
    'jobs', (
      SELECT jsonb_object_agg(job_key, jsonb_build_object(
        'status', job_status,
        'last_run_at', last_run_at,
        'next_run_at', next_run_at,
        'last_error_code', effective_error,
        'processed', processed,
        'failed', failed
      ))
      FROM classified
    ),
    'outbox', jsonb_build_object(
      'queued', v_outbox_queued,
      'failed', v_outbox_failed
    )
  ) INTO res;

  RETURN res;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_communication_catalog_update(
  _kind text,
  _active boolean DEFAULT NULL,
  _base_priority integer DEFAULT NULL,
  _allowed_channels text[] DEFAULT NULL,
  _cooldown_hours integer DEFAULT NULL,
  _max_per_day integer DEFAULT NULL,
  _requires_manual_approval boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.communication_catalog%ROWTYPE;
BEGIN
  PERFORM public._require_perm('messaging.write');

  UPDATE public.communication_catalog SET
    active = coalesce(_active, active),
    base_priority = coalesce(_base_priority, base_priority),
    allowed_channels = coalesce(_allowed_channels, allowed_channels),
    cooldown_hours = coalesce(_cooldown_hours, cooldown_hours),
    max_per_day = coalesce(_max_per_day, max_per_day),
    requires_manual_approval = coalesce(_requires_manual_approval, requires_manual_approval),
    updated_at = now()
  WHERE kind = _kind
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'kind_not_found' USING errcode = 'P0002';
  END IF;

  INSERT INTO public.platform_admin_audit (actor_user_id, action, meta)
  VALUES (
    auth.uid(),
    'communication_catalog_update',
    jsonb_build_object(
      'target_type', 'communication_catalog',
      'target_id', _kind,
      'active', v_row.active,
      'base_priority', v_row.base_priority,
      'allowed_channels', to_jsonb(v_row.allowed_channels),
      'cooldown_hours', v_row.cooldown_hours,
      'max_per_day', v_row.max_per_day,
      'requires_manual_approval', v_row.requires_manual_approval
    )
  );

  RETURN to_jsonb(v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_communication_template_upsert(
  _kind text,
  _channel text,
  _title_template text,
  _body_template text,
  _active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_version integer;
  v_row public.communication_templates%ROWTYPE;
  v_unknown text[];
  v_allowed constant text[] := ARRAY[
    'title','body','kind','severity','dedup_key','action_url',
    'amount','count','description','remaining','days_left','monthly_needed',
    'category','share','current','avg','due','occurred_at'
  ];
BEGIN
  PERFORM public._require_perm('messaging.write');
  IF _channel NOT IN ('app', 'whatsapp') THEN
    RAISE EXCEPTION 'invalid_channel';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.communication_catalog WHERE kind = _kind) THEN
    RAISE EXCEPTION 'kind_not_found';
  END IF;
  IF length(trim(coalesce(_title_template, ''))) = 0
     OR length(trim(coalesce(_body_template, ''))) = 0 THEN
    RAISE EXCEPTION 'template_required';
  END IF;

  SELECT array_agg(DISTINCT variable_name)
    INTO v_unknown
    FROM (
      SELECT variable_match[1] AS variable_name
      FROM regexp_matches(
        _title_template || ' ' || _body_template,
        '\{\{\s*([a-zA-Z0-9_]+)\s*\}\}',
        'g'
      ) AS m(variable_match)
    ) vars
   WHERE NOT (variable_name = ANY(v_allowed));

  IF coalesce(array_length(v_unknown, 1), 0) > 0 THEN
    RAISE EXCEPTION 'unknown_template_variables:%', array_to_string(v_unknown, ',');
  END IF;

  SELECT coalesce(max(version), 0) + 1
    INTO v_version
    FROM public.communication_templates
   WHERE kind = _kind AND channel = _channel;

  IF _active THEN
    UPDATE public.communication_templates
       SET active = false, updated_by = auth.uid(), updated_at = now()
     WHERE kind = _kind AND channel = _channel AND active;
  END IF;

  INSERT INTO public.communication_templates (
    kind, channel, title_template, body_template, allowed_variables,
    active, version, created_by, updated_by
  ) VALUES (
    _kind, _channel, trim(_title_template), trim(_body_template), v_allowed,
    _active, v_version, auth.uid(), auth.uid()
  )
  RETURNING * INTO v_row;

  INSERT INTO public.platform_admin_audit (actor_user_id, action, meta)
  VALUES (
    auth.uid(),
    'communication_template_upsert',
    jsonb_build_object(
      'target_type', 'communication_template',
      'target_id', v_row.id,
      'kind', _kind,
      'channel', _channel,
      'version', v_version,
      'active', _active
    )
  );

  RETURN to_jsonb(v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_proactive_engine_toggle(
  _enabled boolean DEFAULT NULL,
  _channels text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.agent_settings%ROWTYPE;
BEGIN
  PERFORM public._require_perm('operations.write');

  IF _channels IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM unnest(_channels) channel_name
       WHERE channel_name NOT IN ('app', 'whatsapp')
     ) THEN
    RAISE EXCEPTION 'invalid_channel';
  END IF;

  UPDATE public.agent_settings SET
    proactive_enabled = coalesce(_enabled, proactive_enabled),
    proactive_channels = coalesce(_channels, proactive_channels),
    updated_by = auth.uid(),
    updated_at = now()
  WHERE id = 1
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent_settings_not_found' USING errcode = 'P0002';
  END IF;

  INSERT INTO public.platform_admin_audit (actor_user_id, action, meta)
  VALUES (
    auth.uid(),
    'proactive_engine_toggle',
    jsonb_build_object(
      'target_type', 'agent_settings',
      'target_id', 1,
      'enabled', v_row.proactive_enabled,
      'channels', to_jsonb(v_row.proactive_channels)
    )
  );

  RETURN jsonb_build_object(
    'enabled', v_row.proactive_enabled,
    'channels', to_jsonb(v_row.proactive_channels)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_message_reprocess(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  actor uuid := auth.uid();
  cur record;
BEGIN
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT id, user_id, status, attempts, metadata, channel
    INTO cur
    FROM public.outbound_messages
   WHERE id = p_id
   FOR UPDATE;

  IF cur.id IS NULL THEN
    RAISE EXCEPTION 'not_found' USING errcode = 'P0002';
  END IF;
  IF cur.channel = 'inapp' THEN
    RAISE EXCEPTION 'inapp_not_reprocessable' USING errcode = '22023';
  END IF;
  IF cur.status::text NOT IN ('failed', 'dead') THEN
    RAISE EXCEPTION 'not_reprocessable_state' USING errcode = '22023';
  END IF;

  UPDATE public.outbound_messages
     SET status = 'queued'::msg_status,
         next_attempt_at = now(),
         last_error = NULL,
         claimed_at = NULL,
         lease_expires_at = NULL,
         metadata = coalesce(metadata, '{}'::jsonb)
           || jsonb_build_object(
             'reprocessed_at', to_jsonb(now()),
             'reprocessed_by', to_jsonb(actor),
             'reprocessed_count', coalesce((metadata->>'reprocessed_count')::integer, 0) + 1
           ),
         updated_at = now()
   WHERE id = p_id;

  INSERT INTO public.platform_admin_audit (
    actor_user_id, target_user_id, action, meta
  ) VALUES (
    actor,
    cur.user_id,
    'message_reprocess',
    jsonb_build_object(
      'target_type', 'outbound_message',
      'target_id', p_id,
      'previous_status', cur.status::text,
      'attempts', cur.attempts
    )
  );

  RETURN jsonb_build_object('ok', true, 'id', p_id);
END;
$function$;

COMMENT ON FUNCTION public.admin_platform_status() IS
  'Canonical admin snapshot. Provider session, customer links and agent health are independent signals.';