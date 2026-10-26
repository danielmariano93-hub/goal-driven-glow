-- Fatura de cartão: saldo credor, conciliação por ciclo e itens já lançados.
--
-- Caso real (Itaú, out/2026): o cliente antecipou parcelas durante o mês, pagou
-- mais do que devia e a fatura fechou NEGATIVA (saldo credor de R$ 3.644,06).
-- O Assessor não conseguia conciliar porque:
--   1. `credit_card_statements.stated_total >= 0` e `validate_invoice_import`
--      rejeitavam total negativo (e o parser descartava o sinal);
--   2. o pagamento da fatura anterior (já baixada no Nino) entrava de novo na conta;
--   3. itens que o Nino já tinha (duplicata forte contra o razão) ficavam como
--      `ignored` e sumiam da soma, quebrando a equação.
--
-- Modelo: `stated_total` continua sendo o valor A PAGAR (>= 0). O total como o
-- banco imprime (pode ser negativo) fica em `signed_total`.

ALTER TABLE public.credit_card_statements
  ADD COLUMN IF NOT EXISTS signed_total numeric(14,2);

COMMENT ON COLUMN public.credit_card_statements.signed_total IS
  'Total da fatura como impresso pelo banco: negativo = saldo credor. stated_total continua sendo o valor a pagar (>= 0).';

-- A diferença de conciliação compara o total impresso (com sinal) com o reconciliado.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'credit_card_statements'
       AND column_name = 'reconciliation_difference'
       AND generation_expression ILIKE '%signed_total%'
  ) THEN
    ALTER TABLE public.credit_card_statements DROP COLUMN IF EXISTS reconciliation_difference;
    ALTER TABLE public.credit_card_statements ADD COLUMN reconciliation_difference numeric(14,2)
      GENERATED ALWAYS AS (round(coalesce(signed_total, stated_total) - reconciled_total, 2)) STORED;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- validate_invoice_import: aceita total negativo e conta itens já lançados.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_invoice_import(p_document_id uuid, p_item_ids uuid[])
 RETURNS jsonb
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
  -- Total negativo é válido: fatura com saldo credor.
  IF v_doc.invoice_total IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_invoice_total');
  END IF;

  -- Item `ignored` com motivo de duplicata é linha da fatura que o Nino JÁ tem no
  -- razão: continua contando na aritmética da fatura. `ignored` sem motivo é
  -- descarte deliberado e fica de fora.
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
    AND status NOT IN ('rejected','failed','rolled_back')
    AND NOT (status = 'ignored' AND duplicate_reason IS NULL);

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
    SELECT round(coalesce(sum(
             CASE WHEN coalesce(statement_item_kind, 'purchase') IN ('refund') AND r.section <> 'payments'
                  THEN -abs(amount) ELSE abs(amount) END), 0), 2) INTO v_extracted
      FROM public.extracted_items
     WHERE document_id = p_document_id
       AND user_id = v_user
       AND id = ANY(p_item_ids)
       AND statement_section = r.section
       AND coalesce(statement_item_kind, 'purchase') <> 'informational'
       AND status NOT IN ('rejected','failed','rolled_back')
       AND NOT (status = 'ignored' AND duplicate_reason IS NULL);
    v_official := round(abs(r.official), 2);
    v_diff := round(v_official - abs(v_extracted), 2);
    v_sections := v_sections || jsonb_build_object(
      'section', r.section,
      'official_total', v_official,
      'extracted_total', abs(v_extracted),
      'difference', v_diff,
      'covered', abs(v_diff) <= 0.05
    );
    IF abs(v_diff) > 0.05 AND abs(v_diff) > abs(v_gap_amount) THEN
      v_gap_section := r.section;
      v_gap_amount := v_diff;
    END IF;
  END LOOP;

  -- Camada 3: saldo anterior + atividade do ciclo = total oficial (com sinal).
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

