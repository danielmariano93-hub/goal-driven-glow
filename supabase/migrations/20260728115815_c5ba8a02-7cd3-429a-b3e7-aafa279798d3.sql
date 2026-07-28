-- 1) Permitir o novo tipo owner_digest e participante nulo apenas nesse caso
ALTER TABLE public.reminder_jobs DROP CONSTRAINT IF EXISTS reminder_jobs_kind_check;
ALTER TABLE public.reminder_jobs ADD CONSTRAINT reminder_jobs_kind_check
  CHECK (kind = ANY (ARRAY['invite','reminder','due_soon','due_today','overdue','payment_confirmation','completed','owner_digest']));

ALTER TABLE public.reminder_jobs ALTER COLUMN participant_id DROP NOT NULL;

ALTER TABLE public.reminder_jobs DROP CONSTRAINT IF EXISTS reminder_jobs_participant_required_check;
ALTER TABLE public.reminder_jobs ADD CONSTRAINT reminder_jobs_participant_required_check
  CHECK (kind = 'owner_digest' OR participant_id IS NOT NULL);

-- 2) Nova régua de agendamento
CREATE OR REPLACE FUNCTION public.schedule_split_due_reminders(p_expense_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_added integer := 0;
  v_rows integer := 0;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  UPDATE public.reminder_jobs r
     SET status = 'queued'::public.reminder_status,
         last_error = NULL,
         lease_expires_at = NULL,
         attempts = 0,
         updated_at = now()
    FROM public.shared_expenses se
    JOIN public.shared_expense_participants p ON p.shared_expense_id = se.id
   WHERE r.shared_expense_id = se.id
     AND r.participant_id = p.id
     AND (p_expense_id IS NULL OR se.id = p_expense_id)
     AND r.kind IN ('due_soon','due_today','overdue')
     AND r.status = 'skipped'::public.reminder_status
     AND r.scheduled_for > now()
     AND se.status = 'active'
     AND se.deleted_at IS NULL
     AND se.reminder_enabled = true
     AND p.status IN ('pending','partial','notified')
     AND p.opt_out_at IS NULL;

  -- D-1 09h
  INSERT INTO public.reminder_jobs (owner_user_id, shared_expense_id, participant_id, scheduled_for, status, kind, idempotency_key)
  SELECT se.owner_user_id, se.id, p.id,
         public.split_due_timestamp(se.due_date - 1, 9),
         'queued'::public.reminder_status, 'due_soon',
         format('split:due_soon:%s:%s:%s', se.id, p.id, se.due_date)
  FROM public.shared_expenses se
  JOIN public.shared_expense_participants p ON p.shared_expense_id = se.id
  WHERE (p_expense_id IS NULL OR se.id = p_expense_id)
    AND se.status = 'active' AND se.deleted_at IS NULL AND se.reminder_enabled = true
    AND se.due_date IS NOT NULL
    AND p.status IN ('pending','partial','notified') AND p.opt_out_at IS NULL
    AND (p.phone_e164 IS NOT NULL OR p.linked_user_id IS NOT NULL)
    AND public.split_due_timestamp(se.due_date - 1, 9) > now()
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_added := v_added + v_rows;

  -- D0 09h
  INSERT INTO public.reminder_jobs (owner_user_id, shared_expense_id, participant_id, scheduled_for, status, kind, idempotency_key)
  SELECT se.owner_user_id, se.id, p.id,
         public.split_due_timestamp(se.due_date, 9),
         'queued'::public.reminder_status, 'due_today',
         format('split:due_today:%s:%s:%s', se.id, p.id, se.due_date)
  FROM public.shared_expenses se
  JOIN public.shared_expense_participants p ON p.shared_expense_id = se.id
  WHERE (p_expense_id IS NULL OR se.id = p_expense_id)
    AND se.status = 'active' AND se.deleted_at IS NULL AND se.reminder_enabled = true
    AND se.due_date IS NOT NULL
    AND p.status IN ('pending','partial','notified') AND p.opt_out_at IS NULL
    AND (p.phone_e164 IS NOT NULL OR p.linked_user_id IS NOT NULL)
    AND public.split_due_timestamp(se.due_date, 9) > now()
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_added := v_added + v_rows;

  -- D+1 e D+3 10h (D+7 removido)
  INSERT INTO public.reminder_jobs (owner_user_id, shared_expense_id, participant_id, scheduled_for, status, kind, idempotency_key)
  SELECT se.owner_user_id, se.id, p.id,
         public.split_due_timestamp(se.due_date + stage.days_after, 10),
         'queued'::public.reminder_status, 'overdue',
         format('split:overdue:%s:%s:%s:d%s', se.id, p.id, se.due_date, stage.days_after)
  FROM public.shared_expenses se
  JOIN public.shared_expense_participants p ON p.shared_expense_id = se.id
  CROSS JOIN (VALUES (1), (3)) AS stage(days_after)
  WHERE (p_expense_id IS NULL OR se.id = p_expense_id)
    AND se.status = 'active' AND se.deleted_at IS NULL AND se.reminder_enabled = true
    AND se.due_date IS NOT NULL
    AND p.status IN ('pending','partial','notified') AND p.opt_out_at IS NULL
    AND (p.phone_e164 IS NOT NULL OR p.linked_user_id IS NOT NULL)
    AND public.split_due_timestamp(se.due_date + stage.days_after, 10) > now()
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_added := v_added + v_rows;

  -- Resumo para o dono: D+1 e D+3 às 11h (uma linha por rolê)
  INSERT INTO public.reminder_jobs (owner_user_id, shared_expense_id, participant_id, scheduled_for, status, kind, idempotency_key)
  SELECT se.owner_user_id, se.id, NULL,
         public.split_due_timestamp(se.due_date + stage.days_after, 11),
         'queued'::public.reminder_status, 'owner_digest',
         format('split:owner_digest:%s:%s:d%s', se.id, se.due_date, stage.days_after)
  FROM public.shared_expenses se
  CROSS JOIN (VALUES (1), (3)) AS stage(days_after)
  WHERE (p_expense_id IS NULL OR se.id = p_expense_id)
    AND se.status = 'active' AND se.deleted_at IS NULL AND se.reminder_enabled = true
    AND se.due_date IS NOT NULL
    AND public.split_due_timestamp(se.due_date + stage.days_after, 11) > now()
    AND EXISTS (
      SELECT 1 FROM public.shared_expense_participants p
       WHERE p.shared_expense_id = se.id
         AND p.status IN ('pending','partial','notified')
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_added := v_added + v_rows;

  -- Catch-up (inalterado)
  INSERT INTO public.reminder_jobs (owner_user_id, shared_expense_id, participant_id, scheduled_for, status, kind, idempotency_key)
  SELECT se.owner_user_id, se.id, p.id,
         now() + interval '30 seconds',
         'queued'::public.reminder_status,
         CASE WHEN se.due_date = v_today + 1 THEN 'due_soon'
              WHEN se.due_date = v_today THEN 'due_today'
              ELSE 'overdue' END,
         format('split:catchup:%s:%s:%s', se.id, p.id, se.due_date)
  FROM public.shared_expenses se
  JOIN public.shared_expense_participants p ON p.shared_expense_id = se.id
  WHERE (p_expense_id IS NULL OR se.id = p_expense_id)
    AND se.status = 'active' AND se.deleted_at IS NULL AND se.reminder_enabled = true
    AND se.due_date BETWEEN v_today - 3 AND v_today + 1
    AND p.status IN ('pending','partial','notified') AND p.opt_out_at IS NULL
    AND (p.phone_e164 IS NOT NULL OR p.linked_user_id IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM public.reminder_jobs existing
       WHERE existing.shared_expense_id = se.id
         AND existing.participant_id = p.id
         AND existing.kind IN ('due_soon','due_today','overdue')
         AND existing.scheduled_for <= now()
         AND existing.status IN ('processing','enqueued')
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_added := v_added + v_rows;

  RETURN v_added;
END;
$fn$;