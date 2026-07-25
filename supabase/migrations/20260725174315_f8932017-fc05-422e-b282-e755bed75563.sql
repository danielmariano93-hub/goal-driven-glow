
-- 1) reminder_jobs.followup_of + unique index
ALTER TABLE public.reminder_jobs
  ADD COLUMN IF NOT EXISTS followup_of uuid
    REFERENCES public.reminder_jobs(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS reminder_jobs_followup_uniq
  ON public.reminder_jobs(followup_of)
  WHERE followup_of IS NOT NULL;

-- 2) Trigger to schedule the single followup reminder when an invite is enqueued
CREATE OR REPLACE FUNCTION public.tg_schedule_split_invite_followup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  hours_delay int := coalesce(
    nullif(current_setting('app.split_second_message_hours', true), '')::int,
    48
  );
BEGIN
  IF NEW.kind = 'invite'
     AND NEW.status = 'enqueued'
     AND (OLD.status IS DISTINCT FROM 'enqueued')
     AND NEW.followup_of IS NULL
  THEN
    BEGIN
      INSERT INTO public.reminder_jobs(
        owner_user_id, shared_expense_id, participant_id,
        scheduled_for, kind, status, followup_of
      ) VALUES (
        NEW.owner_user_id, NEW.shared_expense_id, NEW.participant_id,
        now() + make_interval(hours => hours_delay),
        'reminder', 'queued', NEW.id
      );
    EXCEPTION WHEN unique_violation THEN
      -- followup already exists for this invite; idempotent no-op
      NULL;
    END;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.tg_schedule_split_invite_followup() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_rj_schedule_followup ON public.reminder_jobs;
CREATE TRIGGER trg_rj_schedule_followup
  AFTER UPDATE OF status ON public.reminder_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_schedule_split_invite_followup();

-- 3) Extend agent_execute_confirmation to handle shared_goal_create and
--    shared_goal_contribution kinds via canonical RPCs. Keeps legacy path
--    untouched for existing kinds.
CREATE OR REPLACE FUNCTION public.agent_execute_confirmation(
  p_confirmation_id uuid,
  p_source_message_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  c public.pending_confirmations;
  r jsonb;
  p jsonb;
  v_goal_id uuid;
  v_contrib_id uuid;
  v_prev_uid uuid;
BEGIN
  SELECT * INTO c FROM public.pending_confirmations
    WHERE id = p_confirmation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF c.status = 'confirmed' AND c.result_snapshot IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'result', c.result_snapshot);
  END IF;
  IF c.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cancelled');
  END IF;
  IF c.status = 'expired' OR c.expires_at < now() THEN
    UPDATE public.pending_confirmations SET status = 'expired'
      WHERE id = c.id AND status = 'pending';
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  IF c.kind = 'credit_card_bill_payment' THEN
    r := public._exec_credit_card_bill_payment(c);
    IF (r->>'ok') = 'false' THEN
      RETURN r;
    END IF;
    UPDATE public.pending_confirmations
       SET status = 'confirmed', executed_at = now(),
           result_snapshot = r,
           confirmed_from_message_id = p_source_message_id
     WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'result', r);
  END IF;

  IF c.kind IN ('shared_goal_create', 'shared_goal_contribution') THEN
    p := coalesce(c.payload, '{}'::jsonb);
    -- Run canonical RPC in the context of the drafting user.
    -- shared_goal_* functions use auth.uid(); we impersonate via GUC.
    v_prev_uid := nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    PERFORM set_config('request.jwt.claim.sub', c.user_id::text, true);

    IF c.kind = 'shared_goal_create' THEN
      v_goal_id := public.shared_goal_create(
        p_title := (p->>'title'),
        p_target_amount := (p->>'target_amount')::numeric,
        p_deadline := nullif(p->>'deadline','')::date
      );
      r := jsonb_build_object('kind', 'shared_goal_create',
                              'goal_id', v_goal_id,
                              'title', (p->>'title'));
    ELSE
      v_contrib_id := public.shared_goal_add_contribution(
        p_goal_id := (p->>'goal_id')::uuid,
        p_amount := (p->>'amount')::numeric,
        p_occurred_at := coalesce(nullif(p->>'occurred_at','')::date, current_date),
        p_note := nullif(p->>'note',''),
        p_idempotency_key := coalesce(nullif(p->>'idempotency_key',''),
                                      c.user_id::text || ':' || (p->>'goal_id') || ':' || c.id::text)
      );
      r := jsonb_build_object('kind', 'shared_goal_contribution',
                              'contribution_id', v_contrib_id,
                              'goal_id', p->>'goal_id',
                              'amount', p->>'amount');
    END IF;

    -- restore jwt sub (best effort)
    PERFORM set_config('request.jwt.claim.sub', coalesce(v_prev_uid::text, ''), true);

    UPDATE public.pending_confirmations
       SET status = 'confirmed', executed_at = now(),
           result_snapshot = r,
           confirmed_from_message_id = p_source_message_id
     WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'result', r);
  END IF;

  -- Delegate to legacy for all other kinds. Row already locked in this tx.
  RETURN public.agent_execute_confirmation_legacy_v1(p_confirmation_id, p_source_message_id);
END;
$fn$;
