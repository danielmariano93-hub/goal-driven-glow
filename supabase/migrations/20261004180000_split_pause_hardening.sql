-- Endurecimento da pausa individual de cobranças (auditoria de 04/10/2026).
-- 1) Pausar não pode reescrever como "skipped" um job cuja mensagem JÁ saiu (enviada/entregue/lida):
--    isso apagava o histórico e deixava a regra "uma cobrança por dia" duplicar o envio ao retomar.
-- 2) Retomar agora reagenda na hora (antes esperava o cron de até 15 min).
-- 3) A cobertura do reconcile não conta pessoa pausada como "sem job vivo" (falso alarme no admin).
CREATE OR REPLACE FUNCTION public.split_set_participant_reminders_paused(
  p_participant_id uuid,
  p_paused boolean,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  p record;
  cancelled_jobs integer := 0;
  blocked_outbounds integer := 0;
  rescheduled integer := 0;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT id, shared_expense_id, owner_user_id, reminders_paused_at
    INTO p
    FROM public.shared_expense_participants
   WHERE id = p_participant_id
     AND owner_user_id = uid;

  IF p.id IS NULL THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_paused THEN
    UPDATE public.shared_expense_participants
       SET reminders_paused_at = coalesce(reminders_paused_at, now()),
           reminders_paused_by = uid,
           reminders_paused_reason = nullif(btrim(p_reason), ''),
           updated_at = now()
     WHERE id = p_participant_id;

    -- Jobs ainda não enviados: cancela antes de mexer nas mensagens (a decisão depende do estado delas).
    UPDATE public.reminder_jobs j
       SET status = 'skipped'::public.reminder_status,
           cancel_reason = 'participant_reminders_paused',
           last_error = 'participant_reminders_paused',
           lease_expires_at = NULL,
           updated_at = now()
     WHERE j.participant_id = p_participant_id
       AND j.owner_user_id = uid
       AND j.kind IN ('invite','reminder','due_soon','due_today','overdue')
       AND (
         j.status IN ('queued'::public.reminder_status, 'processing'::public.reminder_status)
         OR (j.status = 'enqueued'::public.reminder_status
             AND NOT EXISTS (
               SELECT 1 FROM public.outbound_messages o
                WHERE o.id = j.outbound_message_id
                  AND o.status::text IN ('sent','delivered','read')))
       );
    GET DIAGNOSTICS cancelled_jobs = ROW_COUNT;

    UPDATE public.outbound_messages o
       SET status = 'dead'::public.msg_status,
           last_error = 'split_reminders_paused',
           updated_at = now()
      FROM public.reminder_jobs j
     WHERE j.outbound_message_id = o.id
       AND j.participant_id = p_participant_id
       AND j.owner_user_id = uid
       AND j.cancel_reason = 'participant_reminders_paused'
       AND j.updated_at >= now() - interval '1 minute'
       AND o.status IN ('queued'::public.msg_status, 'processing'::public.msg_status);
    GET DIAGNOSTICS blocked_outbounds = ROW_COUNT;
  ELSE
    UPDATE public.shared_expense_participants
       SET reminders_paused_at = NULL,
           reminders_paused_by = NULL,
           reminders_paused_reason = NULL,
           updated_at = now()
     WHERE id = p_participant_id;

    -- Retomada imediata: a regra diária decide se já há cobrança devida hoje.
    rescheduled := public.schedule_split_due_reminders(p.shared_expense_id);
  END IF;

  INSERT INTO public.shared_expense_events(shared_expense_id, owner_user_id, participant_id, event_type, payload)
  VALUES (
    p.shared_expense_id,
    uid,
    p_participant_id,
    CASE WHEN p_paused THEN 'participant_reminders_paused' ELSE 'participant_reminders_resumed' END,
    jsonb_build_object(
      'paused', p_paused,
      'reason', nullif(btrim(p_reason), ''),
      'cancelled_jobs', cancelled_jobs,
      'blocked_outbounds', blocked_outbounds,
      'rescheduled', rescheduled
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'participant_id', p_participant_id,
    'paused', p_paused,
    'cancelled_jobs', cancelled_jobs,
    'blocked_outbounds', blocked_outbounds,
    'rescheduled', rescheduled
  );
END;
$$;
REVOKE ALL ON FUNCTION public.split_set_participant_reminders_paused(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.split_set_participant_reminders_paused(uuid, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reconcile_split_reminder_jobs(p_expense_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
         AND p.reminders_paused_at IS NULL
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
END $function$;
