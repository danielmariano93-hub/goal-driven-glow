UPDATE public.split_reminder_policy
SET due_soon_days_before = 0,
    due_today_enabled = true,
    first_overdue_days = 1,
    repeat_every_days = 1,
    max_overdue_reminders = 1,
    updated_at = now()
WHERE id = 1;

CREATE OR REPLACE FUNCTION public.schedule_split_due_reminders(p_expense_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cfg public.split_reminder_policy%ROWTYPE; v_added integer := 0; v_rows integer := 0; v_policy_version text;
BEGIN
  SELECT * INTO cfg FROM public.split_reminder_policy WHERE id = 1;
  IF NOT FOUND OR NOT cfg.enabled THEN RETURN 0; END IF;
  v_policy_version := to_char(cfg.updated_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS');

  INSERT INTO public.reminder_jobs(owner_user_id,shared_expense_id,participant_id,scheduled_for,status,kind,idempotency_key)
  SELECT se.owner_user_id,se.id,p.id,public.split_due_timestamp(se.due_date,cfg.send_hour),'queued'::public.reminder_status,'due_today',
    format('split:policy:%s:due_today:%s:%s:%s',v_policy_version,se.id,p.id,se.due_date)
  FROM public.shared_expenses se JOIN public.shared_expense_participants p ON p.shared_expense_id=se.id
  WHERE (p_expense_id IS NULL OR se.id=p_expense_id) AND se.status='active' AND se.deleted_at IS NULL
    AND se.reminder_enabled AND se.due_date IS NOT NULL AND p.status IN ('pending','partial','notified')
    AND p.opt_out_at IS NULL AND (p.phone_e164 IS NOT NULL OR p.linked_user_id IS NOT NULL)
    AND public.split_due_timestamp(se.due_date,cfg.send_hour)>now()
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows=ROW_COUNT; v_added:=v_added+v_rows;

  INSERT INTO public.reminder_jobs(owner_user_id,shared_expense_id,participant_id,scheduled_for,status,kind,idempotency_key)
  SELECT se.owner_user_id,se.id,p.id,public.split_due_timestamp(se.due_date+1,cfg.send_hour),'queued'::public.reminder_status,'overdue',
    format('split:policy:%s:overdue_once:%s:%s:%s',v_policy_version,se.id,p.id,se.due_date)
  FROM public.shared_expenses se JOIN public.shared_expense_participants p ON p.shared_expense_id=se.id
  WHERE (p_expense_id IS NULL OR se.id=p_expense_id) AND se.status='active' AND se.deleted_at IS NULL
    AND se.reminder_enabled AND se.due_date IS NOT NULL AND p.status IN ('pending','partial','notified')
    AND p.opt_out_at IS NULL AND (p.phone_e164 IS NOT NULL OR p.linked_user_id IS NOT NULL)
    AND public.split_due_timestamp(se.due_date+1,cfg.send_hour)>now()
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows=ROW_COUNT; v_added:=v_added+v_rows;
  RETURN v_added;
END $$;
REVOKE ALL ON FUNCTION public.schedule_split_due_reminders(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_split_due_reminders(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_split_reminder_policy_update(
  _enabled boolean,_due_soon_days_before integer,_due_today_enabled boolean,_first_overdue_days integer,
  _repeat_every_days integer,_max_overdue_reminders integer,_send_hour integer,_pause_on_reply boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.has_platform_permission('messaging.write') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _send_hour NOT BETWEEN 0 AND 23 THEN RAISE EXCEPTION 'invalid_send_hour'; END IF;
  UPDATE public.split_reminder_policy SET enabled=_enabled,due_soon_days_before=0,due_today_enabled=true,
    first_overdue_days=1,repeat_every_days=1,max_overdue_reminders=1,send_hour=_send_hour,
    pause_on_reply=_pause_on_reply,updated_by=auth.uid(),updated_at=now() WHERE id=1
  RETURNING to_jsonb(split_reminder_policy.*)-'id'-'updated_by' INTO v_result;
  UPDATE public.reminder_jobs SET status='skipped'::public.reminder_status,last_error='policy_replaced_due_plus_one',updated_at=now()
    WHERE kind IN ('reminder','due_soon','due_today','overdue') AND status='queued'::public.reminder_status;
  PERFORM public.schedule_split_due_reminders(NULL);
  INSERT INTO public.admin_configuration_audit(actor_id,action,entity_type,entity_id,after_json)
  VALUES(auth.uid(),'messaging.split_policy.update','split_reminder_policy','1',v_result);
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.admin_split_reminder_policy_update(boolean,integer,boolean,integer,integer,integer,integer,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_split_reminder_policy_update(boolean,integer,boolean,integer,integer,integer,integer,boolean) TO authenticated,service_role;

UPDATE public.reminder_jobs SET status='skipped'::public.reminder_status,last_error='policy_replaced_due_plus_one',updated_at=now()
WHERE kind IN ('reminder','due_soon','due_today','overdue') AND status='queued'::public.reminder_status;
SELECT public.schedule_split_due_reminders(NULL);