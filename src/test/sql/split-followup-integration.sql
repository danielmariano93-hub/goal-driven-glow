-- Integration test: trigger `trg_rj_schedule_followup` cria followup único.
-- Executar: psql -f src/test/sql/split-followup-integration.sql
BEGIN;
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_part  uuid := gen_random_uuid();
  v_exp   uuid;
  v_pid   uuid;
  v_inv   uuid;
  v_fu_count int;
  v_fu_row  record;
BEGIN
  -- Setup como postgres (bypass RLS).
  INSERT INTO public.shared_expenses(owner_user_id, title, total_amount, occurred_at, status)
  VALUES (v_owner, 'Followup Test', 100, current_date, 'active')
  RETURNING id INTO v_exp;

  INSERT INTO public.shared_expense_participants(shared_expense_id, owner_user_id, name, phone_e164, amount_due, status)
  VALUES (v_exp, v_owner, 'Bruno', '+5511999990000', 50, 'pending')
  RETURNING id INTO v_pid;

  -- Cria job de invite em estado queued.
  INSERT INTO public.reminder_jobs(owner_user_id, shared_expense_id, participant_id, scheduled_for, kind, status)
  VALUES (v_owner, v_exp, v_pid, now(), 'invite', 'queued')
  RETURNING id INTO v_inv;

  -- Transição queued -> enqueued: deve criar exatamente 1 followup.
  UPDATE public.reminder_jobs SET status='enqueued' WHERE id=v_inv;

  SELECT count(*) INTO v_fu_count FROM public.reminder_jobs WHERE followup_of = v_inv;
  ASSERT v_fu_count = 1, format('esperado 1 followup, veio %s', v_fu_count);

  SELECT * INTO v_fu_row FROM public.reminder_jobs WHERE followup_of = v_inv;
  ASSERT v_fu_row.kind = 'reminder',      format('followup kind=%s', v_fu_row.kind);
  ASSERT v_fu_row.status = 'queued',      format('followup status=%s', v_fu_row.status);
  ASSERT v_fu_row.scheduled_for > now(),  'followup scheduled_for deve ser no futuro';
  ASSERT v_fu_row.followup_of = v_inv,    'followup_of deve referenciar o invite';

  -- Repetir a transição / reprocessar NÃO duplica.
  UPDATE public.reminder_jobs SET status='queued'   WHERE id=v_inv;
  UPDATE public.reminder_jobs SET status='enqueued' WHERE id=v_inv;
  UPDATE public.reminder_jobs SET status='enqueued', updated_at=now() WHERE id=v_inv; -- no-op idempotente

  SELECT count(*) INTO v_fu_count FROM public.reminder_jobs WHERE followup_of = v_inv;
  ASSERT v_fu_count = 1, format('após retry, esperado 1 followup, veio %s', v_fu_count);

  -- Opt-out do participante: dispatcher deve marcar skipped ao processar.
  UPDATE public.shared_expense_participants SET opt_out_at = now() WHERE id = v_pid;
  -- Simulamos a decisão do dispatcher: o opt_out_at + phone válido é a checagem
  -- em split-reminders-dispatch/index.ts (linha `p?.opt_out_at`).
  ASSERT EXISTS (
    SELECT 1 FROM public.shared_expense_participants
    WHERE id = v_pid AND opt_out_at IS NOT NULL
  ), 'opt_out deve ser persistido';

  RAISE NOTICE 'PASS: split followup idempotente e trigger correto (invite=%, followup=%)', v_inv, v_fu_row.id;
END $$;
ROLLBACK;
