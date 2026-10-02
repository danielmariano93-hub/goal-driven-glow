ALTER TABLE public.shared_expense_participants
  ADD COLUMN IF NOT EXISTS reminders_paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminders_paused_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reminders_paused_reason text;

CREATE INDEX IF NOT EXISTS idx_sep_reminders_pause
  ON public.shared_expense_participants(owner_user_id, shared_expense_id, reminders_paused_at)
  WHERE reminders_paused_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.split_installment_is_eligible(p_installment_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.split_receivables_v1 r
      JOIN public.shared_expense_participants p ON p.id = r.participant_id
     WHERE r.installment_id = p_installment_id
       AND r.split_status = 'active' AND r.deleted_at IS NULL AND r.reminder_enabled
       AND r.due_date IS NOT NULL
       AND r.settlement_status IN ('pending','partial')
       AND r.balance_due > 0
       AND r.opt_out_at IS NULL
       AND p.reminders_paused_at IS NULL
       AND (r.phone_e164 IS NOT NULL OR r.linked_user_id IS NOT NULL)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.split_installment_is_eligible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.split_installment_is_eligible(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.split_enqueue_installment_message(
  p_expense_id uuid, p_participant_id uuid, p_installment_id uuid, p_kind text, p_when timestamptz)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE uid uuid := auth.uid(); job_id uuid; p record; se record;
BEGIN
  SELECT * INTO se FROM public.shared_expenses WHERE id = p_expense_id AND owner_user_id = uid;
  IF se.id IS NULL THEN RAISE EXCEPTION 'Divisão não encontrada'; END IF;
  IF se.status IN ('cancelled','settled') AND p_kind NOT IN ('payment_confirmation','completed') THEN
    RAISE EXCEPTION 'Divisão encerrada';
  END IF;
  SELECT * INTO p FROM public.shared_expense_participants
   WHERE id = p_participant_id AND shared_expense_id = p_expense_id AND owner_user_id = uid;
  IF p.id IS NULL OR p.phone_e164 IS NULL OR p.opt_out_at IS NOT NULL THEN RETURN NULL; END IF;
  IF p_kind IN ('invite','reminder','due_soon','due_today','overdue') AND p.reminders_paused_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO job_id FROM public.reminder_jobs
   WHERE shared_expense_id = p_expense_id AND participant_id = p_participant_id
     AND coalesce(installment_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_installment_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND kind = p_kind
     AND status IN ('queued','processing','enqueued')
   LIMIT 1;

  IF job_id IS NOT NULL THEN
    UPDATE public.reminder_jobs
       SET scheduled_for = least(scheduled_for, date_trunc('second', p_when)), updated_at = now()
     WHERE id = job_id;
  ELSE
    BEGIN
      INSERT INTO public.reminder_jobs(owner_user_id, shared_expense_id, participant_id, installment_id, scheduled_for, status, kind)
      VALUES (uid, p_expense_id, p_participant_id, p_installment_id, date_trunc('second', p_when), 'queued', p_kind)
      RETURNING id INTO job_id;
    EXCEPTION WHEN unique_violation THEN
      SELECT id INTO job_id FROM public.reminder_jobs
       WHERE shared_expense_id = p_expense_id AND participant_id = p_participant_id
         AND coalesce(installment_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = coalesce(p_installment_id, '00000000-0000-0000-0000-000000000000'::uuid)
         AND kind = p_kind AND status IN ('queued','processing','enqueued')
       LIMIT 1;
    END;
  END IF;

  IF job_id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.shared_expense_events(shared_expense_id, owner_user_id, participant_id, event_type, payload)
  VALUES (p_expense_id, uid, p_participant_id, 'message_queued',
          jsonb_build_object('kind', p_kind, 'job_id', job_id, 'installment_id', p_installment_id));
  RETURN job_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.split_enqueue_installment_message(uuid,uuid,uuid,text,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.split_enqueue_installment_message(uuid,uuid,uuid,text,timestamptz) TO authenticated, service_role;

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

    UPDATE public.outbound_messages o
       SET status = 'dead'::public.msg_status,
           last_error = 'split_reminders_paused',
           updated_at = now()
      FROM public.reminder_jobs j
     WHERE j.outbound_message_id = o.id
       AND j.participant_id = p_participant_id
       AND j.owner_user_id = uid
       AND j.kind IN ('invite','reminder','due_soon','due_today','overdue')
       AND j.status IN ('queued','processing','enqueued')
       AND o.status IN ('queued','processing');
    GET DIAGNOSTICS blocked_outbounds = ROW_COUNT;

    UPDATE public.reminder_jobs
       SET status = 'skipped'::public.reminder_status,
           cancel_reason = 'participant_reminders_paused',
           last_error = 'participant_reminders_paused',
           lease_expires_at = NULL,
           updated_at = now()
     WHERE participant_id = p_participant_id
       AND owner_user_id = uid
       AND kind IN ('invite','reminder','due_soon','due_today','overdue')
       AND status IN ('queued','processing','enqueued');
    GET DIAGNOSTICS cancelled_jobs = ROW_COUNT;
  ELSE
    UPDATE public.shared_expense_participants
       SET reminders_paused_at = NULL,
           reminders_paused_by = NULL,
           reminders_paused_reason = NULL,
           updated_at = now()
     WHERE id = p_participant_id;
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
      'blocked_outbounds', blocked_outbounds
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'participant_id', p_participant_id,
    'paused', p_paused,
    'cancelled_jobs', cancelled_jobs,
    'blocked_outbounds', blocked_outbounds
  );
END;
$$;
REVOKE ALL ON FUNCTION public.split_set_participant_reminders_paused(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.split_set_participant_reminders_paused(uuid, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.split_send_reminders(p_shared_expense_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  se record;
  participant record;
  queued_count integer := 0;
  job_id uuid;
BEGIN
  SELECT * INTO se
    FROM public.shared_expenses
   WHERE id = p_shared_expense_id;

  IF NOT FOUND OR se.owner_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF NOT se.reminder_enabled THEN
    RAISE EXCEPTION 'reminders_disabled';
  END IF;

  FOR participant IN
    SELECT *
      FROM public.shared_expense_participants
     WHERE shared_expense_id = p_shared_expense_id
       AND owner_user_id = auth.uid()
       AND status IN ('pending', 'partial', 'notified')
       AND phone_e164 IS NOT NULL
       AND opt_out_at IS NULL
       AND reminders_paused_at IS NULL
       AND (last_reminded_at IS NULL OR last_reminded_at < now() - interval '24 hours')
       AND reminder_count < 5
  LOOP
    job_id := public.split_enqueue_message(
      p_shared_expense_id, participant.id, 'reminder', now()
    );
    IF job_id IS NOT NULL THEN
      UPDATE public.shared_expense_participants
         SET last_reminded_at = now(),
             reminder_count = reminder_count + 1,
             status = CASE
               WHEN status = 'pending' THEN 'notified'
               ELSE status
             END,
             updated_at = now()
       WHERE id = participant.id;
      queued_count := queued_count + 1;
    END IF;
  END LOOP;

  INSERT INTO public.shared_expense_events(
    shared_expense_id, owner_user_id, event_type, payload
  )
  VALUES (
    p_shared_expense_id, auth.uid(), 'reminders_scheduled',
    jsonb_build_object('count', queued_count, 'delivery_window', '24x7')
  );

  RETURN queued_count;
END
$$;

NOTIFY pgrst, 'reload schema';
