CREATE OR REPLACE FUNCTION public.tg_reconcile_split_due_schedule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_expense_id uuid;
BEGIN
  IF TG_TABLE_NAME='shared_expenses' THEN
    v_expense_id:=NEW.id;
    IF TG_OP='UPDATE' AND (NEW.due_date IS DISTINCT FROM OLD.due_date OR NEW.reminder_enabled IS DISTINCT FROM OLD.reminder_enabled OR NEW.status IS DISTINCT FROM OLD.status OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at) THEN
      UPDATE public.reminder_jobs SET status='skipped'::public.reminder_status,last_error='schedule_changed',lease_expires_at=NULL,updated_at=now()
      WHERE shared_expense_id=NEW.id AND kind IN ('reminder','due_soon','due_today','overdue') AND status='queued'::public.reminder_status;
    END IF;
  ELSE
    v_expense_id:=NEW.shared_expense_id;
    IF NEW.status NOT IN ('pending','partial','notified') OR NEW.opt_out_at IS NOT NULL THEN
      UPDATE public.reminder_jobs SET status='skipped'::public.reminder_status,last_error=CASE WHEN NEW.opt_out_at IS NOT NULL THEN 'opted_out' ELSE 'participant_settled' END,lease_expires_at=NULL,updated_at=now()
      WHERE participant_id=NEW.id AND kind IN ('reminder','due_soon','due_today','overdue') AND status='queued'::public.reminder_status;
      RETURN NEW;
    END IF;
  END IF;
  PERFORM public.schedule_split_due_reminders(v_expense_id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_reconcile_split_due_schedule() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tg_reconcile_split_due_schedule() TO service_role;