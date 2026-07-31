-- Resumo oficial da fatura + auditoria de cobertura em 3 camadas.
ALTER TABLE public.document_imports
  ADD COLUMN IF NOT EXISTS invoice_payments_total numeric(14,2),
  ADD COLUMN IF NOT EXISTS invoice_current_charges_total numeric(14,2),
  ADD COLUMN IF NOT EXISTS invoice_domestic_total numeric(14,2),
  ADD COLUMN IF NOT EXISTS invoice_international_total numeric(14,2),
  ADD COLUMN IF NOT EXISTS invoice_taxes_total numeric(14,2),
  ADD COLUMN IF NOT EXISTS invoice_credits_total numeric(14,2),
  ADD COLUMN IF NOT EXISTS invoice_financed_balance numeric(14,2),
  ADD COLUMN IF NOT EXISTS invoice_summary_source text,
  ADD COLUMN IF NOT EXISTS invoice_coverage jsonb;

DO $$ BEGIN
  ALTER TABLE public.document_imports
    ADD CONSTRAINT document_imports_invoice_summary_source_check
    CHECK (invoice_summary_source IS NULL OR invoice_summary_source IN ('parser','llm','manual','legacy'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.document_imports.invoice_payments_total IS
  'Total oficial de pagamentos/antecipacoes do ciclo. Liquida obrigacao, nunca vira despesa.';
COMMENT ON COLUMN public.document_imports.invoice_financed_balance IS
  'Saldo financiado derivado (anterior - pagamentos). Apenas conciliacao.';
COMMENT ON COLUMN public.document_imports.invoice_coverage IS
  'Auditoria por secao: soma extraida, subtotal oficial e diferenca.';

ALTER TABLE public.extracted_items
  ADD COLUMN IF NOT EXISTS statement_section text,
  ADD COLUMN IF NOT EXISTS is_future_installment boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE public.extracted_items
    ADD CONSTRAINT extracted_items_statement_section_check
    CHECK (statement_section IS NULL OR statement_section IN
      ('payments','domestic','international','taxes','credits','future_installments','other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS extracted_items_document_section_idx
  ON public.extracted_items(document_id, statement_section);

ALTER TABLE public.credit_card_statements
  ADD COLUMN IF NOT EXISTS payments_total numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS financed_balance numeric(14,2) NOT NULL DEFAULT 0;

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
  v_activity numeric(14,2);
  v_calculated numeric(14,2);
  v_difference numeric(14,2);
  v_missing_card integer;
  v_invalid_installments integer;
  v_sections jsonb := '[]'::jsonb;
  v_gap_section text := NULL;
  v_gap_amount numeric(14,2) := 0;
  r record;
  v_extracted numeric(14,2);
  v_official numeric(14,2);
  v_diff numeric(14,2);
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
        WHEN coalesce(statement_item_kind, 'purchase') = 'informational' THEN 0
        WHEN coalesce(statement_item_kind, 'purchase') IN ('refund','payment') THEN -abs(amount)
        ELSE abs(amount)
      END
    ), 0), 2)
  INTO v_missing_card, v_invalid_installments, v_activity
  FROM public.extracted_items
  WHERE document_id = p_document_id
    AND user_id = v_user
    AND id = ANY(p_item_ids)
    AND is_future_installment = false
    AND status NOT IN ('ignored','rejected','failed','rolled_back');

  IF v_missing_card > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_credit_card', 'count', v_missing_card);
  END IF;
  IF v_invalid_installments > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_installments', 'count', v_invalid_installments);
  END IF;

  -- Camada 1 e 2: soma das linhas por secao contra o subtotal oficial daquela secao.
  FOR r IN
    SELECT * FROM (VALUES
      ('payments',      v_doc.invoice_payments_total),
      ('domestic',      v_doc.invoice_domestic_total),
      ('international', v_doc.invoice_international_total),
      ('taxes',         v_doc.invoice_taxes_total),
      ('credits',       v_doc.invoice_credits_total)
    ) AS s(section, official)
  LOOP
    IF r.official IS NULL THEN CONTINUE; END IF;
    SELECT round(coalesce(sum(abs(amount)), 0), 2) INTO v_extracted
      FROM public.extracted_items
     WHERE document_id = p_document_id
       AND user_id = v_user
       AND id = ANY(p_item_ids)
       AND statement_section = r.section
       AND coalesce(statement_item_kind, 'purchase') <> 'informational'
       AND status NOT IN ('ignored','rejected','failed','rolled_back');
    v_official := round(abs(r.official), 2);
    v_diff := round(v_official - v_extracted, 2);
    v_sections := v_sections || jsonb_build_object(
      'section', r.section,
      'official_total', v_official,
      'extracted_total', v_extracted,
      'difference', v_diff,
      'covered', abs(v_diff) <= 0.05
    );
    IF abs(v_diff) > 0.05 AND abs(v_diff) > abs(v_gap_amount) THEN
      v_gap_section := r.section;
      v_gap_amount := v_diff;
    END IF;
  END LOOP;

  -- Camada 3: saldo anterior + atividade do ciclo = total oficial.
  v_calculated := round(coalesce(v_doc.invoice_previous_balance, 0) + v_activity, 2);
  v_difference := round(v_doc.invoice_total - v_calculated, 2);

  IF abs(v_difference) > 0.05 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'invoice_total_mismatch',
      'stated_total', v_doc.invoice_total,
      'previous_balance', v_doc.invoice_previous_balance,
      'payments_total', v_doc.invoice_payments_total,
      'current_charges_total', v_doc.invoice_current_charges_total,
      'activity_total', v_activity,
      'calculated_total', v_calculated,
      'difference', v_difference,
      'sections', v_sections,
      'gap_section', v_gap_section,
      'gap_amount', v_gap_amount,
      'tolerance', 0.05
    );
  END IF;

  IF v_gap_section IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'section_coverage_gap',
      'stated_total', v_doc.invoice_total,
      'previous_balance', v_doc.invoice_previous_balance,
      'activity_total', v_activity,
      'calculated_total', v_calculated,
      'difference', v_difference,
      'sections', v_sections,
      'gap_section', v_gap_section,
      'gap_amount', v_gap_amount,
      'tolerance', 0.05
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'stated_total', v_doc.invoice_total,
    'previous_balance', v_doc.invoice_previous_balance,
    'payments_total', v_doc.invoice_payments_total,
    'activity_total', v_activity,
    'calculated_total', v_calculated,
    'difference', v_difference,
    'sections', v_sections
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_invoice_import(uuid, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_invoice_import(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.validate_invoice_import(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_invoice_import(uuid, uuid[]) TO service_role;

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
  v_activity numeric(14,2);
  v_reconciled numeric(14,2);
  v_payments numeric(14,2);
  v_financed numeric(14,2);
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

REVOKE ALL ON FUNCTION public.finalize_invoice_statement(uuid, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_invoice_statement(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.finalize_invoice_statement(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_invoice_statement(uuid, uuid[]) TO service_role;

UPDATE public.document_imports
   SET invoice_summary_source = 'legacy'
 WHERE document_kind = 'invoice' AND invoice_summary_source IS NULL;

NOTIFY pgrst, 'reload schema';