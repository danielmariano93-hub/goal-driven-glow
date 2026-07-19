-- Correção definitiva do vínculo financeiro da Divisão do Rolê

CREATE OR REPLACE FUNCTION public.split_upsert_original_transaction(p_expense_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  se record;
  tx_id uuid;
  competence date;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sessão expirada';
  END IF;

  SELECT * INTO se
    FROM public.shared_expenses
   WHERE id = p_expense_id AND owner_user_id = uid
   FOR UPDATE;

  IF se.id IS NULL THEN
    RAISE EXCEPTION 'Divisão não encontrada';
  END IF;

  IF se.source_account_id IS NULL AND se.source_credit_card_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF se.source_credit_card_id IS NOT NULL THEN
    SELECT public.credit_card_competence(closing_day, se.occurred_at)
      INTO competence
      FROM public.credit_cards
     WHERE id = se.source_credit_card_id AND user_id = uid;
  END IF;

  SELECT t.id INTO tx_id
    FROM public.transactions t
   WHERE t.user_id = uid
     AND t.split_transaction_role = 'original_expense'
     AND (t.id = se.linked_transaction_id OR t.shared_expense_id = se.id)
   ORDER BY CASE WHEN t.id = se.linked_transaction_id THEN 0 ELSE 1 END
   LIMIT 1
   FOR UPDATE;

  IF tx_id IS NULL THEN
    INSERT INTO public.transactions(
      user_id, account_id, category_id, type, status, amount, occurred_at,
      description, notes, payment_method, credit_card_id, purchase_date,
      competence_date, movement_kind, shared_expense_id, split_transaction_role
    ) VALUES (
      uid, se.source_account_id, se.category_id, 'expense', 'confirmed', se.total_amount, se.occurred_at,
      se.title, 'Criado pela Divisão do Rolê',
      CASE WHEN se.source_credit_card_id IS NULL THEN 'account' ELSE 'credit_card' END,
      se.source_credit_card_id,
      CASE WHEN se.source_credit_card_id IS NOT NULL THEN se.occurred_at END,
      competence, 'transaction', se.id, 'original_expense'
    ) RETURNING id INTO tx_id;
  ELSE
    UPDATE public.transactions
       SET account_id = se.source_account_id,
           credit_card_id = se.source_credit_card_id,
           payment_method = CASE WHEN se.source_credit_card_id IS NULL THEN 'account' ELSE 'credit_card' END,
           category_id = se.category_id,
           amount = se.total_amount,
           occurred_at = se.occurred_at,
           purchase_date = CASE WHEN se.source_credit_card_id IS NOT NULL THEN se.occurred_at END,
           competence_date = competence,
           description = se.title,
           notes = 'Criado pela Divisão do Rolê',
           movement_kind = 'transaction',
           shared_expense_id = se.id,
           split_transaction_role = 'original_expense',
           updated_at = now()
     WHERE id = tx_id AND user_id = uid;
  END IF;

  UPDATE public.shared_expenses
     SET linked_transaction_id = tx_id,
         updated_at = now()
   WHERE id = se.id
     AND linked_transaction_id IS DISTINCT FROM tx_id;

  RETURN tx_id;
END $$;

CREATE OR REPLACE FUNCTION public.split_create_v2(
  p_title text, p_total numeric, p_occurred_at date, p_due_date date,
  p_split_mode public.split_mode, p_include_owner boolean, p_reminder_enabled boolean,
  p_pix_key text, p_participants jsonb, p_owner_amount numeric DEFAULT NULL,
  p_source_account_id uuid DEFAULT NULL, p_source_credit_card_id uuid DEFAULT NULL,
  p_reimbursement_account_id uuid DEFAULT NULL, p_category_id uuid DEFAULT NULL,
  p_register_transaction boolean DEFAULT true
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  uid uuid := auth.uid();
  new_id uuid;
  n int;
  total_cents bigint;
  base_cents bigint;
  remainder bigint;
  sum_cents bigint := 0;
  owner_cents bigint := 0;
  extra int;
  it jsonb;
  owner_name text;
  participant_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada'; END IF;
  IF p_total IS NULL OR p_total <= 0 OR btrim(coalesce(p_title, '')) = '' THEN
    RAISE EXCEPTION 'Preencha título e valor';
  END IF;

  PERFORM public.split_assert_financial_source(uid, p_source_account_id, p_source_credit_card_id, p_category_id, p_reimbursement_account_id);
  IF p_source_account_id IS NULL AND p_source_credit_card_id IS NULL THEN
    RAISE EXCEPTION 'Escolha de onde saiu o pagamento';
  END IF;

  n := jsonb_array_length(coalesce(p_participants, '[]')) + CASE WHEN p_include_owner THEN 1 ELSE 0 END;
  IF n < 1 THEN RAISE EXCEPTION 'Inclua ao menos uma pessoa'; END IF;

  total_cents := round(p_total * 100)::bigint;
  IF p_split_mode = 'custom' THEN
    FOR it IN SELECT * FROM jsonb_array_elements(coalesce(p_participants, '[]')) LOOP
      sum_cents := sum_cents + round(coalesce((it->>'amount_due')::numeric, 0) * 100)::bigint;
    END LOOP;
    owner_cents := CASE WHEN p_include_owner THEN round(coalesce(p_owner_amount, 0) * 100)::bigint ELSE 0 END;
    IF sum_cents + owner_cents <> total_cents THEN
      RAISE EXCEPTION 'A soma das partes precisa ser igual ao total';
    END IF;
  END IF;

  INSERT INTO public.shared_expenses(
    owner_user_id, title, total_amount, occurred_at, due_date, split_mode,
    reminder_enabled, status, pix_key, source_account_id, source_credit_card_id,
    reimbursement_account_id, category_id
  ) VALUES (
    uid, btrim(p_title), p_total, coalesce(p_occurred_at, current_date), p_due_date, p_split_mode,
    coalesce(p_reminder_enabled, false), 'active', nullif(btrim(coalesce(p_pix_key, '')), ''),
    p_source_account_id, p_source_credit_card_id, p_reimbursement_account_id, p_category_id
  ) RETURNING id INTO new_id;

  base_cents := CASE WHEN p_split_mode = 'equal' THEN total_cents / n ELSE 0 END;
  remainder := CASE WHEN p_split_mode = 'equal' THEN total_cents - base_cents * n ELSE 0 END;

  IF p_include_owner THEN
    SELECT coalesce(display_name, 'Você') INTO owner_name FROM public.profiles WHERE id = uid;
    extra := CASE WHEN remainder > 0 THEN 1 ELSE 0 END;
    remainder := greatest(remainder - 1, 0);
    INSERT INTO public.shared_expense_participants(shared_expense_id, owner_user_id, name, amount_due, status, amount_paid, paid_at)
    VALUES (
      new_id, uid, coalesce(owner_name, 'Você'),
      CASE WHEN p_split_mode = 'equal' THEN (base_cents + extra)::numeric / 100 ELSE owner_cents::numeric / 100 END,
      'paid',
      CASE WHEN p_split_mode = 'equal' THEN (base_cents + extra)::numeric / 100 ELSE owner_cents::numeric / 100 END,
      now()
    );
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(coalesce(p_participants, '[]')) LOOP
    extra := CASE WHEN remainder > 0 THEN 1 ELSE 0 END;
    remainder := greatest(remainder - 1, 0);
    INSERT INTO public.shared_expense_participants(
      shared_expense_id, owner_user_id, name, phone_e164, phone_masked, amount_due, opt_out_token
    ) VALUES (
      new_id, uid, btrim(coalesce(it->>'name', 'Participante')), nullif(it->>'phone_e164', ''),
      CASE WHEN nullif(it->>'phone_e164', '') IS NOT NULL THEN regexp_replace(it->>'phone_e164', '^(\+\d{2})\d+(\d{4})$', '\1****\2') END,
      CASE WHEN p_split_mode = 'equal' THEN (base_cents + extra)::numeric / 100 ELSE coalesce((it->>'amount_due')::numeric, 0) END,
      public.split_token()
    ) RETURNING id INTO participant_id;

    IF nullif(it->>'phone_e164', '') IS NOT NULL THEN
      PERFORM public.split_enqueue_message(new_id, participant_id, 'invite', now());
    END IF;
  END LOOP;

  IF coalesce(p_register_transaction, true) THEN
    PERFORM public.split_upsert_original_transaction(new_id);
  END IF;

  INSERT INTO public.shared_expense_events(shared_expense_id, owner_user_id, event_type, payload)
  VALUES (new_id, uid, 'created', jsonb_build_object('total', p_total, 'mode', p_split_mode, 'transaction_registered', coalesce(p_register_transaction, true)));

  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION public.split_update(
  p_id uuid, p_title text, p_total numeric, p_occurred_at date, p_due_date date,
  p_split_mode public.split_mode, p_reminder_enabled boolean, p_pix_key text,
  p_participants jsonb, p_source_account_id uuid, p_source_credit_card_id uuid,
  p_reimbursement_account_id uuid, p_category_id uuid, p_register_transaction boolean DEFAULT true
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  se record;
  it jsonb;
  pid uuid;
  due numeric;
  sum_due numeric := 0;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada'; END IF;

  SELECT * INTO se
    FROM public.shared_expenses
   WHERE id = p_id AND owner_user_id = uid
   FOR UPDATE;

  IF se.id IS NULL THEN RAISE EXCEPTION 'Divisão não encontrada'; END IF;
  IF se.status = 'cancelled' THEN RAISE EXCEPTION 'Divisão cancelada'; END IF;

  PERFORM public.split_assert_financial_source(uid, p_source_account_id, p_source_credit_card_id, p_category_id, p_reimbursement_account_id);
  IF coalesce(p_register_transaction, true) AND p_source_account_id IS NULL AND p_source_credit_card_id IS NULL THEN
    RAISE EXCEPTION 'Escolha de onde saiu o pagamento';
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(coalesce(p_participants, '[]')) LOOP
    pid := nullif(it->>'id', '')::uuid;
    due := coalesce((it->>'amount_due')::numeric, 0);
    IF due < 0 THEN RAISE EXCEPTION 'Valor individual inválido'; END IF;
    IF pid IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.shared_expense_participants
       WHERE id = pid AND shared_expense_id = p_id AND owner_user_id = uid AND amount_paid > due
    ) THEN
      RAISE EXCEPTION 'Uma parte não pode ficar menor que o valor já recebido';
    END IF;
    sum_due := sum_due + due;
  END LOOP;

  IF round(sum_due * 100) <> round(p_total * 100) THEN
    RAISE EXCEPTION 'A soma das partes precisa ser igual ao total';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.shared_expense_participants x
     WHERE x.shared_expense_id = p_id AND x.owner_user_id = uid AND x.amount_paid > 0
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(coalesce(p_participants, '[]')) j
          WHERE nullif(j->>'id', '')::uuid = x.id
       )
  ) THEN
    RAISE EXCEPTION 'Não é possível remover alguém que já pagou';
  END IF;

  UPDATE public.shared_expenses
     SET title = btrim(p_title),
         total_amount = p_total,
         occurred_at = p_occurred_at,
         due_date = p_due_date,
         split_mode = p_split_mode,
         reminder_enabled = p_reminder_enabled,
         pix_key = nullif(btrim(coalesce(p_pix_key, '')), ''),
         source_account_id = p_source_account_id,
         source_credit_card_id = p_source_credit_card_id,
         reimbursement_account_id = p_reimbursement_account_id,
         category_id = p_category_id,
         updated_at = now()
   WHERE id = p_id;

  DELETE FROM public.shared_expense_participants x
   WHERE x.shared_expense_id = p_id
     AND x.owner_user_id = uid
     AND x.amount_paid = 0
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(coalesce(p_participants, '[]')) j
        WHERE nullif(j->>'id', '')::uuid = x.id
     );

  FOR it IN SELECT * FROM jsonb_array_elements(coalesce(p_participants, '[]')) LOOP
    pid := nullif(it->>'id', '')::uuid;
    due := coalesce((it->>'amount_due')::numeric, 0);
    IF pid IS NULL THEN
      INSERT INTO public.shared_expense_participants(shared_expense_id, owner_user_id, name, phone_e164, phone_masked, amount_due, opt_out_token)
      VALUES (
        p_id, uid, btrim(it->>'name'), nullif(it->>'phone_e164', ''),
        CASE WHEN nullif(it->>'phone_e164', '') IS NOT NULL THEN regexp_replace(it->>'phone_e164', '^(\+\d{2})\d+(\d{4})$', '\1****\2') END,
        due, public.split_token()
      ) RETURNING id INTO pid;

      IF nullif(it->>'phone_e164', '') IS NOT NULL THEN
        PERFORM public.split_enqueue_message(p_id, pid, 'invite', now());
      END IF;
    ELSE
      UPDATE public.shared_expense_participants
         SET name = btrim(it->>'name'),
             phone_e164 = nullif(it->>'phone_e164', ''),
             phone_masked = CASE WHEN nullif(it->>'phone_e164', '') IS NOT NULL THEN regexp_replace(it->>'phone_e164', '^(\+\d{2})\d+(\d{4})$', '\1****\2') END,
             amount_due = due,
             status = CASE WHEN amount_paid >= due THEN 'paid' WHEN amount_paid > 0 THEN 'partial' ELSE 'pending' END,
             updated_at = now()
       WHERE id = pid AND shared_expense_id = p_id AND owner_user_id = uid;
    END IF;
  END LOOP;

  IF coalesce(p_register_transaction, true) THEN
    PERFORM public.split_upsert_original_transaction(p_id);
  ELSE
    UPDATE public.shared_expenses SET linked_transaction_id = NULL WHERE id = p_id;
    DELETE FROM public.transactions WHERE user_id = uid AND shared_expense_id = p_id AND split_transaction_role = 'original_expense';
  END IF;

  INSERT INTO public.shared_expense_events(shared_expense_id, owner_user_id, event_type, payload)
  VALUES (p_id, uid, 'updated', jsonb_build_object('previous_total', se.total_amount, 'new_total', p_total, 'transaction_registered', coalesce(p_register_transaction, true)));