-- ---------------------------------------------------------------------------
-- recalc_credit_card_statement: compara com o total impresso (com sinal).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalc_credit_card_statement(p_statement_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_stmt public.credit_card_statements%ROWTYPE; v_sum numeric(14,2); v_reconciled numeric(14,2); v_status text; v_target numeric(14,2);
BEGIN
  SELECT * INTO v_stmt FROM public.credit_card_statements WHERE id=p_statement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'statement_not_found' USING ERRCODE='P0002'; END IF;
  SELECT round(coalesce(sum(amount),0),2) INTO v_sum FROM public.credit_card_statement_items WHERE statement_id=p_statement_id;
  v_reconciled := round(coalesce(v_stmt.opening_balance,0)+v_sum,2);
  v_target := coalesce(v_stmt.signed_total, v_stmt.stated_total);
  v_status := CASE
    WHEN v_stmt.status IN ('paid','partially_paid','cancelled','refinanced') THEN v_stmt.status
    WHEN abs(round(v_target-v_reconciled,2))<=0.05 AND v_stmt.status='needs_review' THEN 'needs_review'
    ELSE v_stmt.status END;
  UPDATE public.credit_card_statements
     SET reconciled_total=v_reconciled, status=v_status, updated_at=now()
   WHERE id=p_statement_id;
  RETURN jsonb_build_object(
    'reconciled_total', v_reconciled,
    'items_total', v_sum,
    'difference', round(v_target-v_reconciled,2)
  );
END $function$;

-- ---------------------------------------------------------------------------
-- finalize_invoice_statement: saldo credor, fatura anterior já baixada, ciclo.
-- ---------------------------------------------------------------------------
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
  v_anchor date;
  v_month date;
  v_explicit boolean := false;
  v_existing record;
  v_guard int := 0;
  v_derived_competence date;
  v_cycle record;
  v_has_cycle boolean := false;
  v_total numeric(14,2);
  v_opening numeric(14,2);
  v_prev_settled boolean := false;
  v_prev_payment_item uuid := NULL;
  v_ok boolean;
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

  -- Âncora de fechamento: data de fechamento do documento, senão fim do período.
  v_anchor := coalesce(v_doc.invoice_closing_date, v_doc.period_end, current_date);
  IF v_closing_day IS NOT NULL AND v_closing_day BETWEEN 1 AND 31 THEN
    SELECT * INTO v_cycle
      FROM public.card_cycle_for(v_closing_day, v_due_day, v_anchor);
    v_has_cycle := v_cycle.competence_month IS NOT NULL;
  END IF;

  IF v_doc.invoice_competence_month IS NOT NULL THEN
    -- Escolha explícita do usuário (ou já resolvida em conferência).
    v_competence := date_trunc('month', v_doc.invoice_competence_month)::date;
    v_due := coalesce(v_doc.invoice_due_date, v_competence);
    v_explicit := true;
  ELSIF v_doc.invoice_due_date IS NOT NULL AND v_has_cycle
        AND v_doc.invoice_due_date <> v_cycle.due_date THEN
    -- O documento diz um vencimento; o ciclo do cartão diz outro. Não decidimos
    -- no escuro: o usuário confirma qual data manda nesta fatura.
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'due_date_conflict',
      'closing_date', v_cycle.closing_date,
      'closing_day', v_closing_day,
      'due_day', v_due_day,
      'document_due_date', v_doc.invoice_due_date,
      'document_competence_month', date_trunc('month', v_doc.invoice_due_date)::date,
      'cycle_due_date', v_cycle.due_date,
      'cycle_competence_month', v_cycle.competence_month
    );
  ELSIF v_doc.invoice_due_date IS NOT NULL AND NOT v_has_cycle THEN
    v_due := v_doc.invoice_due_date;
    v_competence := date_trunc('month', v_due)::date;
    v_explicit := true;
  ELSIF v_has_cycle THEN
    v_due := v_cycle.due_date;
    v_competence := v_cycle.competence_month;
  ELSE
    v_due := v_anchor + 10;
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

  v_total := coalesce(v_doc.invoice_total, 0);
  v_opening := coalesce(v_doc.invoice_previous_balance, 0);

  -- Conciliação por ciclo: se a fatura anterior do cartão já está paga no Nino com
  -- exatamente o saldo anterior impresso aqui, ela NÃO entra de novo nesta fatura
  -- (nem como saldo de abertura, nem o pagamento que a quitou).
  IF v_opening > 0 AND EXISTS (
       SELECT 1 FROM public.credit_card_statements ps
        WHERE ps.credit_card_id = v_card AND ps.user_id = v_user
          AND ps.competence_month < v_competence
          AND ps.status = 'paid'
          AND abs(ps.stated_total - v_opening) <= 0.05) THEN
    v_prev_settled := true;
    SELECT ei.id INTO v_prev_payment_item
      FROM public.extracted_items ei
     WHERE ei.document_id = p_document_id AND ei.user_id = v_user
       AND ei.id = ANY(p_item_ids)
       AND ei.statement_item_kind = 'payment'
       AND abs(abs(ei.amount) - v_opening) <= 0.05
     ORDER BY ei.occurred_at, ei.idx
     LIMIT 1;
    IF v_prev_payment_item IS NOT NULL THEN v_opening := 0; ELSE v_prev_settled := false; END IF;
  END IF;

  INSERT INTO public.credit_card_statements(
    user_id, credit_card_id, competence_month, due_date,
    opening_balance, stated_total, signed_total, reconciled_total, status, source_document_id
  ) VALUES (
    v_user, v_card, v_competence, v_due,
    v_opening, greatest(v_total, 0), v_total, 0, 'needs_review', p_document_id
  )
  ON CONFLICT (credit_card_id, competence_month) DO UPDATE SET
    due_date = excluded.due_date,
    opening_balance = excluded.opening_balance,
    stated_total = excluded.stated_total,
    signed_total = excluded.signed_total,
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
    AND ei.id IS DISTINCT FROM v_prev_payment_item
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
  IF v_prev_settled THEN
    v_payments := round(greatest(v_payments - coalesce(v_doc.invoice_previous_balance, 0), 0), 2);
  END IF;
  v_financed := greatest(round(v_opening - v_payments, 2), 0);
  v_reconciled := round(v_opening + v_activity, 2);
  v_ok := abs(v_total - v_reconciled) <= 0.05;

  UPDATE public.credit_card_statements
     SET opening_balance = v_opening,
         stated_total = greatest(v_total, 0),
         signed_total = v_total,
         reconciled_total = v_reconciled,
         payments_total = v_payments,
         financed_balance = v_financed,
         -- Saldo credor: nada a pagar. A fatura nasce quitada.
         paid_amount = CASE WHEN v_ok AND v_total <= 0
                            THEN greatest(coalesce(v_doc.invoice_current_charges_total, 0), 0)
                            ELSE paid_amount END,
         status = CASE
           WHEN NOT v_ok THEN 'needs_review'
           WHEN v_total <= 0 THEN 'paid'
           ELSE 'open'
         END,
         period_start = coalesce(period_start, v_doc.period_start),
         closing_date = coalesce(closing_date, v_doc.invoice_closing_date),
         updated_at = now()
   WHERE id = v_statement;

  IF v_ok AND v_total <= 0 THEN
    UPDATE public.credit_card_installments i
       SET status = 'paid', updated_at = now()
     WHERE i.status IN ('scheduled','billed')
       AND i.id IN (SELECT it.installment_id FROM public.credit_card_statement_items it
                     WHERE it.statement_id = v_statement AND it.installment_id IS NOT NULL);
  END IF;

  RETURN jsonb_build_object(
    'ok', v_ok,
    'statement_id', v_statement,
    'competence_month', v_competence,
    'derived_competence_month', v_derived_competence,
    'closing_date', CASE WHEN v_has_cycle THEN v_cycle.closing_date ELSE v_doc.invoice_closing_date END,
    'due_date', v_due,
    'stated_total', v_doc.invoice_total,
    'previous_balance', v_doc.invoice_previous_balance,
    'previous_statement_settled', v_prev_settled,
    'payments_total', v_payments,
    'financed_balance', v_financed,
    'activity_total', v_activity,
    'reconciled_total', v_reconciled,
    'difference', round(v_total - v_reconciled, 2)
  );
END;
$function$;
