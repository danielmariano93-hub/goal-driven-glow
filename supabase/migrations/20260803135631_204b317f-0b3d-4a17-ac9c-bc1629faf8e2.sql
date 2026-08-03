-- ============================================================
-- comms_contract.v1 — Migration A (schema) + B (funções)
-- ============================================================

-- ---------- A.1 reminder_jobs ----------
ALTER TABLE public.reminder_jobs
  ADD COLUMN IF NOT EXISTS policy_version text,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS deliver_after timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.reminder_jobs(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE public.reminder_jobs
    ADD CONSTRAINT reminder_jobs_delivery_status_chk CHECK (delivery_status IN
      ('none','provider_accepted','sent','delivered','read','failed_retryable','failed_terminal'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Unicidade só entre lembretes vivos: histórico (skipped/failed/sent) nunca bloqueia recriação.
DROP INDEX IF EXISTS public.split_jobs_idempotent_uniq;
-- Dedup prévio: mantém o job vivo mais recente por (rolê, participante, tipo).
WITH ranked AS (
  SELECT id, row_number() OVER (
           PARTITION BY shared_expense_id, participant_id, kind
           ORDER BY scheduled_for DESC, created_at DESC) AS rn
    FROM public.reminder_jobs
   WHERE status IN ('queued'::public.reminder_status,'processing'::public.reminder_status,'enqueued'::public.reminder_status)
)
UPDATE public.reminder_jobs j
   SET status = 'skipped'::public.reminder_status,
       cancel_reason = 'duplicate_live_job',
       last_error = 'duplicate_live_job',
       lease_expires_at = NULL,
       updated_at = now()
  FROM ranked
 WHERE j.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS split_jobs_live_uniq
  ON public.reminder_jobs (shared_expense_id, participant_id, kind)
  WHERE status IN ('queued'::public.reminder_status,'processing'::public.reminder_status,'enqueued'::public.reminder_status);
CREATE INDEX IF NOT EXISTS reminder_jobs_status_sched_idx ON public.reminder_jobs (status, scheduled_for);
CREATE INDEX IF NOT EXISTS reminder_jobs_outbound_idx ON public.reminder_jobs (outbound_message_id)
  WHERE outbound_message_id IS NOT NULL;

-- ---------- A.2 participantes ----------
ALTER TABLE public.shared_expense_participants
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS queued_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivered_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS read_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS communication_status text NOT NULL DEFAULT 'idle';

DO $$ BEGIN
  ALTER TABLE public.shared_expense_participants
    ADD CONSTRAINT sep_communication_status_chk CHECK (communication_status IN
      ('idle','scheduled','attempted','sent','delivered','read','failed','invalid_phone','no_channel','opted_out'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- A.3 sugestões proativas ----------
ALTER TABLE public.pending_proactive_suggestions
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS defer_reason text,
  ADD COLUMN IF NOT EXISTS logical_dedup_key text;
UPDATE public.pending_proactive_suggestions SET logical_dedup_key = dedup_key WHERE logical_dedup_key IS NULL;
CREATE INDEX IF NOT EXISTS pps_logical_dedup_idx
  ON public.pending_proactive_suggestions (user_id, logical_dedup_key, created_at DESC);
CREATE INDEX IF NOT EXISTS pps_next_attempt_idx
  ON public.pending_proactive_suggestions (status, next_attempt_at);

-- ---------- A.4 catálogo ----------
ALTER TABLE public.communication_catalog
  ADD COLUMN IF NOT EXISTS default_channels text[] NOT NULL DEFAULT ARRAY['app']::text[],
  ADD COLUMN IF NOT EXISTS sensitivity text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS fallback_policy text NOT NULL DEFAULT 'app_only',
  ADD COLUMN IF NOT EXISTS min_severity_for_whatsapp text NOT NULL DEFAULT 'attention';
UPDATE public.communication_catalog
   SET default_channels = COALESCE(allowed_channels, ARRAY['app']::text[])
 WHERE default_channels = ARRAY['app']::text[] AND allowed_channels IS NOT NULL;

-- ---------- A.5 preferências e insights ----------
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS quiet_behavior text NOT NULL DEFAULT 'defer';
DO $$ BEGIN
  ALTER TABLE public.notification_preferences
    ADD CONSTRAINT np_quiet_behavior_chk CHECK (quiet_behavior IN ('defer','silent','immediate'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.user_insights
  ADD COLUMN IF NOT EXISTS formula_version text,
  ADD COLUMN IF NOT EXISTS as_of date,
  ADD COLUMN IF NOT EXISTS validity_until timestamptz,
  ADD COLUMN IF NOT EXISTS eligible_channels text[] NOT NULL DEFAULT ARRAY['app']::text[],
  ADD COLUMN IF NOT EXISTS logical_dedup_key text,
  ADD COLUMN IF NOT EXISTS source_snapshot_id uuid;
UPDATE public.user_insights SET logical_dedup_key = dedup_key WHERE logical_dedup_key IS NULL;

-- ---------- A.6 rotação justa da audiência proativa ----------
ALTER TABLE public.user_profiles_snapshot
  ADD COLUMN IF NOT EXISTS last_proactive_scan_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_proactive_scan_at timestamptz;

-- ============================================================
-- B. Funções transacionais
-- ============================================================

-- B.1 elegibilidade canônica de participante
CREATE OR REPLACE FUNCTION public.split_participant_is_eligible(p_participant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.shared_expense_participants p
      JOIN public.shared_expenses se ON se.id = p.shared_expense_id
     WHERE p.id = p_participant_id
       AND se.status = 'active' AND se.deleted_at IS NULL AND se.reminder_enabled
       AND se.due_date IS NOT NULL
       AND p.status IN ('pending','partial','notified')
       AND p.opt_out_at IS NULL
       AND greatest(0, coalesce(p.amount_due,0) - coalesce(p.amount_paid,0)) > 0
       AND (p.phone_e164 IS NOT NULL OR p.linked_user_id IS NOT NULL)
  );
$$;

-- B.2 agendamento com recuperação por janela e upsert em jobs vivos
CREATE OR REPLACE FUNCTION public.schedule_split_due_reminders(p_expense_id uuid DEFAULT NULL::uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  cfg public.split_reminder_policy%ROWTYPE;
  v_policy_version text;
  v_added integer := 0;
  r record;
  v_planned timestamptz;
  v_effective timestamptz;
  v_window interval;
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
    -- Janela de recuperação: due_today até o fim do dia, overdue por até 3 dias.
    v_window := CASE WHEN r.kind = 'due_today' THEN interval '12 hours' ELSE interval '3 days' END;
    IF v_planned > now() THEN
      v_effective := v_planned;
    ELSIF now() <= v_planned + v_window THEN
      v_effective := now();
    ELSE
      CONTINUE; -- fora da janela: não envia mensagem tardia
    END IF;

    INSERT INTO public.reminder_jobs(
      owner_user_id, shared_expense_id, participant_id, scheduled_for, status, kind,
      idempotency_key, policy_version, delivery_status)
    VALUES (
      r.owner_user_id, r.expense_id, r.participant_id, v_effective,
      'queued'::public.reminder_status, r.kind,
      format('split:policy:%s:%s:%s:%s:%s', v_policy_version, r.kind, r.expense_id, r.participant_id, r.due_date),
      v_policy_version, 'none')
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
END $function$;

-- B.3 aplicação de política: cria/reativa antes de cancelar
CREATE OR REPLACE FUNCTION public.apply_split_reminder_policy(p_expense_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  cfg public.split_reminder_policy%ROWTYPE;
  v_policy_version text;
  v_created integer := 0;
  v_reactivated integer := 0;
  v_cancelled integer := 0;
  v_missing integer := 0;
BEGIN
  SELECT * INTO cfg FROM public.split_reminder_policy WHERE id = 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('enabled', false); END IF;
  v_policy_version := to_char(cfg.updated_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS');

  -- 1) Reativa jobs cancelados/falhos que voltaram a ser necessários (sem entrega confirmada).
  WITH revivable AS (
    SELECT DISTINCT ON (j.shared_expense_id, j.participant_id, j.kind) j.id
      FROM public.reminder_jobs j
     WHERE j.kind IN ('due_today','overdue')
       AND j.status IN ('skipped'::public.reminder_status,'failed'::public.reminder_status)
       AND j.delivered_at IS NULL AND j.read_at IS NULL
       AND (p_expense_id IS NULL OR j.shared_expense_id = p_expense_id)
       AND public.split_participant_is_eligible(j.participant_id)
       AND NOT EXISTS (
         SELECT 1 FROM public.reminder_jobs live
          WHERE live.shared_expense_id = j.shared_expense_id
            AND live.participant_id = j.participant_id
            AND live.kind = j.kind
            AND live.status IN ('queued'::public.reminder_status,'processing'::public.reminder_status,'enqueued'::public.reminder_status))
       AND NOT EXISTS (
         SELECT 1 FROM public.reminder_jobs done
          WHERE done.shared_expense_id = j.shared_expense_id
            AND done.participant_id = j.participant_id
            AND done.kind = j.kind
            AND (done.delivered_at IS NOT NULL OR done.read_at IS NOT NULL))
     ORDER BY j.shared_expense_id, j.participant_id, j.kind, j.created_at DESC
  )
  UPDATE public.reminder_jobs j
     SET status = 'queued'::public.reminder_status,
         attempts = 0, retry_count = 0,
         last_error = NULL, cancel_reason = NULL,
         outbound_message_id = NULL, lease_expires_at = NULL,
         delivery_status = 'none',
         policy_version = v_policy_version,
         scheduled_for = greatest(j.scheduled_for, now()),
         updated_at = now()
    FROM revivable rv
   WHERE j.id = rv.id;
  GET DIAGNOSTICS v_reactivated = ROW_COUNT;

  -- 2) Cria o que ainda falta (respeita a janela de recuperação).
  v_created := public.schedule_split_due_reminders(p_expense_id);

  -- 3) Só agora cancela jobs de política antiga que não são mais necessários.
  UPDATE public.reminder_jobs j
     SET status = 'skipped'::public.reminder_status,
         cancel_reason = 'policy_superseded',
         last_error = 'policy_superseded',
         lease_expires_at = NULL,
         updated_at = now()
   WHERE j.kind IN ('reminder','due_soon')
     AND j.status = 'queued'::public.reminder_status
     AND (p_expense_id IS NULL OR j.shared_expense_id = p_expense_id);
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  SELECT count(*) INTO v_missing
    FROM public.shared_expense_participants p
   WHERE public.split_participant_is_eligible(p.id)
     AND (p_expense_id IS NULL OR p.shared_expense_id = p_expense_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.reminder_jobs j
        WHERE j.participant_id = p.id
          AND j.status IN ('queued'::public.reminder_status,'processing'::public.reminder_status,'enqueued'::public.reminder_status));

  RETURN jsonb_build_object(
    'policy_version', v_policy_version,
    'created', v_created,
    'reactivated', v_reactivated,
    'cancelled', v_cancelled,
    'participants_without_job', v_missing);
END $function$;

-- B.4 reconciliador
CREATE OR REPLACE FUNCTION public.reconcile_split_reminder_jobs(p_expense_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_orphans integer := 0; v_settled integer := 0; v_result jsonb;
BEGIN
  -- Jobs marcados como enfileirados cuja mensagem morreu: viram falha terminal.
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

  -- Participante quitado/opt-out: cancela lembretes vivos.
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

  v_result := public.apply_split_reminder_policy(p_expense_id);
  RETURN v_result || jsonb_build_object('failed_terminal', v_orphans, 'cancelled_ineligible', v_settled);
END $function$;

-- B.5 propagação de entrega
CREATE OR REPLACE FUNCTION public.sync_reminder_delivery_from_outbound()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_state text; v_now timestamptz := now();
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  v_state := CASE NEW.status::text
    WHEN 'sent' THEN 'sent'
    WHEN 'delivered' THEN 'delivered'
    WHEN 'read' THEN 'read'
    WHEN 'failed' THEN 'failed_retryable'
    WHEN 'dead' THEN 'failed_terminal'
    ELSE NULL END;
  IF v_state IS NULL THEN RETURN NEW; END IF;

  UPDATE public.reminder_jobs j
     SET delivery_status = v_state,
         sent_at = CASE WHEN v_state IN ('sent','delivered','read') THEN coalesce(j.sent_at, NEW.sent_at, v_now) ELSE j.sent_at END,
         delivered_at = CASE WHEN v_state IN ('delivered','read') THEN coalesce(j.delivered_at, NEW.delivered_at, v_now) ELSE j.delivered_at END,
         read_at = CASE WHEN v_state = 'read' THEN coalesce(j.read_at, v_now) ELSE j.read_at END,
         status = CASE
           WHEN v_state IN ('delivered','read') THEN 'sent'::public.reminder_status
           WHEN v_state = 'failed_terminal' THEN 'failed'::public.reminder_status
           ELSE j.status END,
         last_error = CASE WHEN v_state LIKE 'failed%' THEN NEW.last_error ELSE j.last_error END,
         updated_at = v_now
   WHERE j.outbound_message_id = NEW.id;

  -- Contadores do participante só sobem com envio real.
  IF NEW.participant_id IS NOT NULL AND v_state IN ('sent','delivered','read') THEN
    UPDATE public.shared_expense_participants p
       SET sent_count = p.sent_count + CASE WHEN v_state = 'sent' THEN 1 ELSE 0 END,
           delivered_count = p.delivered_count + CASE WHEN v_state = 'delivered' THEN 1 ELSE 0 END,
           read_count = p.read_count + CASE WHEN v_state = 'read' THEN 1 ELSE 0 END,
           last_sent_at = CASE WHEN v_state = 'sent' THEN v_now ELSE p.last_sent_at END,
           last_delivered_at = CASE WHEN v_state IN ('delivered','read') THEN v_now ELSE p.last_delivered_at END,
           last_reminded_at = CASE WHEN v_state = 'sent' THEN v_now ELSE p.last_reminded_at END,
           reminder_count = p.reminder_count + CASE WHEN v_state = 'sent' THEN 1 ELSE 0 END,
           communication_status = v_state,
           updated_at = v_now
     WHERE p.id = NEW.participant_id;
  ELSIF NEW.participant_id IS NOT NULL AND v_state LIKE 'failed%' THEN
    UPDATE public.shared_expense_participants p
       SET communication_status = 'failed', updated_at = v_now
     WHERE p.id = NEW.participant_id;
  END IF;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_sync_reminder_delivery ON public.outbound_messages;
CREATE TRIGGER trg_sync_reminder_delivery
AFTER UPDATE OF status ON public.outbound_messages
FOR EACH ROW EXECUTE FUNCTION public.sync_reminder_delivery_from_outbound();

-- B.6 política admin passa a usar o fluxo transacional
CREATE OR REPLACE FUNCTION public.admin_split_reminder_policy_update(
  _enabled boolean, _due_soon_days_before integer, _due_today_enabled boolean,
  _first_overdue_days integer, _repeat_every_days integer, _max_overdue_reminders integer,
  _send_hour integer, _pause_on_reply boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_result jsonb; v_apply jsonb;
BEGIN
  IF NOT public.has_platform_permission('messaging.write') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _send_hour NOT BETWEEN 0 AND 23 THEN RAISE EXCEPTION 'invalid_send_hour'; END IF;
  UPDATE public.split_reminder_policy SET enabled=_enabled, due_soon_days_before=0, due_today_enabled=true,
    first_overdue_days=1, repeat_every_days=1, max_overdue_reminders=1, send_hour=_send_hour,
    pause_on_reply=_pause_on_reply, updated_by=auth.uid(), updated_at=now() WHERE id=1
  RETURNING to_jsonb(split_reminder_policy.*)-'id'-'updated_by' INTO v_result;

  v_apply := public.apply_split_reminder_policy(NULL);

  INSERT INTO public.admin_configuration_audit(actor_id,action,entity_type,entity_id,after_json)
  VALUES(auth.uid(),'messaging.split_policy.update','split_reminder_policy','1', v_result || jsonb_build_object('apply', v_apply));
  RETURN v_result || jsonb_build_object('apply', v_apply);
END $function$;

-- B.7 reconciliação sob demanda no admin
CREATE OR REPLACE FUNCTION public.admin_reconcile_split_reminders(p_expense_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT public.has_platform_permission('messaging.write') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN public.reconcile_split_reminder_jobs(p_expense_id);
END $function$;

GRANT EXECUTE ON FUNCTION public.admin_reconcile_split_reminders(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.split_participant_is_eligible(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_split_reminder_policy(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_split_reminder_jobs(uuid) TO service_role;

-- ---------- Backfill de estado ----------
UPDATE public.reminder_jobs j
   SET delivery_status = CASE
         WHEN o.status::text IN ('delivered','read') THEN 'delivered'
         WHEN o.status::text = 'sent' THEN 'sent'
         WHEN o.status::text IN ('failed','dead') THEN 'failed_terminal'
         ELSE j.delivery_status END,
       sent_at = coalesce(j.sent_at, o.sent_at),
       delivered_at = coalesce(j.delivered_at, o.delivered_at)
  FROM public.outbound_messages o
 WHERE o.id = j.outbound_message_id AND j.delivery_status = 'none';

UPDATE public.reminder_jobs j
   SET status = 'failed'::public.reminder_status,
       delivery_status = 'failed_terminal',
       last_error = coalesce(j.last_error, 'outbound_failed')
 WHERE j.status = 'enqueued'::public.reminder_status
   AND j.delivery_status = 'failed_terminal';

WITH agg AS (
  SELECT o.participant_id,
         count(*) FILTER (WHERE o.sent_at IS NOT NULL) AS sent,
         count(*) FILTER (WHERE o.delivered_at IS NOT NULL) AS delivered,
         max(o.sent_at) AS last_sent,
         max(o.delivered_at) AS last_delivered
    FROM public.outbound_messages o
   WHERE o.participant_id IS NOT NULL
   GROUP BY o.participant_id)
UPDATE public.shared_expense_participants p
   SET sent_count = agg.sent,
       delivered_count = agg.delivered,
       last_sent_at = agg.last_sent,
       last_delivered_at = agg.last_delivered,
       reminder_count = least(coalesce(p.reminder_count,0), agg.delivered),
       last_reminded_at = agg.last_delivered,
       communication_status = CASE
         WHEN agg.delivered > 0 THEN 'delivered'
         WHEN agg.sent > 0 THEN 'failed'
         ELSE p.communication_status END
  FROM agg
 WHERE p.id = agg.participant_id;
