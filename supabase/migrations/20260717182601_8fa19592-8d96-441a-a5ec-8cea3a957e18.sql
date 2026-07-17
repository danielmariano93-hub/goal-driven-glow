CREATE OR REPLACE FUNCTION public.confirm_document_import(p_document_id uuid, p_item_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_doc public.document_imports%ROWTYPE;
  v_item public.extracted_items%ROWTYPE;
  v_group_id uuid;
  v_new_tx_id uuid;
  v_created jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_errors  jsonb := '[]'::jsonb;
  v_created_count int := 0;
  v_total_selected int := coalesce(array_length(p_item_ids, 1), 0);
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_doc FROM public.document_imports
    WHERE id = p_document_id AND user_id = v_user
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'document_not_found');
  END IF;

  IF v_doc.status IN ('canceled','expired') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'document_'||v_doc.status);
  END IF;

  FOR v_item IN
    SELECT * FROM public.extracted_items
     WHERE document_id = p_document_id
       AND user_id = v_user
       AND id = ANY(p_item_ids)
     ORDER BY idx ASC
     FOR UPDATE
  LOOP
    IF v_item.transaction_id IS NOT NULL THEN
      v_skipped := v_skipped || jsonb_build_object('item_id', v_item.id, 'reason', 'already_confirmed', 'transaction_id', v_item.transaction_id);
      CONTINUE;
    END IF;

    IF v_item.status = 'ignored' OR v_item.status = 'rejected' THEN
      v_skipped := v_skipped || jsonb_build_object('item_id', v_item.id, 'reason', 'status_'||v_item.status);
      CONTINUE;
    END IF;

    IF v_item.payment_method = 'account' AND v_item.account_id IS NULL THEN
      v_errors := v_errors || jsonb_build_object('item_id', v_item.id, 'error', 'missing_account_id');
      UPDATE public.extracted_items SET status = 'failed' WHERE id = v_item.id;
      CONTINUE;
    END IF;
    IF v_item.payment_method = 'credit_card' AND v_item.credit_card_id IS NULL THEN
      v_errors := v_errors || jsonb_build_object('item_id', v_item.id, 'error', 'missing_credit_card_id');
      UPDATE public.extracted_items SET status = 'failed' WHERE id = v_item.id;
      CONTINUE;
    END IF;
    IF v_item.payment_method IS NULL THEN
      IF v_item.account_id IS NOT NULL AND v_item.credit_card_id IS NULL THEN
        v_item.payment_method := 'account';
      ELSIF v_item.credit_card_id IS NOT NULL THEN
        v_item.payment_method := 'credit_card';
      ELSE
        v_errors := v_errors || jsonb_build_object('item_id', v_item.id, 'error', 'missing_payment_target');
        UPDATE public.extracted_items SET status = 'failed' WHERE id = v_item.id;
        CONTINUE;
      END IF;
    END IF;

    IF v_item.installments_total IS NOT NULL AND v_item.installments_total > 1 THEN
      SELECT purchase_group_id INTO v_group_id
        FROM public.transactions
        WHERE user_id = v_user
          AND credit_card_id = v_item.credit_card_id
          AND purchase_date = v_item.purchase_date
          AND installments_total = v_item.installments_total
          AND import_source_id LIKE 'document:'||p_document_id::text||':%'
        LIMIT 1;
      IF v_group_id IS NULL THEN
        v_group_id := gen_random_uuid();
      END IF;
    ELSE
      v_group_id := NULL;
    END IF;

    BEGIN
      INSERT INTO public.transactions(
        user_id, account_id, credit_card_id, category_id,
        type, status, amount, occurred_at, description,
        raw_description, bank_reference, dedupe_fingerprint,
        payment_method, installment_number, installments_total,
        purchase_date, competence_date, purchase_group_id,
        origin, import_source_id
      ) VALUES (
        v_user,
        CASE WHEN v_item.payment_method = 'account' THEN v_item.account_id ELSE NULL END,
        CASE WHEN v_item.payment_method = 'credit_card' THEN v_item.credit_card_id ELSE NULL END,
        v_item.category_id,
        v_item.type::transaction_type,
        'confirmed'::transaction_status,
        v_item.amount,
        v_item.occurred_at,
        v_item.description,
        v_item.raw_description,
        v_item.bank_reference,
        v_item.dedupe_fingerprint,
        v_item.payment_method,
        v_item.installment_number,
        v_item.installments_total,
        v_item.purchase_date,
        v_item.competence_date,
        v_group_id,
        'import'::txn_origin,
        'document:'||p_document_id::text||':'||v_item.idx::text
      )
      RETURNING id INTO v_new_tx_id;

      UPDATE public.extracted_items
         SET transaction_id = v_new_tx_id,
             status = 'confirmed'
       WHERE id = v_item.id;

      v_created := v_created || jsonb_build_object('item_id', v_item.id, 'transaction_id', v_new_tx_id);
      v_created_count := v_created_count + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('item_id', v_item.id, 'error', SQLERRM);
      UPDATE public.extracted_items SET status = 'failed' WHERE id = v_item.id;
    END;
  END LOOP;

  IF v_created_count = 0 THEN
    IF EXISTS (SELECT 1 FROM public.extracted_items WHERE document_id = p_document_id AND status IN ('needs_review','duplicate_suspect') AND transaction_id IS NULL) THEN
      NULL;
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.extracted_items WHERE document_id = p_document_id AND status IN ('needs_review','duplicate_suspect') AND transaction_id IS NULL) THEN
    UPDATE public.document_imports SET status = 'partially_confirmed' WHERE id = p_document_id;
  ELSE
    UPDATE public.document_imports SET status = 'confirmed' WHERE id = p_document_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'created', v_created,
    'skipped', v_skipped,
    'errors', v_errors,
    'created_count', v_created_count,
    'total_selected', v_total_selected
  );
END;
$function$;