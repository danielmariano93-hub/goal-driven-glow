-- ============================================================
-- comms_contract.v2 — fechamento do subsistema de comunicação
-- ============================================================

-- 1) Chave lógica de comunicação -----------------------------
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS logical_dedup_key text;
ALTER TABLE public.communication_deliveries
  ADD COLUMN IF NOT EXISTS logical_dedup_key text;

UPDATE public.notifications
   SET logical_dedup_key = CASE
     WHEN dedup_key LIKE 'financial_report:%' THEN 'financial_report:' || id::text
     ELSE dedup_key
   END
 WHERE logical_dedup_key IS NULL AND dedup_key IS NOT NULL;

UPDATE public.communication_deliveries
   SET logical_dedup_key = dedup_key
 WHERE logical_dedup_key IS NULL AND dedup_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_logical_dedup_uniq
  ON public.notifications (user_id, logical_dedup_key)
  WHERE logical_dedup_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS communication_deliveries_user_logical_idx
  ON public.communication_deliveries (user_id, logical_dedup_key, created_at DESC);

-- 2) Telemetria por estágio ----------------------------------
ALTER TABLE public.job_heartbeats
  ADD COLUMN IF NOT EXISTS stages jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.record_job_stages(
  p_job_key text,
  p_stages jsonb DEFAULT '{}'::jsonb,
  p_ok boolean DEFAULT true,
  p_processed integer DEFAULT 0,
  p_failed integer DEFAULT 0,
  p_error_code text DEFAULT NULL,
  p_next_run_at timestamptz DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  merged jsonb;
  k text;
BEGIN
  SELECT coalesce(stages, '{}'::jsonb) INTO merged
    FROM public.job_heartbeats WHERE job_key = p_job_key;
  merged := coalesce(merged, '{}'::jsonb);

  FOR k IN SELECT jsonb_object_keys(coalesce(p_stages, '{}'::jsonb)) LOOP
    merged := jsonb_set(
      merged, ARRAY[k],
      to_jsonb(coalesce((merged->>k)::numeric, 0) + coalesce((p_stages->>k)::numeric, 0)),
      true
    );
  END LOOP;

  INSERT INTO public.job_heartbeats(
    job_key, last_run_at, last_ok, last_error_code, processed, failed, next_run_at, stages, updated_at
  ) VALUES (
    p_job_key, now(), p_ok, p_error_code, coalesce(p_processed,0), coalesce(p_failed,0),
    p_next_run_at, merged, now()
  )
  ON CONFLICT (job_key) DO UPDATE SET
    last_run_at = now(),
    last_ok = excluded.last_ok,
    last_error_code = excluded.last_error_code,
    processed = excluded.processed,
    failed = excluded.failed,
    next_run_at = coalesce(excluded.next_run_at, public.job_heartbeats.next_run_at),
    stages = merged,
    updated_at = now();
END $$;

REVOKE ALL ON FUNCTION public.record_job_stages(text,jsonb,boolean,integer,integer,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_job_stages(text,jsonb,boolean,integer,integer,text,timestamptz) TO service_role;

-- 3) Segredo de cron padronizado -----------------------------
CREATE OR REPLACE FUNCTION public._cron_secret()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE v_name text; v_secret text;
BEGIN
  SELECT name, decrypted_secret INTO v_name, v_secret
    FROM vault.decrypted_secrets
   WHERE name IN ('INTERNAL_CRON_SECRET','CRON_SECRET','meunino_cron_secret','nocontrole_cron_secret')
     AND nullif(decrypted_secret,'') IS NOT NULL
   ORDER BY CASE name
     WHEN 'INTERNAL_CRON_SECRET' THEN 0
     WHEN 'CRON_SECRET' THEN 1
     WHEN 'meunino_cron_secret' THEN 2
     ELSE 3
   END, created_at DESC
   LIMIT 1;

  IF v_name IS NOT NULL AND v_name <> 'INTERNAL_CRON_SECRET' THEN
    RAISE NOTICE 'cron_secret_alias_in_use:%', v_name;
  END IF;
  RETURN v_secret;
END $$;

REVOKE ALL ON FUNCTION public._cron_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._cron_secret() TO service_role;

CREATE OR REPLACE FUNCTION public.whatsapp_send_dispatch_tick()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  secret_value text;
  request_id bigint;
BEGIN
  secret_value := public._cron_secret();
  IF nullif(secret_value, '') IS NULL THEN
    PERFORM public.record_job_stages('whatsapp-send', '{}'::jsonb, false, 0, 1, 'cron_secret_missing', NULL);
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.outbound_messages
     WHERE status IN ('queued','processing')
       AND (next_attempt_at IS NULL OR next_attempt_at <= now())
     LIMIT 1
  ) THEN
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := 'https://wesjjdjmlnfjihkkgzfp.supabase.co/functions/v1/whatsapp-send',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret', secret_value,
      'x-internal-secret', secret_value
    ),
    body := jsonb_build_object('source','pg_cron')
  ) INTO request_id;

  PERFORM public.record_job_stages('whatsapp-send', jsonb_build_object('request_enqueued', 1), true, 0, 0, NULL, NULL);
  RETURN request_id;
