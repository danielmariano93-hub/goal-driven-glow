-- Invoice review must be all-or-nothing. This migration also provides the
-- canonical, idempotent settlement operation used by the app and MCP agents.

CREATE OR REPLACE FUNCTION public.confirm_invoice_import_atomic(
  p_document_id uuid,
  p_item_ids uuid[],
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_doc public.document_imports%ROWTYPE;
  v_validation jsonb;
  v_confirmation jsonb := jsonb_build_object(
    'ok', true, 'created_count', 0, 'created', '[]'::jsonb,
    'skipped', '[]'::jsonb, 'errors', '[]'::jsonb
  );
  v_statement jsonb;
  v_transaction_ids uuid[];
  v_non_ledger_ids uuid[];
  v_pending integer;
  v_created integer := 0;
  v_idempotent integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_document_id IS NULL OR coalesce(array_length(p_item_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'missing_items' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_doc
    FROM public.document_imports
   WHERE id = p_document_id AND user_id = v_user
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_not_found' USING ERRCODE = 'P0002'; END IF;

  -- A repeated click/retry returns the original successful result.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT payload INTO v_statement
      FROM public.document_import_audit
     WHERE document_id = p_document_id
       AND user_id = v_user
       AND action = 'invoice_atomic_confirmed'
       AND payload->>'idempotency_key' = p_idempotency_key
     ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      RETURN coalesce(v_statement->'result', '{}'::jsonb)
        || jsonb_build_object('ok', true, 'idempotent', true);
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_item_ids) requested(id)
    LEFT JOIN public.extracted_items item
      ON item.id = requested.id AND item.document_id = p_document_id AND item.user_id = v_user
    WHERE item.id IS NULL
  ) THEN RAISE EXCEPTION 'item_outside_document' USING ERRCODE = '42501'; END IF;

  v_validation := public.validate_invoice_import(p_document_id, p_item_ids);
  IF NOT coalesce((v_validation->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'invoice_not_reconciled'
      USING ERRCODE = 'P0001', DETAIL = v_validation::text;
  END IF;

  SELECT
    coalesce(array_agg(id) FILTER (
      WHERE coalesce(statement_item_kind, 'purchase') NOT IN ('payment','informational')
    ), ARRAY[]::uuid[]),
    coalesce(array_agg(id) FILTER (
      WHERE coalesce(statement_item_kind, 'purchase') IN ('payment','informational')
    ), ARRAY[]::uuid[])
  INTO v_transaction_ids, v_non_ledger_ids
  FROM public.extracted_items
  WHERE document_id = p_document_id AND user_id = v_user AND id = ANY(p_item_ids);

  IF coalesce(array_length(v_transaction_ids, 1), 0) > 0 THEN
    v_confirmation := public.confirm_document_import(p_document_id, v_transaction_ids);
    IF NOT coalesce((v_confirmation->>'ok')::boolean, false)
       OR jsonb_array_length(coalesce(v_confirmation->'errors', '[]'::jsonb)) > 0 THEN
      RAISE EXCEPTION 'invoice_items_failed'
        USING ERRCODE = 'P0001', DETAIL = v_confirmation::text;
    END IF;
  END IF;

  IF coalesce(array_length(v_non_ledger_ids, 1), 0) > 0 THEN
    UPDATE public.extracted_items SET status = 'confirmed'
     WHERE document_id = p_document_id AND user_id = v_user
       AND id = ANY(v_non_ledger_ids);
  END IF;

  IF coalesce(v_doc.document_kind, '') = 'invoice' THEN
    v_statement := public.finalize_invoice_statement(p_document_id, p_item_ids);
    IF NOT coalesce((v_statement->>'ok')::boolean, false) THEN
      RAISE EXCEPTION 'invoice_statement_failed'
        USING ERRCODE = 'P0001', DETAIL = v_statement::text;
    END IF;
  END IF;

  SELECT count(*) INTO v_pending FROM public.extracted_items
   WHERE document_id = p_document_id AND user_id = v_user
     AND status IN ('needs_review','duplicate_suspect','failed');
  UPDATE public.document_imports
     SET status = CASE WHEN v_pending = 0 THEN 'confirmed' ELSE 'partially_confirmed' END,
         error = NULL, updated_at = now()
   WHERE id = p_document_id AND user_id = v_user;

  v_created := coalesce((v_confirmation->>'created_count')::integer, 0);
  SELECT count(*) INTO v_idempotent
    FROM jsonb_array_elements(coalesce(v_confirmation->'skipped', '[]'::jsonb)) row
   WHERE row->>'reason' IN ('already_confirmed','already_imported');

  v_statement := jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'created_count', v_created,
    'non_ledger_count', coalesce(array_length(v_non_ledger_ids, 1), 0),
    'idempotent_count', v_idempotent,
    'accounted_count', v_created + v_idempotent + coalesce(array_length(v_non_ledger_ids, 1), 0),
    'total_selected', array_length(p_item_ids, 1),
    'errors', '[]'::jsonb,
    'statement', v_statement,
    'remaining_count', v_pending
  );

  INSERT INTO public.document_import_audit(user_id, document_id, action, payload)
  VALUES (v_user, p_document_id, 'invoice_atomic_confirmed', jsonb_build_object(
    'idempotency_key', p_idempotency_key, 'item_ids', to_jsonb(p_item_ids), 'result', v_statement
  ));
  RETURN v_statement;
END $$;

REVOKE ALL ON FUNCTION public.confirm_invoice_import_atomic(uuid,uuid[],text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_invoice_import_atomic(uuid,uuid[],text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.settle_credit_card_statement(
  p_statement_id uuid,
  p_account_id uuid,
  p_amount numeric DEFAULT NULL,
  p_paid_at date DEFAULT current_date,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_statement public.credit_card_statements%ROWTYPE;
  v_amount numeric(14,2);
  v_payment uuid;
  v_transaction uuid;
  v_new_paid numeric(14,2);
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_statement FROM public.credit_card_statements
   WHERE id = p_statement_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'statement_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_statement.status IN ('cancelled','refinanced') THEN
    RAISE EXCEPTION 'statement_not_payable' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id=p_account_id AND user_id=v_user AND active) THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, transaction_id INTO v_payment, v_transaction
      FROM public.credit_card_payments
     WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
    IF FOUND THEN RETURN jsonb_build_object('ok',true,'idempotent',true,'payment_id',v_payment,'transaction_id',v_transaction); END IF;
  END IF;

  v_amount := round(coalesce(p_amount, v_statement.outstanding_amount), 2);
  IF v_amount <= 0 OR v_amount > v_statement.outstanding_amount + 0.005 THEN
    RAISE EXCEPTION 'invalid_payment_amount' USING ERRCODE = '22023';
  END IF;

  -- Cash decreases, liability decreases. It is deliberately not consumption.
  INSERT INTO public.transactions(
    user_id, account_id, type, status, amount, occurred_at, description,
    payment_method, movement_kind, settles_card_id, origin
  ) VALUES (
    v_user, p_account_id, 'expense', 'confirmed', v_amount, coalesce(p_paid_at,current_date),
    'Pagamento de fatura do cartão', 'account', 'card_payment', v_statement.credit_card_id, 'manual'
  ) RETURNING id INTO v_transaction;

  INSERT INTO public.credit_card_payments(
    user_id, credit_card_id, account_id, paid_at, amount, transaction_id, idempotency_key
  ) VALUES (
    v_user, v_statement.credit_card_id, p_account_id, coalesce(p_paid_at,current_date),
    v_amount, v_transaction, p_idempotency_key
  ) RETURNING id INTO v_payment;
  INSERT INTO public.credit_card_payment_allocations(user_id,payment_id,statement_id,amount)
  VALUES (v_user,v_payment,p_statement_id,v_amount);

  v_new_paid := round(v_statement.paid_amount + v_amount, 2);
  UPDATE public.credit_card_statements
     SET paid_amount=v_new_paid,
         status=CASE WHEN v_new_paid >= stated_total-0.005 THEN 'paid' ELSE 'partially_paid' END,
         updated_at=now()
   WHERE id=p_statement_id;

  UPDATE public.credit_card_installments i SET
    status=CASE WHEN v_new_paid >= v_statement.stated_total-0.005 THEN 'paid' ELSE i.status END,
    updated_at=now()
  FROM public.credit_card_statement_items si
  WHERE si.statement_id=p_statement_id AND si.installment_id=i.id
    AND i.user_id=v_user AND i.status IN ('billed','overdue','scheduled');

  RETURN jsonb_build_object(
    'ok',true,'idempotent',false,'payment_id',v_payment,'transaction_id',v_transaction,
    'amount',v_amount,'paid_amount',v_new_paid,
    'outstanding_amount',greatest(0,v_statement.stated_total-v_new_paid),
    'status',CASE WHEN v_new_paid >= v_statement.stated_total-0.005 THEN 'paid' ELSE 'partially_paid' END
  );
END $$;

REVOKE ALL ON FUNCTION public.settle_credit_card_statement(uuid,uuid,numeric,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_credit_card_statement(uuid,uuid,numeric,date,text) TO authenticated, service_role;

-- Expose overdue as state, not as a client-side guess only.
UPDATE public.credit_card_statements SET status='overdue', updated_at=now()
 WHERE due_date < current_date AND outstanding_amount > 0 AND status IN ('open','partially_paid');

NOTIFY pgrst, 'reload schema';