END $$;

CREATE OR REPLACE FUNCTION public.split_cancel(p_id uuid, p_reason text DEFAULT NULL, p_remove_transaction boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  se record;
  received numeric;
  tx_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada'; END IF;

  SELECT * INTO se
    FROM public.shared_expenses
   WHERE id = p_id AND owner_user_id = uid
   FOR UPDATE;

  IF se.id IS NULL THEN RAISE EXCEPTION 'Divisão não encontrada'; END IF;

  SELECT coalesce(sum(amount_paid), 0) INTO received
    FROM public.shared_expense_participants
   WHERE shared_expense_id = p_id AND owner_user_id = uid AND phone_e164 IS NOT NULL;

  IF p_remove_transaction AND received > 0 THEN
    RAISE EXCEPTION 'Há pagamentos recebidos; mantenha o lançamento para preservar o histórico';
  END IF;

  SELECT t.id INTO tx_id
    FROM public.transactions t
   WHERE t.user_id = uid
     AND t.split_transaction_role = 'original_expense'
     AND (t.id = se.linked_transaction_id OR t.shared_expense_id = p_id)
   ORDER BY CASE WHEN t.id = se.linked_transaction_id THEN 0 ELSE 1 END
   LIMIT 1;

  UPDATE public.shared_expenses
     SET status = 'cancelled',
         cancelled_at = now(),
         cancellation_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         linked_transaction_id = CASE WHEN p_remove_transaction THEN NULL ELSE linked_transaction_id END,
         updated_at = now()
   WHERE id = p_id;

  UPDATE public.reminder_jobs
     SET status = 'skipped',
         last_error = 'split_cancelled',
         lease_expires_at = NULL,
         updated_at = now()
   WHERE shared_expense_id = p_id
     AND status IN ('queued', 'processing');

  IF p_remove_transaction AND tx_id IS NOT NULL THEN
    DELETE FROM public.transactions
     WHERE id = tx_id
       AND user_id = uid
       AND split_transaction_role = 'original_expense';
  END IF;

  INSERT INTO public.shared_expense_events(shared_expense_id, owner_user_id, event_type, payload)
  VALUES (p_id, uid, 'cancelled', jsonb_build_object('reason', p_reason, 'transaction_removed', p_remove_transaction, 'transaction_id', tx_id));
END $$;

CREATE OR REPLACE FUNCTION public.split_send_reminders(p_shared_expense_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  se record;
  p record;
  n int := 0;
  cur_hour int;
  send_at timestamptz;
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

  cur_hour := EXTRACT(hour FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int;
  send_at := CASE
    WHEN cur_hour BETWEEN 8 AND 21 THEN now()
    ELSE ((date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + interval '8 hours') AT TIME ZONE 'America/Sao_Paulo')
         + CASE WHEN cur_hour >= 22 THEN interval '1 day' ELSE interval '0' END
  END;

  FOR p IN
    SELECT * FROM public.shared_expense_participants
     WHERE shared_expense_id = p_shared_expense_id
       AND owner_user_id = auth.uid()
       AND status IN ('pending', 'partial', 'notified')
       AND phone_e164 IS NOT NULL
       AND opt_out_at IS NULL
       AND (last_reminded_at IS NULL OR last_reminded_at < now() - interval '24 hours')
       AND reminder_count < 5
  LOOP
    job_id := public.split_enqueue_message(p_shared_expense_id, p.id, 'reminder', send_at);
    IF job_id IS NOT NULL THEN
      UPDATE public.shared_expense_participants
         SET last_reminded_at = now(),
             reminder_count = reminder_count + 1,
             status = CASE WHEN status = 'pending' THEN 'notified' ELSE status END,
             updated_at = now()
       WHERE id = p.id;
      n := n + 1;
    END IF;
  END LOOP;

  INSERT INTO public.shared_expense_events(shared_expense_id, owner_user_id, event_type, payload)
  VALUES (p_shared_expense_id, auth.uid(), 'reminders_scheduled', jsonb_build_object('count', n));

  RETURN n;
END $$;

DO $$
DECLARE
  r record;
  chosen_account_id uuid;
  tx_id uuid;
BEGIN
  FOR r IN
    SELECT se.*
      FROM public.shared_expenses se
     WHERE se.status <> 'cancelled'
       AND se.source_account_id IS NULL
       AND se.source_credit_card_id IS NULL
       AND se.linked_transaction_id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.transactions t
          WHERE t.user_id = se.owner_user_id
            AND t.shared_expense_id = se.id
            AND t.split_transaction_role = 'original_expense'
       )
       AND 1 = (
         SELECT count(*) FROM public.accounts a
          WHERE a.user_id = se.owner_user_id AND a.active
       )
  LOOP
    SELECT a.id INTO chosen_account_id
      FROM public.accounts a
     WHERE a.user_id = r.owner_user_id AND a.active
     ORDER BY a.created_at ASC
     LIMIT 1;

    UPDATE public.shared_expenses
       SET source_account_id = chosen_account_id,
           updated_at = now()
     WHERE id = r.id;

    INSERT INTO public.transactions(
      user_id, account_id, category_id, type, status, amount, occurred_at,
      description, notes, payment_method, movement_kind, shared_expense_id, split_transaction_role
    ) VALUES (
      r.owner_user_id, chosen_account_id, r.category_id, 'expense', 'confirmed', r.total_amount, r.occurred_at,
      r.title, 'Criado pela Divisão do Rolê', 'account', 'transaction', r.id, 'original_expense'
    ) RETURNING id INTO tx_id;

    UPDATE public.shared_expenses
       SET linked_transaction_id = tx_id,
           updated_at = now()
     WHERE id = r.id;

    INSERT INTO public.shared_expense_events(shared_expense_id, owner_user_id, event_type, payload)
    VALUES (r.id, r.owner_user_id, 'financial_link_repaired', jsonb_build_object('reason', 'single_active_account', 'transaction_recreated', true));
  END LOOP;
END $$;