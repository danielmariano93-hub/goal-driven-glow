CREATE OR REPLACE FUNCTION public.split_enqueue_message(p_expense_id uuid, p_participant_id uuid, p_kind text, p_when timestamp with time zone DEFAULT now())
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); job_id uuid; p record; se record;
BEGIN
  SELECT * INTO se FROM public.shared_expenses WHERE id=p_expense_id AND owner_user_id=uid;
  IF se.id IS NULL THEN RAISE EXCEPTION 'Divisão não encontrada'; END IF;
  IF se.status IN ('cancelled','settled') AND p_kind NOT IN ('payment_confirmation','completed') THEN
    RAISE EXCEPTION 'Divisão encerrada';
  END IF;
  SELECT * INTO p FROM public.shared_expense_participants
   WHERE id=p_participant_id AND shared_expense_id=p_expense_id AND owner_user_id=uid;
  IF p.id IS NULL OR p.phone_e164 IS NULL OR p.opt_out_at IS NOT NULL THEN RETURN NULL; END IF;

  -- Reaproveita um job vivo do mesmo tipo (índice parcial split_jobs_live_uniq)
  SELECT id INTO job_id FROM public.reminder_jobs
   WHERE shared_expense_id=p_expense_id AND participant_id=p_participant_id AND kind=p_kind
     AND status IN ('queued','processing','enqueued')
   LIMIT 1;

  IF job_id IS NOT NULL THEN
    UPDATE public.reminder_jobs
       SET scheduled_for=least(scheduled_for, date_trunc('second',p_when)), updated_at=now()
     WHERE id=job_id;
  ELSE
    BEGIN
      INSERT INTO public.reminder_jobs(owner_user_id,shared_expense_id,participant_id,scheduled_for,status,kind)
      VALUES(uid,p_expense_id,p_participant_id,date_trunc('second',p_when),'queued',p_kind)
      RETURNING id INTO job_id;
    EXCEPTION WHEN unique_violation THEN
      SELECT id INTO job_id FROM public.reminder_jobs
       WHERE shared_expense_id=p_expense_id AND participant_id=p_participant_id AND kind=p_kind
         AND status IN ('queued','processing','enqueued')
       LIMIT 1;
    END;
  END IF;

  IF job_id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.shared_expense_events(shared_expense_id,owner_user_id,participant_id,event_type,payload)
  VALUES(p_expense_id,uid,p_participant_id,'message_queued',jsonb_build_object('kind',p_kind,'job_id',job_id));
  RETURN job_id;
END $function$;