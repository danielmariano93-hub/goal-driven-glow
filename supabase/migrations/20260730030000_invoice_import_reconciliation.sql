-- Fatura de cartão: metadados, classificação e trava de conciliação.
-- Nenhuma linha legada é reclassificada automaticamente.

ALTER TABLE public.document_imports
  ADD COLUMN IF NOT EXISTS invoice_total numeric(14,2),
  ADD COLUMN IF NOT EXISTS invoice_due_date date,
  ADD COLUMN IF NOT EXISTS invoice_closing_date date,
  ADD COLUMN IF NOT EXISTS invoice_competence_month date,
  ADD COLUMN IF NOT EXISTS invoice_card_last4 text;

ALTER TABLE public.extracted_items
  ADD COLUMN IF NOT EXISTS statement_item_kind text,
  ADD COLUMN IF NOT EXISTS installment_inferred boolean NOT NULL DEFAULT false;

ALTER TABLE public.extracted_items
  DROP CONSTRAINT IF EXISTS extracted_items_statement_item_kind_check;
ALTER TABLE public.extracted_items
  ADD CONSTRAINT extracted_items_statement_item_kind_check
  CHECK (
    statement_item_kind IS NULL OR statement_item_kind IN
      ('purchase','installment','refund','interest','fee','payment','adjustment','informational')
  ) NOT VALID;

ALTER TABLE public.credit_card_statement_items
  ADD COLUMN IF NOT EXISTS source_extracted_item_id uuid
    REFERENCES public.extracted_items(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS credit_card_statement_items_source_item_unique
  ON public.credit_card_statement_items(source_extracted_item_id)
  WHERE source_extracted_item_id IS NOT NULL;

ALTER TABLE public.credit_card_statement_items
  DROP CONSTRAINT IF EXISTS credit_card_statement_items_item_kind_check;
ALTER TABLE public.credit_card_statement_items
  ADD CONSTRAINT credit_card_statement_items_item_kind_check
  CHECK (item_kind IN ('purchase','installment','refund','interest','fee','payment','adjustment')) NOT VALID;

CREATE OR REPLACE FUNCTION public.validate_invoice_import(
  p_document_id uuid,
  p_item_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_doc public.document_imports%ROWTYPE;
  v_calculated numeric(14,2);
  v_difference numeric(14,2);
  v_missing_card integer;
  v_invalid_installments integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_doc
    FROM public.document_imports
   WHERE id = p_document_id AND user_id = v_user;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'document_not_found');
  END IF;
  IF coalesce(v_doc.document_kind, '') <> 'invoice' THEN
    RETURN jsonb_build_object('ok', true, 'not_invoice', true);
  END IF;
  IF v_doc.invoice_total IS NULL OR v_doc.invoice_total < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_invoice_total');
  END IF;

  SELECT
    count(*) FILTER (WHERE coalesce(credit_card_id, v_doc.source_credit_card_id) IS NULL),
    count(*) FILTER (
      WHERE installments_total IS NOT NULL
        AND (installment_number IS NULL OR installment_number < 1 OR installment_number > installments_total)
    ),
    round(coalesce(sum(
      CASE
        WHEN coalesce(statement_item_kind, 'purchase') IN ('informational') THEN 0
        WHEN coalesce(statement_item_kind, 'purchase') IN ('refund','payment') THEN -abs(amount)
        ELSE abs(amount)
      END
    ), 0), 2)
  INTO v_missing_card, v_invalid_installments, v_calculated
  FROM public.extracted_items
  WHERE document_id = p_document_id
    AND user_id = v_user
    AND id = ANY(p_item_ids)
    AND status NOT IN ('ignored','rejected','failed','rolled_back');

  IF v_missing_card > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_credit_card', 'count', v_missing_card);
  END IF;
  IF v_invalid_installments > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_installments', 'count', v_invalid_installments);
  END IF;

  v_difference := round(v_doc.invoice_total - v_calculated, 2);
  IF abs(v_difference) > 0.05 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'invoice_total_mismatch',
      'stated_total', v_doc.invoice_total,
      'calculated_total', v_calculated,
      'difference', v_difference,
      'tolerance', 0.05
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'stated_total', v_doc.invoice_total,
    'calculated_total', v_calculated,
    'difference', v_difference
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_invoice_import(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_invoice_import(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_invoice_import(uuid, uuid[]) TO service_role;

COMMENT ON FUNCTION public.validate_invoice_import(uuid, uuid[]) IS
  'Bloqueia confirmação de fatura sem cartão, parcelamento válido e conciliação do total oficial (tolerância R$0,05).';

CREATE OR REPLACE FUNCTION public.finalize_invoice_statement(
  p_document_id uuid,
  p_item_ids uuid[]
) RETURNS jsonb
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
  v_reconciled numeric(14,2);
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

  v_competence := coalesce(
    date_trunc('month', v_doc.invoice_competence_month)::date,
    date_trunc('month', v_doc.invoice_due_date)::date,
    date_trunc('month', v_doc.period_end)::date,
    date_trunc('month', current_date)::date
  );
  v_due := coalesce(v_doc.invoice_due_date, v_competence);

  INSERT INTO public.credit_card_statements(
    user_id, credit_card_id, competence_month, due_date,
    stated_total, reconciled_total, status, source_document_id
  ) VALUES (
    v_user, v_card, v_competence, v_due,
    coalesce(v_doc.invoice_total, 0), 0, 'needs_review', p_document_id
  )
  ON CONFLICT (credit_card_id, competence_month) DO UPDATE SET
    due_date = excluded.due_date,
    stated_total = excluded.stated_total,
    source_document_id = excluded.source_document_id,
    updated_at = now()
  RETURNING id INTO v_statement;

  -- Move para a fatura importada os itens criados pelo trigger legado.
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
     AND si.legacy_transaction_id = tx.id;

  -- Estornos não passam pelo trigger de compras; pagamentos da fatura não são
  -- nova transação. Ambos entram no demonstrativo com sinal negativo.
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
    AND ei.statement_item_kind IN ('refund','payment')
  ON CONFLICT (source_extracted_item_id) WHERE source_extracted_item_id IS NOT NULL
  DO UPDATE SET
    statement_id = excluded.statement_id,
    item_kind = excluded.item_kind,
    description = excluded.description,
    amount = excluded.amount,
    occurred_at = excluded.occurred_at;

  SELECT round(coalesce(sum(amount), 0), 2) INTO v_reconciled
    FROM public.credit_card_statement_items WHERE statement_id = v_statement;
  UPDATE public.credit_card_statements
     SET stated_total = coalesce(v_doc.invoice_total, 0),
         reconciled_total = v_reconciled,
         status = CASE
           WHEN abs(coalesce(v_doc.invoice_total, 0) - v_reconciled) <= 0.05 THEN 'open'
           ELSE 'needs_review'
         END,
         updated_at = now()
   WHERE id = v_statement;

  RETURN jsonb_build_object(
    'ok', abs(coalesce(v_doc.invoice_total, 0) - v_reconciled) <= 0.05,
    'statement_id', v_statement,
    'stated_total', v_doc.invoice_total,
    'reconciled_total', v_reconciled,
    'difference', round(coalesce(v_doc.invoice_total, 0) - v_reconciled, 2)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_invoice_statement(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_invoice_statement(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_invoice_statement(uuid, uuid[]) TO service_role;

NOTIFY pgrst, 'reload schema';
