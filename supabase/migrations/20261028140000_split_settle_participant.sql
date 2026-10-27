-- Quitação antecipada: o integrante paga de uma vez tudo o que deve. Uma baixa única para o dono,
-- uma única mensagem de agradecimento ao integrante e nenhuma mensagem aos demais.

alter table public.shared_expense_payments add column if not exists batch_id uuid;
create index if not exists idx_shared_expense_payments_batch on public.shared_expense_payments(batch_id) where batch_id is not null;

-- Mesma regra de recebimento, agora com opção de não notificar (usada pela quitação em lote).
drop function if exists public.split_add_installment_payment(uuid, numeric, timestamptz, text);
create or replace function public.split_add_installment_payment(p_installment_id uuid, p_amount numeric, p_paid_at timestamptz default now(), p_reference text default null, p_notify boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  uid uuid := auth.uid();
  inst record; se record; part record;
  v_balance numeric; v_apply numeric; tx_id uuid; tx2_id uuid; pay_id uuid;
  v_share numeric; v_ledger numeric; v_other numeric;
  recipient record; v_all_paid boolean;
  v_date date;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada'; END IF;
  SELECT * INTO inst FROM public.shared_expense_installments
   WHERE id = p_installment_id AND owner_user_id = uid FOR UPDATE;
  IF inst.id IS NULL THEN RAISE EXCEPTION 'Parcela não encontrada'; END IF;
  IF inst.status = 'cancelled' THEN RAISE EXCEPTION 'Parcela cancelada'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Informe um valor válido'; END IF;

  SELECT * INTO se FROM public.shared_expenses WHERE id = inst.shared_expense_id FOR UPDATE;
  IF se.status = 'cancelled' THEN RAISE EXCEPTION 'Divisão cancelada'; END IF;
  SELECT * INTO part FROM public.shared_expense_participants WHERE id = inst.participant_id;

  v_balance := greatest(inst.amount - inst.paid_amount, 0);
  IF v_balance <= 0 THEN RAISE EXCEPTION 'Esta parcela já está quitada'; END IF;
  v_apply := least(p_amount, v_balance);
  v_date := (p_paid_at AT TIME ZONE 'America/Sao_Paulo')::date;

  IF se.reimbursement_account_id IS NOT NULL THEN
    v_share := coalesce(public.split_ledger_share(se.id), 1);
    v_ledger := round(v_apply * v_share, 2);
    v_other := v_apply - v_ledger;
    IF v_ledger > 0 THEN
      INSERT INTO public.transactions(user_id, account_id, category_id, type, status, amount, occurred_at,
        description, notes, payment_method, movement_kind, shared_expense_id, split_transaction_role)
      VALUES (uid, se.reimbursement_account_id, NULL, 'income', 'confirmed', v_ledger, v_date,
        'Reembolso · ' || se.title,
        format('Recebido de %s — parcela %s/%s da Divisão do Rolê', part.name, inst.installment_number, inst.total_installments),
        'account', 'refund', se.id, 'reimbursement')
      RETURNING id INTO tx_id;
    END IF;
    IF v_other > 0 THEN
      INSERT INTO public.transactions(user_id, account_id, category_id, type, status, amount, occurred_at,
        description, notes, payment_method, movement_kind, shared_expense_id, split_transaction_role)
      VALUES (uid, se.reimbursement_account_id, NULL, 'income', 'confirmed', v_other, v_date,
        'Recebimento · ' || se.title,
        format('Recebido de %s — parcela %s/%s da Divisão do Rolê', part.name, inst.installment_number, inst.total_installments),
        'account', 'external_transfer_in', se.id, 'reimbursement')
      RETURNING id INTO tx2_id;
    END IF;
    IF tx_id IS NULL THEN tx_id := tx2_id; tx2_id := NULL; END IF;
  END IF;

  INSERT INTO public.shared_expense_payments(
    shared_expense_id, installment_id, participant_id, owner_user_id, amount, paid_at, transaction_id, secondary_transaction_id, reference)
  VALUES (se.id, inst.id, inst.participant_id, uid, v_apply, coalesce(p_paid_at, now()), tx_id, tx2_id, p_reference)
  RETURNING id INTO pay_id;

  INSERT INTO public.shared_expense_events(shared_expense_id, owner_user_id, participant_id, event_type, payload)
  VALUES (se.id, uid, inst.participant_id,
    CASE WHEN v_apply >= v_balance THEN 'installment_paid' ELSE 'installment_partial_payment' END,
    jsonb_build_object('installment_id', inst.id, 'installment_number', inst.installment_number,
      'amount', v_apply, 'balance_after', v_balance - v_apply, 'payment_id', pay_id, 'transaction_id', tx_id));

  IF v_apply >= v_balance THEN
    UPDATE public.reminder_jobs
       SET status = 'skipped', cancel_reason = 'already_paid', last_error = 'already_paid',
           lease_expires_at = NULL, updated_at = now()
     WHERE installment_id = inst.id
       AND status IN ('queued','processing')
       AND kind IN ('reminder','due_soon','due_today','overdue');
  END IF;

  IF p_notify AND part.phone_e164 IS NOT NULL THEN
    PERFORM public.split_enqueue_installment_message(se.id, inst.participant_id, inst.id, 'payment_confirmation', now());
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.shared_expense_installments
     WHERE shared_expense_id = se.id AND status IN ('pending','partial')) INTO v_all_paid;

  IF v_all_paid AND p_notify THEN
    FOR recipient IN SELECT id FROM public.shared_expense_participants
      WHERE shared_expense_id = se.id AND phone_e164 IS NOT NULL AND opt_out_at IS NULL LOOP
      PERFORM public.split_enqueue_message(se.id, recipient.id, 'completed', now());
    END LOOP;
  END IF;

  RETURN jsonb_build_object('payment_id', pay_id, 'applied', v_apply,
    'balance', v_balance - v_apply, 'transaction_id', tx_id, 'settled', v_all_paid);
