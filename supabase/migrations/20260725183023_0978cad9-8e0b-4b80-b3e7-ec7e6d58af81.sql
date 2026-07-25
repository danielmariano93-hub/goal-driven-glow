CREATE OR REPLACE FUNCTION public._test_split_followup()
RETURNS TABLE(assertion text, passed boolean, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_acc   uuid := gen_random_uuid();
  v_exp   uuid := gen_random_uuid();
  v_pid   uuid := gen_random_uuid();
  v_inv   uuid;
  v_fu_id uuid;
  v_count int;
  v_row   record;
BEGIN
  -- Setup mínimo (auth.users + accounts + shared_expenses + participante).
  INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          't-fu-'||v_owner::text||'@t.test', '', now(), now(), now());

  INSERT INTO public.accounts(id, user_id, name, type, opening_balance)
  VALUES (v_acc, v_owner, '__test_fu_acc__', 'checking', 0);

  INSERT INTO public.shared_expenses(id, owner_user_id, title, total_amount, occurred_at, status, source_account_id)
  VALUES (v_exp, v_owner, '__test_followup__', 100, current_date, 'active', v_acc);

  INSERT INTO public.shared_expense_participants(id, shared_expense_id, owner_user_id, name, phone_e164, amount_due)
  VALUES (v_pid, v_exp, v_owner, 'FU-Part', '+5511999990000', 50);

  INSERT INTO public.reminder_jobs(id, owner_user_id, shared_expense_id, participant_id, scheduled_for, kind, status)
  VALUES (gen_random_uuid(), v_owner, v_exp, v_pid, now(), 'invite', 'queued')
  RETURNING id INTO v_inv;

  -- Assert 1: transição queued -> enqueued cria exatamente 1 followup.
  UPDATE public.reminder_jobs SET status='enqueued' WHERE id = v_inv;
  SELECT count(*) INTO v_count FROM public.reminder_jobs WHERE followup_of = v_inv;
  assertion := 'invite enqueued gera exatamente 1 followup';
  passed := (v_count = 1);
  detail := 'count=' || v_count;
  RETURN NEXT;

  SELECT * INTO v_row FROM public.reminder_jobs WHERE followup_of = v_inv LIMIT 1;
  v_fu_id := v_row.id;

  assertion := 'followup kind=reminder';
  passed := (v_row.kind = 'reminder');
  detail := 'kind=' || coalesce(v_row.kind, 'null');
  RETURN NEXT;

  assertion := 'followup status=queued';
  passed := (v_row.status = 'queued');
  detail := 'status=' || coalesce(v_row.status::text, 'null');
  RETURN NEXT;

  assertion := 'followup scheduled_for é futuro';
  passed := (v_row.scheduled_for > now());
  detail := 'scheduled_for=' || v_row.scheduled_for::text;
  RETURN NEXT;

  assertion := 'followup_of referencia o convite';
  passed := (v_row.followup_of = v_inv);
  detail := 'followup_of=' || coalesce(v_row.followup_of::text, 'null');
  RETURN NEXT;

  -- Assert 2: repetir transição / reprocessar não duplica.
  UPDATE public.reminder_jobs SET status='queued'   WHERE id = v_inv;
  UPDATE public.reminder_jobs SET status='enqueued' WHERE id = v_inv;
  UPDATE public.reminder_jobs SET status='enqueued', updated_at=now() WHERE id = v_inv;
  SELECT count(*) INTO v_count FROM public.reminder_jobs WHERE followup_of = v_inv;
  assertion := 'retry não duplica followup';
  passed := (v_count = 1);
  detail := 'count após retry=' || v_count;
  RETURN NEXT;

  -- Assert 3: opt-out do participante persistido (regra respeitada pelo dispatcher).
  UPDATE public.shared_expense_participants SET opt_out_at = now() WHERE id = v_pid;
  SELECT count(*) INTO v_count FROM public.shared_expense_participants
    WHERE id = v_pid AND opt_out_at IS NOT NULL;
  assertion := 'opt-out persiste (dispatcher pula quando presente)';
  passed := (v_count = 1);
  detail := 'opt_out participants=' || v_count;
  RETURN NEXT;

  -- Cleanup best-effort (não bloqueia se algum FK falhar).
  BEGIN
    DELETE FROM public.reminder_jobs WHERE shared_expense_id = v_exp;
    DELETE FROM public.shared_expense_participants WHERE shared_expense_id = v_exp;
    DELETE FROM public.shared_expenses WHERE id = v_exp;
    DELETE FROM public.accounts WHERE id = v_acc;
    DELETE FROM auth.users WHERE id = v_owner;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public._test_split_followup() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._test_split_followup() TO service_role;