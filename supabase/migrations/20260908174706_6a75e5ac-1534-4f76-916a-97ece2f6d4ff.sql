-- Funções internas de recálculo não são API pública
REVOKE EXECUTE ON FUNCTION public.split_recalc_installment(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.split_payments_recalc_trigger() FROM anon, authenticated;

-- =====================================================================
-- 1) Lembretes por participante + parcela
-- =====================================================================
ALTER TABLE public.reminder_jobs
  ADD COLUMN IF NOT EXISTS installment_id uuid REFERENCES public.shared_expense_installments(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS public.split_jobs_live_uniq;
CREATE UNIQUE INDEX split_jobs_live_uniq ON public.reminder_jobs
  (shared_expense_id, participant_id, coalesce(installment_id, '00000000-0000-0000-0000-000000000000'::uuid), kind)
  WHERE status = ANY (ARRAY['queued'::reminder_status, 'processing'::reminder_status, 'enqueued'::reminder_status]);

-- Backfill: jobs vivos apontam para a parcela aberta mais antiga
UPDATE public.reminder_jobs j
   SET installment_id = i.id
  FROM public.shared_expense_installments i
 WHERE j.installment_id IS NULL
   AND j.participant_id = i.participant_id
   AND i.status IN ('pending','partial')
   AND i.id = (
     SELECT x.id FROM public.shared_expense_installments x
      WHERE x.participant_id = j.participant_id AND x.status IN ('pending','partial')
      ORDER BY x.installment_number LIMIT 1);

CREATE OR REPLACE FUNCTION public.split_installment_is_eligible(p_installment_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.split_receivables_v1 r
     WHERE r.installment_id = p_installment_id
       AND r.split_status = 'active' AND r.deleted_at IS NULL AND r.reminder_enabled
       AND r.due_date IS NOT NULL
       AND r.settlement_status IN ('pending','partial')
       AND r.balance_due > 0
       AND r.opt_out_at IS NULL
       AND (r.phone_e164 IS NOT NULL OR r.linked_user_id IS NOT NULL)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.split_installment_is_eligible(uuid) FROM anon;

-- Enfileiramento por parcela
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
REVOKE EXECUTE ON FUNCTION public.split_enqueue_installment_message(uuid,uuid,uuid,text,timestamptz) FROM anon;

-- Compatibilidade: assinatura antiga resolve a parcela aberta mais antiga
CREATE OR REPLACE FUNCTION public.split_enqueue_message(
  p_expense_id uuid, p_participant_id uuid, p_kind text, p_when timestamptz DEFAULT now())
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_installment uuid;
BEGIN
  SELECT id INTO v_installment FROM public.shared_expense_installments
   WHERE participant_id = p_participant_id AND status IN ('pending','partial')
   ORDER BY coalesce(due_date, '2999-12-31'::date), installment_number
   LIMIT 1;
  IF v_installment IS NULL THEN
    SELECT id INTO v_installment FROM public.shared_expense_installments
     WHERE participant_id = p_participant_id
     ORDER BY installment_number DESC LIMIT 1;
  END IF;
  RETURN public.split_enqueue_installment_message(p_expense_id, p_participant_id, v_installment, p_kind, p_when);
END;
$$;

-- Agenda de lembretes por parcela
CREATE OR REPLACE FUNCTION public.schedule_split_due_reminders(p_expense_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg public.split_reminder_policy%ROWTYPE;
  v_policy_version text;
  v_added integer := 0;
  r record;
  v_planned timestamptz;
  v_effective timestamptz;
  v_window interval;
  v_base_key text;
  v_key text;
  v_attempts integer;
BEGIN
  SELECT * INTO cfg FROM public.split_reminder_policy WHERE id = 1;
  IF NOT FOUND OR NOT cfg.enabled THEN RETURN 0; END IF;
  v_policy_version := to_char(cfg.updated_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS');

  FOR r IN
    SELECT rv.shared_expense_id AS expense_id, rv.owner_user_id, rv.due_date,
           rv.participant_id, rv.installment_id, k.kind, k.offset_days
      FROM public.split_receivables_v1 rv
      CROSS JOIN (VALUES ('due_today', 0), ('overdue', 1)) AS k(kind, offset_days)
     WHERE (p_expense_id IS NULL OR rv.shared_expense_id = p_expense_id)
       AND public.split_installment_is_eligible(rv.installment_id)
  LOOP
    v_planned := public.split_due_timestamp(r.due_date + r.offset_days, cfg.send_hour);
    v_window := CASE WHEN r.kind = 'due_today' THEN interval '12 hours' ELSE interval '3 days' END;
    IF v_planned > now() THEN
      v_effective := v_planned;
    ELSIF now() <= v_planned + v_window THEN
      v_effective := now();
    ELSE
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.reminder_jobs j
       WHERE j.installment_id = r.installment_id
         AND j.kind = r.kind
         AND date(j.scheduled_for) = date(v_effective)
         AND (j.delivered_at IS NOT NULL OR j.read_at IS NOT NULL
              OR j.status = 'sent'::public.reminder_status)
    ) THEN
      CONTINUE;
    END IF;

    v_base_key := format('split:policy:%s:%s:%s:%s:%s:%s',
      v_policy_version, r.kind, r.expense_id, r.participant_id, r.installment_id, r.due_date);
    SELECT count(*) INTO v_attempts
      FROM public.reminder_jobs j
     WHERE j.idempotency_key = v_base_key OR j.idempotency_key LIKE v_base_key || ':r%';
    v_key := CASE WHEN v_attempts = 0 THEN v_base_key ELSE v_base_key || ':r' || v_attempts END;

    INSERT INTO public.reminder_jobs(
      owner_user_id, shared_expense_id, participant_id, installment_id, scheduled_for, status, kind,
      idempotency_key, policy_version, delivery_status)
    VALUES (
      r.owner_user_id, r.expense_id, r.participant_id, r.installment_id, v_effective,
      'queued'::public.reminder_status, r.kind, v_key, v_policy_version, 'none')
    ON CONFLICT (shared_expense_id, participant_id, coalesce(installment_id, '00000000-0000-0000-0000-000000000000'::uuid), kind)
      WHERE status IN ('queued'::public.reminder_status,'processing'::public.reminder_status,'enqueued'::public.reminder_status)
    DO UPDATE SET
      scheduled_for = CASE WHEN public.reminder_jobs.status = 'queued'::public.reminder_status
                           THEN EXCLUDED.scheduled_for ELSE public.reminder_jobs.scheduled_for END,
      policy_version = EXCLUDED.policy_version,
      updated_at = now();
    v_added := v_added + 1;
  END LOOP;

  RETURN v_added;
END;
$$;

-- Elegibilidade por participante continua existindo (usada por relatórios antigos),
-- agora derivada das parcelas.
CREATE OR REPLACE FUNCTION public.split_participant_is_eligible(p_participant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.shared_expense_installments i
     WHERE i.participant_id = p_participant_id
       AND public.split_installment_is_eligible(i.id)
  );
$$;

-- =====================================================================
-- 2) Pagamento por parcela
-- =====================================================================
CREATE OR REPLACE FUNCTION public.split_add_installment_payment(
  p_installment_id uuid, p_amount numeric,
  p_paid_at timestamptz DEFAULT now(), p_reference text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  inst record; se record; part record;
  v_balance numeric; v_apply numeric; tx_id uuid; pay_id uuid;
  recipient record; v_all_paid boolean;
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

  IF se.reimbursement_account_id IS NOT NULL THEN
    INSERT INTO public.transactions(user_id, account_id, category_id, type, status, amount, occurred_at,
      description, notes, payment_method, movement_kind, shared_expense_id, split_transaction_role)
    VALUES (uid, se.reimbursement_account_id, NULL, 'income', 'confirmed', v_apply,
      (p_paid_at AT TIME ZONE 'America/Sao_Paulo')::date,
      'Reembolso · ' || se.title,
      format('Recebido de %s — parcela %s/%s da Divisão do Rolê', part.name, inst.installment_number, inst.total_installments),
      'account', 'refund', se.id, 'reimbursement')
    RETURNING id INTO tx_id;
  END IF;

  INSERT INTO public.shared_expense_payments(
    shared_expense_id, installment_id, participant_id, owner_user_id, amount, paid_at, transaction_id, reference)
  VALUES (se.id, inst.id, inst.participant_id, uid, v_apply, coalesce(p_paid_at, now()), tx_id, p_reference)
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

  IF part.phone_e164 IS NOT NULL THEN
    PERFORM public.split_enqueue_installment_message(se.id, inst.participant_id, inst.id, 'payment_confirmation', now());
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.shared_expense_installments
     WHERE shared_expense_id = se.id AND status IN ('pending','partial')) INTO v_all_paid;

  IF v_all_paid THEN
    FOR recipient IN SELECT id FROM public.shared_expense_participants
      WHERE shared_expense_id = se.id AND phone_e164 IS NOT NULL AND opt_out_at IS NULL LOOP
      PERFORM public.split_enqueue_message(se.id, recipient.id, 'completed', now());
    END LOOP;
  END IF;

  RETURN jsonb_build_object('payment_id', pay_id, 'applied', v_apply,
    'balance', v_balance - v_apply, 'transaction_id', tx_id, 'settled', v_all_paid);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.split_add_installment_payment(uuid,numeric,timestamptz,text) FROM anon;

-- Compatibilidade: pagamento por participante distribui nas parcelas mais antigas
CREATE OR REPLACE FUNCTION public.split_add_payment_v2(p_participant_id uuid, p_amount numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE uid uuid := auth.uid(); rest numeric := p_amount; inst record; v_bal numeric;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Pagamento inválido'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shared_expense_participants WHERE id = p_participant_id AND owner_user_id = uid) THEN
    RAISE EXCEPTION 'Participante não encontrado';
  END IF;

  FOR inst IN
    SELECT id, amount, paid_amount FROM public.shared_expense_installments
     WHERE participant_id = p_participant_id AND status IN ('pending','partial')
     ORDER BY coalesce(due_date, '2999-12-31'::date), installment_number
  LOOP
    EXIT WHEN rest <= 0;
    v_bal := greatest(inst.amount - inst.paid_amount, 0);
    IF v_bal > 0 THEN
      PERFORM public.split_add_installment_payment(inst.id, least(rest, v_bal), now(), 'participant_allocation');
      rest := rest - least(rest, v_bal);
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.split_reverse_installment_payment(p_payment_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE uid uuid := auth.uid(); pay record;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada'; END IF;
  SELECT * INTO pay FROM public.shared_expense_payments
   WHERE id = p_payment_id AND owner_user_id = uid FOR UPDATE;
  IF pay.id IS NULL THEN RAISE EXCEPTION 'Recebimento não encontrado'; END IF;
  IF pay.reversed_at IS NOT NULL THEN RETURN; END IF;

  UPDATE public.shared_expense_payments
     SET reversed_at = now(), reversal_reason = p_reason
   WHERE id = pay.id;

  IF pay.transaction_id IS NOT NULL THEN
    DELETE FROM public.transactions WHERE id = pay.transaction_id AND user_id = uid;
  END IF;

  UPDATE public.shared_expenses SET status = 'active'::split_status
   WHERE id = pay.shared_expense_id AND status = 'settled'::split_status;

  INSERT INTO public.shared_expense_events(shared_expense_id, owner_user_id, participant_id, event_type, payload)
  VALUES (pay.shared_expense_id, uid, pay.participant_id, 'reverse_payment',
    jsonb_build_object('payment_id', pay.id, 'amount', pay.amount, 'reason', p_reason));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.split_reverse_installment_payment(uuid,text) FROM anon;

-- Estorno por participante: estorna todos os recebimentos ativos
CREATE OR REPLACE FUNCTION public.split_reverse_payment_v2(p_participant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE uid uuid := auth.uid(); pay record;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada'; END IF;
  FOR pay IN SELECT id FROM public.shared_expense_payments
    WHERE participant_id = p_participant_id AND owner_user_id = uid AND reversed_at IS NULL
  LOOP
    PERFORM public.split_reverse_installment_payment(pay.id, 'reverse_participant');
  END LOOP;
END;
$$;

-- =====================================================================
-- 3) Geração/validação de parcelas + cancelamentos
-- =====================================================================
CREATE OR REPLACE FUNCTION public.split_apply_installments(p_expense_id uuid, p_installments jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  part record; it jsonb; rows jsonb; n int; idx int;
  sum_cents bigint; due_cents bigint; base bigint; rem bigint; extra int;
  v_amount numeric; v_due date; v_first date; se record;
  locked_cents bigint;
BEGIN
  SELECT * INTO se FROM public.shared_expenses WHERE id = p_expense_id AND owner_user_id = uid;
  IF se.id IS NULL THEN RAISE EXCEPTION 'Divisão não encontrada'; END IF;

  FOR part IN SELECT * FROM public.shared_expense_participants
    WHERE shared_expense_id = p_expense_id AND owner_user_id = uid
  LOOP
    rows := coalesce(p_installments -> part.id::text, NULL);
    due_cents := round(coalesce(part.amount_due, 0) * 100)::bigint;

    -- Parcelas já pagas/parciais são imutáveis
    SELECT coalesce(sum(round(paid_amount * 100)::bigint), 0) INTO locked_cents
      FROM public.shared_expense_installments
     WHERE participant_id = part.id AND paid_amount > 0;

    IF rows IS NULL OR jsonb_typeof(rows) <> 'array' OR jsonb_array_length(rows) = 0 THEN
      -- À vista: uma parcela com o vencimento da divisão
      IF EXISTS (SELECT 1 FROM public.shared_expense_installments
                  WHERE participant_id = part.id AND paid_amount > 0) THEN
        UPDATE public.shared_expense_installments
           SET amount = part.amount_due, due_date = se.due_date, total_installments = 1, updated_at = now()
         WHERE participant_id = part.id AND paid_amount = 0 AND status <> 'cancelled'
           AND installment_number = 1;
      ELSE
        DELETE FROM public.shared_expense_installments
         WHERE participant_id = part.id AND paid_amount = 0;
        INSERT INTO public.shared_expense_installments(
          shared_expense_id, participant_id, owner_user_id, installment_number,
          total_installments, amount, due_date)
        VALUES (p_expense_id, part.id, uid, 1, 1, coalesce(part.amount_due, 0), se.due_date)
        ON CONFLICT (participant_id, installment_number) DO UPDATE
          SET amount = EXCLUDED.amount, due_date = EXCLUDED.due_date,
              total_installments = 1, updated_at = now();
      END IF;
      CONTINUE;
    END IF;

    n := jsonb_array_length(rows);
    sum_cents := 0;
    FOR it IN SELECT * FROM jsonb_array_elements(rows) LOOP
      sum_cents := sum_cents + round(coalesce((it->>'amount')::numeric, 0) * 100)::bigint;
    END LOOP;
    IF sum_cents <> due_cents THEN
      RAISE EXCEPTION 'A soma das parcelas de % precisa ser igual a R$ %', part.name, to_char(part.amount_due, 'FM999999990.00');
    END IF;
    IF sum_cents < locked_cents THEN
      RAISE EXCEPTION 'As parcelas de % não podem somar menos do que já foi recebido', part.name;
    END IF;

    DELETE FROM public.shared_expense_installments
     WHERE participant_id = part.id AND paid_amount = 0;

    idx := 0;
    FOR it IN SELECT * FROM jsonb_array_elements(rows) LOOP
      idx := idx + 1;
      v_amount := coalesce((it->>'amount')::numeric, 0);
      v_due := nullif(it->>'due_date','')::date;
      IF v_amount < 0 THEN RAISE EXCEPTION 'Valor de parcela inválido'; END IF;
      INSERT INTO public.shared_expense_installments(
        shared_expense_id, participant_id, owner_user_id, installment_number,
        total_installments, amount, due_date)
      VALUES (p_expense_id, part.id, uid, idx, n, v_amount, coalesce(v_due, se.due_date))
      ON CONFLICT (participant_id, installment_number) DO UPDATE
        SET amount = CASE WHEN public.shared_expense_installments.paid_amount > 0
                          THEN public.shared_expense_installments.amount ELSE EXCLUDED.amount END,
            due_date = CASE WHEN public.shared_expense_installments.paid_amount > 0
                            THEN public.shared_expense_installments.due_date ELSE EXCLUDED.due_date END,
            total_installments = EXCLUDED.total_installments,
            updated_at = now();
    END LOOP;

    INSERT INTO public.shared_expense_events(shared_expense_id, owner_user_id, participant_id, event_type, payload)
    VALUES (p_expense_id, uid, part.id, 'installments_generated',
      jsonb_build_object('count', n, 'total', part.amount_due));
  END LOOP;

  -- Recalcula estados após redistribuição
  PERFORM public.split_recalc_installment(i.id)
    FROM public.shared_expense_installments i WHERE i.shared_expense_id = p_expense_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.split_apply_installments(uuid,jsonb) FROM anon;

CREATE OR REPLACE FUNCTION public.split_cancel_installment(p_installment_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE uid uuid := auth.uid(); inst record;
BEGIN
  SELECT * INTO inst FROM public.shared_expense_installments
   WHERE id = p_installment_id AND owner_user_id = uid FOR UPDATE;
  IF inst.id IS NULL THEN RAISE EXCEPTION 'Parcela não encontrada'; END IF;
  IF inst.paid_amount > 0 THEN RAISE EXCEPTION 'Não é possível cancelar uma parcela já recebida'; END IF;

  UPDATE public.shared_expense_installments
     SET status = 'cancelled', cancelled_at = now(), updated_at = now()
   WHERE id = inst.id;

  UPDATE public.reminder_jobs
     SET status = 'skipped', cancel_reason = 'cancelled', last_error = 'cancelled',
         lease_expires_at = NULL, updated_at = now()
   WHERE installment_id = inst.id AND status IN ('queued','processing');

  INSERT INTO public.shared_expense_events(shared_expense_id, owner_user_id, participant_id, event_type, payload)
  VALUES (inst.shared_expense_id, uid, inst.participant_id, 'installment_cancelled',
    jsonb_build_object('installment_id', inst.id, 'amount', inst.amount, 'reason', p_reason));

  PERFORM public.split_recalc_installment(inst.id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.split_cancel_installment(uuid,text) FROM anon;

CREATE OR REPLACE FUNCTION public.split_cancel_participant(p_participant_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE uid uuid := auth.uid(); inst record; part record;
BEGIN
  SELECT * INTO part FROM public.shared_expense_participants
   WHERE id = p_participant_id AND owner_user_id = uid;
  IF part.id IS NULL THEN RAISE EXCEPTION 'Participante não encontrado'; END IF;

  FOR inst IN SELECT id FROM public.shared_expense_installments
    WHERE participant_id = p_participant_id AND paid_amount = 0 AND status <> 'cancelled'
  LOOP
    PERFORM public.split_cancel_installment(inst.id, coalesce(p_reason, 'participant_cancelled'));
  END LOOP;

  UPDATE public.reminder_jobs
     SET status = 'skipped', cancel_reason = 'cancelled', last_error = 'cancelled',
         lease_expires_at = NULL, updated_at = now()
   WHERE participant_id = p_participant_id AND status IN ('queued','processing');

  INSERT INTO public.shared_expense_events(shared_expense_id, owner_user_id, participant_id, event_type, payload)
  VALUES (part.shared_expense_id, uid, part.id, 'participant_cancelled',
    jsonb_build_object('reason', p_reason));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.split_cancel_participant(uuid,text) FROM anon;

-- =====================================================================
-- 4) Criação e edição com parcelas
-- =====================================================================
CREATE OR REPLACE FUNCTION public.split_create_v3(
  p_title text, p_total numeric, p_occurred_at date, p_due_date date,
  p_split_mode split_mode, p_include_owner boolean, p_reminder_enabled boolean,
  p_pix_key text, p_participants jsonb, p_owner_amount numeric,
  p_source_account_id uuid, p_source_credit_card_id uuid,
  p_reimbursement_account_id uuid, p_category_id uuid,
  p_register_transaction boolean, p_installments jsonb DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
  uid uuid := auth.uid();
  mapped jsonb := '{}'::jsonb;
  it jsonb;
  part record;
  idx int := 0;
BEGIN
  new_id := public.split_create_v2(
    p_title, p_total, p_occurred_at, p_due_date, p_split_mode, p_include_owner,
    p_reminder_enabled, p_pix_key, p_participants, p_owner_amount,
    p_source_account_id, p_source_credit_card_id, p_reimbursement_account_id,
    p_category_id, p_register_transaction);

  IF p_installments IS NOT NULL AND jsonb_typeof(p_installments) = 'array' THEN
    -- p_installments: [{ "participant_index": 0, "rows": [{amount, due_date}, ...] }]
    FOR it IN SELECT * FROM jsonb_array_elements(p_installments) LOOP
      SELECT * INTO part FROM public.shared_expense_participants
       WHERE shared_expense_id = new_id AND owner_user_id = uid AND phone_e164 IS NOT NULL
       ORDER BY created_at, id
       OFFSET coalesce((it->>'participant_index')::int, 0) LIMIT 1;
      IF part.id IS NOT NULL THEN
        mapped := mapped || jsonb_build_object(part.id::text, it->'rows');
      END IF;
    END LOOP;
  END IF;

  PERFORM public.split_apply_installments(new_id, mapped);
  RETURN new_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.split_create_v3(text,numeric,date,date,split_mode,boolean,boolean,text,jsonb,numeric,uuid,uuid,uuid,uuid,boolean,jsonb) FROM anon;

CREATE OR REPLACE FUNCTION public.split_update_v3(
  p_id uuid, p_title text, p_total numeric, p_occurred_at date, p_due_date date,
  p_split_mode split_mode, p_reminder_enabled boolean, p_pix_key text,
  p_participants jsonb, p_source_account_id uuid, p_source_credit_card_id uuid,
  p_reimbursement_account_id uuid, p_category_id uuid,
  p_register_transaction boolean, p_installments jsonb DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  mapped jsonb := '{}'::jsonb;
  it jsonb;
  pid uuid;
BEGIN
  PERFORM public.split_update(
    p_id, p_title, p_total, p_occurred_at, p_due_date, p_split_mode,
    p_reminder_enabled, p_pix_key, p_participants, p_source_account_id,
    p_source_credit_card_id, p_reimbursement_account_id, p_category_id,
    p_register_transaction);

  IF p_installments IS NOT NULL AND jsonb_typeof(p_installments) = 'object' THEN
    mapped := p_installments; -- { "<participant_id>": [{amount, due_date}] }
  END IF;

  PERFORM public.split_apply_installments(p_id, mapped);

  INSERT INTO public.shared_expense_events(shared_expense_id, owner_user_id, event_type, payload)
  VALUES (p_id, uid, 'installments_updated', jsonb_build_object('participants', mapped));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.split_update_v3(uuid,text,numeric,date,date,split_mode,boolean,text,jsonb,uuid,uuid,uuid,uuid,boolean,jsonb) FROM anon;

-- Cancelamento da divisão também encerra parcelas em aberto
CREATE OR REPLACE FUNCTION public.split_cancel_open_installments(p_expense_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE uid uuid := auth.uid(); inst record;
BEGIN
  FOR inst IN SELECT id FROM public.shared_expense_installments
    WHERE shared_expense_id = p_expense_id AND owner_user_id = uid
      AND paid_amount = 0 AND status <> 'cancelled'
  LOOP
    PERFORM public.split_cancel_installment(inst.id, coalesce(p_reason, 'split_cancelled'));
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.split_cancel_open_installments(uuid,text) FROM anon;

-- =====================================================================
-- 5) Resumo canônico (Home / Nino)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.split_summary()
RETURNS TABLE(total_received numeric, total_pending numeric, pending_people bigint, active_splits bigint)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(sum(r.received_receivable) FILTER (WHERE r.phone_e164 IS NOT NULL), 0),
         coalesce(sum(r.expected_receivable) FILTER (WHERE r.phone_e164 IS NOT NULL), 0),
         count(DISTINCT r.participant_id) FILTER (WHERE r.phone_e164 IS NOT NULL AND r.expected_receivable > 0),
         count(DISTINCT r.shared_expense_id) FILTER (WHERE r.split_status = 'active')
    FROM public.split_receivables_v1 r
   WHERE r.owner_user_id = auth.uid()
     AND r.split_status <> 'cancelled'
     AND r.deleted_at IS NULL
     AND r.settlement_status <> 'cancelled';
$$;

CREATE OR REPLACE FUNCTION public.split_receivables_agenda(
  p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE(
  installment_id uuid, shared_expense_id uuid, title text, participant_name text,
  installment_number integer, total_installments integer, amount numeric,
  paid_amount numeric, balance_due numeric, due_date date, state text)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.installment_id, r.shared_expense_id, r.title, r.participant_name,
         r.installment_number, r.total_installments, r.amount,
         r.paid_amount, r.balance_due, r.due_date, r.state
    FROM public.split_receivables_v1 r
   WHERE r.owner_user_id = auth.uid()
     AND r.deleted_at IS NULL
     AND r.split_status <> 'cancelled'
     AND r.settlement_status <> 'cancelled'
     AND (p_from IS NULL OR r.due_date >= p_from)
     AND (p_to IS NULL OR r.due_date <= p_to)
   ORDER BY r.due_date NULLS LAST, r.participant_name, r.installment_number;
$$;
REVOKE EXECUTE ON FUNCTION public.split_receivables_agenda(date,date) FROM anon;
