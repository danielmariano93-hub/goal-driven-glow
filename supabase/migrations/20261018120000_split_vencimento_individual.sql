-- Divisão do Rolê: vencimento individual por integrante.
-- A cobrança já nasce de `shared_expense_installments` (cada parcela com a sua data) e os lembretes/mensagens leem essa data
-- (split_receivables_v1 → schedule_split_due_reminders / dispatch). Faltava só guardar a data escolhida para cada pessoa e usá-la
-- ao gerar as parcelas. `due_date` do integrante é opcional: vazio = herda o vencimento geral da divisão.
alter table public.shared_expense_participants add column if not exists due_date date;
comment on column public.shared_expense_participants.due_date is 'Vencimento individual (opcional). Vazio = vencimento geral da divisão.';

-- 1) criação: grava a data de cada integrante
create or replace function public.split_create_v2(p_title text, p_total numeric, p_occurred_at date, p_due_date date, p_split_mode split_mode, p_include_owner boolean, p_reminder_enabled boolean, p_pix_key text, p_participants jsonb, p_owner_amount numeric DEFAULT NULL::numeric, p_source_account_id uuid DEFAULT NULL::uuid, p_source_credit_card_id uuid DEFAULT NULL::uuid, p_reimbursement_account_id uuid DEFAULT NULL::uuid, p_category_id uuid DEFAULT NULL::uuid, p_register_transaction boolean DEFAULT true)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
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
      shared_expense_id, owner_user_id, name, phone_e164, phone_masked, amount_due, opt_out_token, due_date
    ) VALUES (
      new_id, uid, btrim(coalesce(it->>'name', 'Participante')), nullif(it->>'phone_e164', ''),
      CASE WHEN nullif(it->>'phone_e164', '') IS NOT NULL THEN regexp_replace(it->>'phone_e164', '^(\+\d{2})\d+(\d{4})$', '\1****\2') END,
      CASE WHEN p_split_mode = 'equal' THEN (base_cents + extra)::numeric / 100 ELSE coalesce((it->>'amount_due')::numeric, 0) END,
      public.split_token(),
      nullif(it->>'due_date', '')::date
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
END $function$;

-- 2) edição: grava/atualiza a data de cada integrante (cliente antigo, sem a chave, mantém o que já estava).
--    Também corrige um defeito antigo: o UPDATE do status comparava texto com enum (erro 42804), então editar uma divisão com pessoas
--    já cadastradas falhava sempre (nenhum evento 'updated' existia). E preserva estados como 'notified'/'payment_reported' em vez de voltar a 'pending'.
create or replace function public.split_update(p_id uuid, p_title text, p_total numeric, p_occurred_at date, p_due_date date, p_split_mode split_mode, p_reminder_enabled boolean, p_pix_key text, p_participants jsonb, p_source_account_id uuid, p_source_credit_card_id uuid, p_reimbursement_account_id uuid, p_category_id uuid, p_register_transaction boolean DEFAULT true)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
      INSERT INTO public.shared_expense_participants(shared_expense_id, owner_user_id, name, phone_e164, phone_masked, amount_due, opt_out_token, due_date)
      VALUES (
        p_id, uid, btrim(it->>'name'), nullif(it->>'phone_e164', ''),
        CASE WHEN nullif(it->>'phone_e164', '') IS NOT NULL THEN regexp_replace(it->>'phone_e164', '^(\+\d{2})\d+(\d{4})$', '\1****\2') END,
        due, public.split_token(), nullif(it->>'due_date', '')::date
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
             due_date = CASE WHEN jsonb_exists(it, 'due_date') THEN nullif(it->>'due_date', '')::date ELSE due_date END,
             status = CASE WHEN amount_paid >= due THEN 'paid'::participant_status WHEN amount_paid > 0 THEN 'partial'::participant_status ELSE status END,
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
END $function$;

-- 3) geração de parcelas: a data da pessoa vale mais que a data geral da divisão
create or replace function public.split_apply_installments(p_expense_id uuid, p_installments jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  uid uuid := auth.uid();
  part record; it jsonb; rows jsonb; n int; idx int;
  sum_cents bigint; due_cents bigint; base bigint; rem bigint; extra int;
  v_amount numeric; v_due date; v_first date; se record;
  locked_cents bigint;
  v_default_due date;
BEGIN
  SELECT * INTO se FROM public.shared_expenses WHERE id = p_expense_id AND owner_user_id = uid;
  IF se.id IS NULL THEN RAISE EXCEPTION 'Divisão não encontrada'; END IF;

  FOR part IN SELECT * FROM public.shared_expense_participants
    WHERE shared_expense_id = p_expense_id AND owner_user_id = uid
  LOOP
    rows := coalesce(p_installments -> part.id::text, NULL);
    due_cents := round(coalesce(part.amount_due, 0) * 100)::bigint;
    -- vencimento individual > vencimento geral
    v_default_due := coalesce(part.due_date, se.due_date);

    -- Parcelas já pagas/parciais são imutáveis
    SELECT coalesce(sum(round(paid_amount * 100)::bigint), 0) INTO locked_cents
      FROM public.shared_expense_installments
     WHERE participant_id = part.id AND paid_amount > 0;

    IF rows IS NULL OR jsonb_typeof(rows) <> 'array' OR jsonb_array_length(rows) = 0 THEN
      -- À vista: uma parcela com o vencimento da pessoa (ou o da divisão)
      IF EXISTS (SELECT 1 FROM public.shared_expense_installments
                  WHERE participant_id = part.id AND paid_amount > 0) THEN
        UPDATE public.shared_expense_installments
           SET amount = part.amount_due, due_date = v_default_due, total_installments = 1, updated_at = now()
         WHERE participant_id = part.id AND paid_amount = 0 AND status <> 'cancelled'
           AND installment_number = 1;
      ELSE
        DELETE FROM public.shared_expense_installments
         WHERE participant_id = part.id AND paid_amount = 0;
        INSERT INTO public.shared_expense_installments(
          shared_expense_id, participant_id, owner_user_id, installment_number,
          total_installments, amount, due_date)
        VALUES (p_expense_id, part.id, uid, 1, 1, coalesce(part.amount_due, 0), v_default_due)
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
      VALUES (p_expense_id, part.id, uid, idx, n, v_amount, coalesce(v_due, v_default_due))
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
$function$;