END $$;

REVOKE ALL ON FUNCTION public.whatsapp_send_dispatch_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_send_dispatch_tick() TO service_role;

-- 4) Agendador: um slot por dia, sem colisão de tentativas ----
CREATE OR REPLACE FUNCTION public.schedule_split_due_reminders(p_expense_id uuid DEFAULT NULL::uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg public.split_reminder_policy%ROWTYPE;
  v_policy_version text;
  v_added integer := 0;
  r record;
  v_planned timestamptz;
  v_effective timestamptz;
  v_window interval;
  v_base_key text;
  v_key text;
  v_attempts integer;
BEGIN
  SELECT * INTO cfg FROM public.split_reminder_policy WHERE id = 1;
  IF NOT FOUND OR NOT cfg.enabled THEN RETURN 0; END IF;
  v_policy_version := to_char(cfg.updated_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS');

  FOR r IN
    SELECT se.id AS expense_id, se.owner_user_id, se.due_date, p.id AS participant_id, k.kind, k.offset_days
      FROM public.shared_expenses se
      JOIN public.shared_expense_participants p ON p.shared_expense_id = se.id
      CROSS JOIN (VALUES ('due_today', 0), ('overdue', 1)) AS k(kind, offset_days)
     WHERE (p_expense_id IS NULL OR se.id = p_expense_id)
       AND public.split_participant_is_eligible(p.id)
  LOOP
    v_planned := public.split_due_timestamp(r.due_date + r.offset_days, cfg.send_hour);
    v_window := CASE WHEN r.kind = 'due_today' THEN interval '12 hours' ELSE interval '3 days' END;
    IF v_planned > now() THEN
      v_effective := v_planned;
    ELSIF now() <= v_planned + v_window THEN
      v_effective := now();
    ELSE
      CONTINUE; -- fora da janela: não envia mensagem tardia
    END IF;

    -- Slot já entregue/lido no mesmo dia: nada a recriar.
    IF EXISTS (
      SELECT 1 FROM public.reminder_jobs j
       WHERE j.shared_expense_id = r.expense_id
         AND j.participant_id = r.participant_id
         AND j.kind = r.kind
         AND date(j.scheduled_for) = date(v_effective)
         AND (j.delivered_at IS NOT NULL OR j.read_at IS NOT NULL
              OR j.status = 'sent'::public.reminder_status)
    ) THEN
      CONTINUE;
    END IF;

    -- Chave idempotente por tentativa: permite recriar o slot sem colidir
    -- com o histórico de tentativas encerradas.
    v_base_key := format('split:policy:%s:%s:%s:%s:%s',
      v_policy_version, r.kind, r.expense_id, r.participant_id, r.due_date);
    SELECT count(*) INTO v_attempts
      FROM public.reminder_jobs j
     WHERE j.idempotency_key = v_base_key
        OR j.idempotency_key LIKE v_base_key || ':r%';
    v_key := CASE WHEN v_attempts = 0 THEN v_base_key
                  ELSE v_base_key || ':r' || v_attempts END;

    INSERT INTO public.reminder_jobs(
      owner_user_id, shared_expense_id, participant_id, scheduled_for, status, kind,
      idempotency_key, policy_version, delivery_status)
    VALUES (
      r.owner_user_id, r.expense_id, r.participant_id, v_effective,
      'queued'::public.reminder_status, r.kind,
      v_key, v_policy_version, 'none')
    ON CONFLICT (shared_expense_id, participant_id, kind)
      WHERE status IN ('queued'::public.reminder_status,'processing'::public.reminder_status,'enqueued'::public.reminder_status)
    DO UPDATE SET
      scheduled_for = CASE WHEN public.reminder_jobs.status = 'queued'::public.reminder_status
                           THEN EXCLUDED.scheduled_for ELSE public.reminder_jobs.scheduled_for END,
      policy_version = EXCLUDED.policy_version,
      updated_at = now();
    v_added := v_added + 1;
  END LOOP;

  RETURN v_added;
END $$;

-- 5) Reconciliador: colapsa slots duplicados e reporta cobertura
CREATE OR REPLACE FUNCTION public.reconcile_split_reminder_jobs(p_expense_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orphans integer := 0;
  v_settled integer := 0;
  v_collapsed integer := 0;
  v_coverage jsonb := '[]'::jsonb;
  v_result jsonb;
BEGIN
  UPDATE public.reminder_jobs j
     SET status = 'failed'::public.reminder_status,
         delivery_status = 'failed_terminal',
         last_error = coalesce(o.last_error, 'outbound_failed'),
         lease_expires_at = NULL,
         updated_at = now()
    FROM public.outbound_messages o
   WHERE o.id = j.outbound_message_id
     AND j.status = 'enqueued'::public.reminder_status
     AND o.status IN ('failed'::public.msg_status,'dead'::public.msg_status)
     AND (p_expense_id IS NULL OR j.shared_expense_id = p_expense_id);
  GET DIAGNOSTICS v_orphans = ROW_COUNT;

  UPDATE public.reminder_jobs j
     SET status = 'skipped'::public.reminder_status,
         cancel_reason = 'participant_no_longer_eligible',
         last_error = 'participant_no_longer_eligible',
         lease_expires_at = NULL,
         updated_at = now()
   WHERE j.kind IN ('due_today','overdue','reminder','due_soon')
     AND j.status IN ('queued'::public.reminder_status,'processing'::public.reminder_status)
     AND NOT public.split_participant_is_eligible(j.participant_id)
     AND (p_expense_id IS NULL OR j.shared_expense_id = p_expense_id);
  GET DIAGNOSTICS v_settled = ROW_COUNT;

  WITH live AS (
    SELECT id, shared_expense_id, participant_id, kind, date(scheduled_for) AS slot_day
      FROM public.reminder_jobs
     WHERE status IN ('queued'::public.reminder_status,'processing'::public.reminder_status,'enqueued'::public.reminder_status)
       AND (p_expense_id IS NULL OR shared_expense_id = p_expense_id)
  ), dead AS (
    SELECT d.id, l.id AS live_id
      FROM public.reminder_jobs d
      JOIN live l
        ON l.shared_expense_id = d.shared_expense_id
       AND l.participant_id = d.participant_id
       AND l.kind = d.kind
       AND l.slot_day = date(d.scheduled_for)
       AND l.id <> d.id
     WHERE d.status IN ('skipped'::public.reminder_status,'failed'::public.reminder_status)
       AND d.superseded_by IS NULL
       AND d.delivered_at IS NULL
       AND d.read_at IS NULL
  )
  UPDATE public.reminder_jobs j
     SET superseded_by = dead.live_id, updated_at = now()
    FROM dead WHERE dead.id = j.id;
  GET DIAGNOSTICS v_collapsed = ROW_COUNT;

  v_result := public.apply_split_reminder_policy(p_expense_id);

  SELECT coalesce(jsonb_agg(row_to_json(c)), '[]'::jsonb) INTO v_coverage
    FROM (
      SELECT p.id AS participant_id,
             p.shared_expense_id,
             p.name,
             p.communication_status,
             count(j.id) FILTER (
               WHERE j.status IN ('queued'::public.reminder_status,'processing'::public.reminder_status,'enqueued'::public.reminder_status)
             ) AS live_jobs,
             max(j.scheduled_for) FILTER (
               WHERE j.status = 'queued'::public.reminder_status
             ) AS next_scheduled_for
        FROM public.shared_expense_participants p
        JOIN public.shared_expenses se ON se.id = p.shared_expense_id
        LEFT JOIN public.reminder_jobs j ON j.participant_id = p.id
       WHERE p.status = 'pending'::public.participant_status
         AND se.status = 'active'::public.split_status
         AND (p_expense_id IS NULL OR p.shared_expense_id = p_expense_id)
       GROUP BY p.id, p.shared_expense_id, p.name, p.communication_status
    ) c;

  RETURN v_result || jsonb_build_object(
    'failed_terminal', v_orphans,
    'cancelled_ineligible', v_settled,
    'collapsed_slots', v_collapsed,
    'coverage', v_coverage,
    'participants_without_live_job', (
      SELECT count(*) FROM jsonb_array_elements(v_coverage) e
       WHERE coalesce((e->>'live_jobs')::int, 0) = 0
    )
  );
END $$;

REVOKE ALL ON FUNCTION public.reconcile_split_reminder_jobs(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_split_reminder_jobs(uuid) TO service_role;

-- 6) Reconciliação periódica ---------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'split-reminders-reconcile-15m') THEN
    PERFORM cron.unschedule('split-reminders-reconcile-15m');
  END IF;
  PERFORM cron.schedule(
    'split-reminders-reconcile-15m',
    '7,22,37,52 * * * *',
    'SELECT public.reconcile_split_reminder_jobs()'
  );
END $$;

-- 7) Correção de dados: colapso imediato dos slots redundantes
SELECT public.reconcile_split_reminder_jobs();