END;
$$;


create or replace function public.split_settle_participant(p_participant_id uuid, p_paid_at timestamptz default now(), p_reference text default 'settle_all')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  uid uuid := auth.uid();
  part record; inst record; v_batch uuid := gen_random_uuid();
  v_total numeric := 0; v_count int := 0; v_last uuid; v_all_paid boolean; pay_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada'; END IF;
  SELECT * INTO part FROM public.shared_expense_participants WHERE id = p_participant_id AND owner_user_id = uid;
  IF part.id IS NULL THEN RAISE EXCEPTION 'Integrante não encontrado'; END IF;

  FOR inst IN
    SELECT id, amount, paid_amount FROM public.shared_expense_installments
     WHERE participant_id = p_participant_id AND owner_user_id = uid
       AND status IN ('pending','partial') AND amount - paid_amount > 0
     ORDER BY installment_number
  LOOP
    PERFORM public.split_add_installment_payment(inst.id, inst.amount - inst.paid_amount, p_paid_at, p_reference, false);
    v_total := v_total + (inst.amount - inst.paid_amount);
    v_count := v_count + 1;
    v_last := inst.id;
  END LOOP;
  IF v_count = 0 THEN RAISE EXCEPTION 'Este integrante não tem nada em aberto'; END IF;

  UPDATE public.shared_expense_payments SET batch_id = v_batch
   WHERE participant_id = p_participant_id AND owner_user_id = uid
     AND reference = p_reference AND batch_id IS NULL AND reversed_at IS NULL
     AND created_at >= now() - interval '1 minute';

  INSERT INTO public.shared_expense_events(shared_expense_id, owner_user_id, participant_id, event_type, payload)
  VALUES (part.shared_expense_id, uid, p_participant_id, 'participant_settled',
    jsonb_build_object('batch_id', v_batch, 'installments', v_count, 'amount', v_total));

  IF part.phone_e164 IS NOT NULL THEN
    PERFORM public.split_enqueue_installment_message(part.shared_expense_id, p_participant_id, v_last, 'payment_confirmation', now());
  END IF;

  SELECT NOT EXISTS (SELECT 1 FROM public.shared_expense_installments
     WHERE shared_expense_id = part.shared_expense_id AND status IN ('pending','partial')) INTO v_all_paid;
  RETURN jsonb_build_object('batch_id', v_batch, 'installments', v_count, 'amount', v_total, 'settled', v_all_paid);
END;
$$;

-- Desfazer um recebimento de quitação desfaz o lote inteiro.
create or replace function public.split_reverse_installment_payment(p_payment_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
DECLARE uid uuid := auth.uid(); pay record; one record;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada'; END IF;
  SELECT * INTO pay FROM public.shared_expense_payments
   WHERE id = p_payment_id AND owner_user_id = uid FOR UPDATE;
  IF pay.id IS NULL THEN RAISE EXCEPTION 'Recebimento não encontrado'; END IF;
  IF pay.reversed_at IS NOT NULL THEN RETURN; END IF;

  FOR one IN
    SELECT * FROM public.shared_expense_payments
     WHERE owner_user_id = uid AND reversed_at IS NULL
       AND (id = pay.id OR (pay.batch_id IS NOT NULL AND batch_id = pay.batch_id))
     FOR UPDATE
  LOOP
    UPDATE public.shared_expense_payments SET reversed_at = now(), reversal_reason = p_reason WHERE id = one.id;
    IF one.transaction_id IS NOT NULL THEN
      DELETE FROM public.transactions WHERE id = one.transaction_id AND user_id = uid;
    END IF;
    IF one.secondary_transaction_id IS NOT NULL THEN
      DELETE FROM public.transactions WHERE id = one.secondary_transaction_id AND user_id = uid;
    END IF;
    INSERT INTO public.shared_expense_events(shared_expense_id, owner_user_id, participant_id, event_type, payload)
    VALUES (one.shared_expense_id, uid, one.participant_id, 'reverse_payment',
      jsonb_build_object('payment_id', one.id, 'amount', one.amount, 'reason', p_reason, 'batch_id', one.batch_id));
  END LOOP;

  UPDATE public.shared_expenses SET status = 'active'::split_status
   WHERE id = pay.shared_expense_id AND status = 'settled'::split_status;
END;
$$;

revoke all on function public.split_settle_participant(uuid, timestamptz, text) from public, anon;
grant execute on function public.split_settle_participant(uuid, timestamptz, text) to authenticated;
revoke all on function public.split_add_installment_payment(uuid, numeric, timestamptz, text, boolean) from public, anon;
grant execute on function public.split_add_installment_payment(uuid, numeric, timestamptz, text, boolean) to authenticated;
