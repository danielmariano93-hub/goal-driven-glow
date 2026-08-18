-- invoice_competence_truth.v1
-- Competência da fatura deixa de ser adivinhada pelo mês corrente: é derivada
-- do ciclo real do cartão a partir do período do documento, avança quando a
-- competência já pertence a outra fatura registrada e nunca sobrescreve fatura
-- paga/fechada de outro documento (causa do incidente 4cc99521).
CREATE OR REPLACE FUNCTION public.finalize_invoice_statement(p_document_id uuid, p_item_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_doc public.document_imports%ROWTYPE;
  v_card uuid;
  v_competence date;
  v_due date;
  v_statement uuid;
  v_activity numeric(14,2);
  v_reconciled numeric(14,2);
  v_payments numeric(14,2);
  v_financed numeric(14,2);
  v_closing_day smallint;
  v_due_day smallint;
  v_base date;
  v_closing date;
  v_month date;
  v_explicit boolean := false;
  v_existing record;
  v_guard int := 0;
  v_derived_competence date;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_doc FROM public.document_imports
   WHERE id = p_document_id AND user_id = v_user;
  IF NOT FOUND OR coalesce(v_doc.document_kind, '') <> 'invoice' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invoice_not_found');
  END IF;

  v_card := v_doc.source_credit_card_id;
  IF v_card IS NULL THEN
    SELECT credit_card_id INTO v_card
      FROM public.extracted_items
     WHERE document_id = p_document_id
       AND user_id = v_user
       AND id = ANY(p_item_ids)
       AND credit_card_id IS NOT NULL
     LIMIT 1;
  END IF;
  IF v_card IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'missing_credit_card'); END IF;

  SELECT closing_day, due_day INTO v_closing_day, v_due_day
    FROM public.credit_cards WHERE id = v_card AND user_id = v_user;

  IF v_doc.invoice_competence_month IS NOT NULL THEN
    v_competence := date_trunc('month', v_doc.invoice_competence_month)::date;
    v_due := coalesce(v_doc.invoice_due_date, v_competence);
    v_explicit := true;
  ELSIF v_doc.invoice_due_date IS NOT NULL THEN
    v_competence := date_trunc('month', v_doc.invoice_due_date)::date;
    v_due := v_doc.invoice_due_date;
    v_explicit := true;
  ELSE
    -- Ciclo do cartão: fechamento seguinte ao fim do período do documento e o
    -- vencimento correspondente definem a competência.
    v_base := coalesce(v_doc.period_end, current_date);
    IF v_closing_day IS NULL THEN
      v_closing := v_base;
    ELSE
      v_month := date_trunc('month', v_base)::date;
      v_closing := v_month + (least(v_closing_day, extract(day from (v_month + interval '1 month - 1 day'))::int) - 1);
      IF v_closing < v_base THEN
        v_month := (v_month + interval '1 month')::date;
        v_closing := v_month + (least(v_closing_day, extract(day from (v_month + interval '1 month - 1 day'))::int) - 1);
      END IF;
    END IF;
    v_month := date_trunc('month', v_closing)::date;
    IF v_due_day IS NOT NULL AND v_closing_day IS NOT NULL AND v_due_day <= v_closing_day THEN
      v_month := (v_month + interval '1 month')::date;
    END IF;
    IF v_due_day IS NULL THEN
      v_due := v_closing + 10;
    ELSE
      v_due := v_month + (least(v_due_day, extract(day from (v_month + interval '1 month - 1 day'))::int) - 1);
    END IF;
    v_competence := date_trunc('month', v_due)::date;
  END IF;

  v_derived_competence := v_competence;

  -- Competência ocupada por outra fatura já registrada não é reaproveitada.
  LOOP
    SELECT s.id, s.status, s.source_document_id, s.stated_total,
           exists(select 1 from public.credit_card_statement_items i where i.statement_id = s.id) as has_items
      INTO v_existing
      FROM public.credit_card_statements s
     WHERE s.credit_card_id = v_card AND s.competence_month = v_competence;

    IF v_existing.id IS NULL
       OR v_existing.source_document_id IS NOT DISTINCT FROM p_document_id
       OR NOT (v_existing.status IN ('paid','closed') OR v_existing.has_items) THEN
      EXIT;
    END IF;

    IF v_explicit THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'statement_already_settled',
        'competence_month', v_competence,
        'existing_statement_id', v_existing.id,
        'existing_status', v_existing.status,
        'existing_total', v_existing.stated_total,
        'suggested_competence_month', (v_competence + interval '1 month')::date
      );
    END IF;

    v_guard := v_guard + 1;
    IF v_guard > 12 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'statement_already_settled',
        'competence_month', v_competence,
        'existing_statement_id', v_existing.id,
        'existing_status', v_existing.status,
        'existing_total', v_existing.stated_total,
        'suggested_competence_month', NULL
      );
    END IF;

    v_competence := (v_competence + interval '1 month')::date;
    v_month := v_competence;
    IF v_due_day IS NULL THEN
      v_due := v_competence + 9;
    ELSE
      v_due := v_month + (least(v_due_day, extract(day from (v_month + interval '1 month - 1 day'))::int) - 1);
    END IF;
  END LOOP;

  INSERT INTO public.credit_card_statements(
    user_id, credit_card_id, competence_month, due_date,
    opening_balance, stated_total, reconciled_total, status, source_document_id
  ) VALUES (
    v_user, v_card, v_competence, v_due,
    coalesce(v_doc.invoice_previous_balance, 0),
    coalesce(v_doc.invoice_total, 0), 0, 'needs_review', p_document_id
  )
  ON CONFLICT (credit_card_id, competence_month) DO UPDATE SET
    due_date = excluded.due_date,
    opening_balance = excluded.opening_balance,
    stated_total = excluded.stated_total,
    source_document_id = excluded.source_document_id,
    updated_at = now()
  RETURNING id INTO v_statement;

  UPDATE public.credit_card_statement_items si
     SET statement_id = v_statement,
         item_kind = CASE
           WHEN ei.statement_item_kind IN ('purchase','installment','refund','interest','fee','adjustment')
             THEN ei.statement_item_kind
           ELSE si.item_kind
         END,
         amount = CASE WHEN ei.statement_item_kind = 'refund' THEN -abs(ei.amount) ELSE abs(ei.amount) END,
         source_extracted_item_id = ei.id
    FROM public.extracted_items ei
    JOIN public.transactions tx ON tx.id = ei.transaction_id
   WHERE ei.document_id = p_document_id
     AND ei.user_id = v_user
     AND ei.id = ANY(p_item_ids)
     AND ei.is_future_installment = false
     AND si.legacy_transaction_id = tx.id;

  INSERT INTO public.credit_card_statement_items(
    user_id, statement_id, legacy_transaction_id, source_extracted_item_id,
    item_kind, description, amount, occurred_at
  )
  SELECT
    v_user, v_statement, ei.transaction_id, ei.id,
    ei.statement_item_kind,
    coalesce(nullif(ei.description, ''), CASE WHEN ei.statement_item_kind='payment' THEN 'Pagamento da fatura' ELSE 'Estorno' END),
    -abs(ei.amount), ei.occurred_at
  FROM public.extracted_items ei
  WHERE ei.document_id = p_document_id
    AND ei.user_id = v_user
    AND ei.id = ANY(p_item_ids)
    AND ei.is_future_installment = false
    AND ei.statement_item_kind IN ('refund','payment')
  ON CONFLICT (source_extracted_item_id) WHERE source_extracted_item_id IS NOT NULL
  DO UPDATE SET
    statement_id = excluded.statement_id,
    item_kind = excluded.item_kind,
    description = excluded.description,
    amount = excluded.amount,
    occurred_at = excluded.occurred_at;

  SELECT round(coalesce(sum(amount), 0), 2) INTO v_activity
    FROM public.credit_card_statement_items WHERE statement_id = v_statement;

  SELECT round(coalesce(sum(abs(amount)), 0), 2) INTO v_payments
    FROM public.credit_card_statement_items
   WHERE statement_id = v_statement AND item_kind = 'payment';

  v_payments := coalesce(v_doc.invoice_payments_total, v_payments, 0);
  v_financed := round(coalesce(v_doc.invoice_previous_balance, 0) - v_payments, 2);
  v_reconciled := round(coalesce(v_doc.invoice_previous_balance, 0) + v_activity, 2);

  UPDATE public.credit_card_statements
     SET opening_balance = coalesce(v_doc.invoice_previous_balance, 0),
         stated_total = coalesce(v_doc.invoice_total, 0),
         reconciled_total = v_reconciled,
         payments_total = v_payments,
         financed_balance = v_financed,
         status = CASE
           WHEN abs(coalesce(v_doc.invoice_total, 0) - v_reconciled) <= 0.05 THEN 'open'
           ELSE 'needs_review'
         END,
         updated_at = now()
   WHERE id = v_statement;

  RETURN jsonb_build_object(
    'ok', abs(coalesce(v_doc.invoice_total, 0) - v_reconciled) <= 0.05,
    'statement_id', v_statement,
    'competence_month', v_competence,
    'derived_competence_month', v_derived_competence,
    'due_date', v_due,
    'stated_total', v_doc.invoice_total,
    'previous_balance', v_doc.invoice_previous_balance,
    'payments_total', v_payments,
    'financed_balance', v_financed,
    'activity_total', v_activity,
    'reconciled_total', v_reconciled,
    'difference', round(coalesce(v_doc.invoice_total, 0) - v_reconciled, 2)
  );
END;
$function$;