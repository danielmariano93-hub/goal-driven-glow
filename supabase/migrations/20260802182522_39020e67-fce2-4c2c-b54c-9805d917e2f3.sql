-- 1) user_insights: aceitar os valores usados pelas RPCs de feedback
ALTER TABLE public.user_insights DROP CONSTRAINT IF EXISTS user_insights_feedback_check;
ALTER TABLE public.user_insights
  ADD CONSTRAINT user_insights_feedback_check
  CHECK (feedback IS NULL OR feedback = ANY (ARRAY['useful','not_useful','acted','dismissed']));

ALTER TABLE public.user_insights DROP CONSTRAINT IF EXISTS user_insights_status_check;
ALTER TABLE public.user_insights
  ADD CONSTRAINT user_insights_status_check
  CHECK (status = ANY (ARRAY['active','dismissed','expired','resolved']));

-- 2) Ajuste de fatura: teto rígido de 2% do total oficial
CREATE OR REPLACE FUNCTION public.force_reconcile_credit_card_statement(
  p_statement_id uuid,
  p_justification text,
  p_reason_code text DEFAULT NULL,
  p_evidence jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_stmt public.credit_card_statements%ROWTYPE;
  v_diff numeric(14,2);
  v_cap numeric(14,2);
  v_item uuid;
  v_recalc jsonb;
  v_reason text;
  v_code text;
  v_allowed text[] := ARRAY['missing_document','duplicate_item','fx_rounding','previous_balance','refund_pending'];
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  v_reason := trim(coalesce(p_justification,''));
  v_code := nullif(trim(coalesce(p_reason_code,'')),'');

  IF length(v_reason) < 20 THEN RAISE EXCEPTION 'justification_required' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_stmt FROM public.credit_card_statements
   WHERE id = p_statement_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'statement_not_found' USING ERRCODE='P0002'; END IF;

  IF v_code IS NULL OR NOT (v_code = ANY(v_allowed))
     OR p_evidence IS NULL OR p_evidence = '{}'::jsonb OR jsonb_typeof(p_evidence) <> 'object' THEN
    UPDATE public.credit_card_statements
       SET requires_manual_review = true, updated_at = now()
     WHERE id = p_statement_id;
    INSERT INTO public.financial_reconciliation_audit
      (user_id, statement_id, credit_card_id, event_type, reason_code, amount, evidence, actor_id)
    VALUES (v_user, p_statement_id, v_stmt.credit_card_id, 'adjustment_refused', v_code,
            round(v_stmt.stated_total - v_stmt.reconciled_total, 2),
            jsonb_build_object('justification', left(v_reason,400), 'evidence', coalesce(p_evidence,'{}'::jsonb)), v_user);
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'manual_reconciliation_required',
      'allowed_reason_codes', to_jsonb(v_allowed),
      'requires_manual_review', true
    );
  END IF;

  IF v_stmt.status NOT IN ('draft','needs_review','open','overdue') OR v_stmt.paid_amount > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'statement_economic_fields_locked');
  END IF;

  v_diff := round(v_stmt.stated_total - v_stmt.reconciled_total, 2);
  IF abs(v_diff) <= 0.005 THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'difference', 0);
  END IF;

  -- Teto de 2% do total oficial: acima disso o certo é corrigir lançamentos.
  v_cap := greatest(1.00, round(abs(coalesce(v_stmt.stated_total,0)) * 0.02, 2));
  IF abs(v_diff) > v_cap THEN
    UPDATE public.credit_card_statements
       SET requires_manual_review = true, updated_at = now()
     WHERE id = p_statement_id;
    INSERT INTO public.financial_reconciliation_audit
      (user_id, statement_id, credit_card_id, event_type, reason_code, amount, evidence, actor_id)
    VALUES (v_user, p_statement_id, v_stmt.credit_card_id, 'adjustment_above_cap', v_code, v_diff,
            jsonb_build_object('justification', left(v_reason,400), 'evidence', p_evidence, 'cap', v_cap), v_user);
    RETURN jsonb_build_object('ok', false, 'error', 'adjustment_above_cap', 'cap', v_cap, 'difference', v_diff);
  END IF;

  INSERT INTO public.credit_card_statement_items(user_id,statement_id,item_kind,description,amount,occurred_at)
  VALUES (v_user, p_statement_id, 'adjustment',
          'Ajuste de conciliação (' || v_code || ') — ' || left(v_reason,100),
          v_diff,
          coalesce(v_stmt.period_end, v_stmt.competence_month))
  RETURNING id INTO v_item;

  v_recalc := public.recalc_credit_card_statement(p_statement_id);

  UPDATE public.credit_card_statements
     SET adjustment_reason_code = v_code,
         adjustment_evidence = p_evidence,
         requires_manual_review = false,
         updated_at = now()
   WHERE id = p_statement_id;

  INSERT INTO public.financial_reconciliation_audit
    (user_id, statement_id, credit_card_id, event_type, reason_code, amount, evidence, actor_id)
  VALUES (v_user, p_statement_id, v_stmt.credit_card_id, 'adjustment_applied', v_code, v_diff,
          jsonb_build_object('justification', left(v_reason,400), 'evidence', p_evidence, 'item_id', v_item), v_user);

  IF v_stmt.source_document_id IS NOT NULL THEN
    INSERT INTO public.document_import_audit(user_id,document_id,action,payload)
    VALUES (v_user, v_stmt.source_document_id, 'force_reconcile_statement',
            jsonb_build_object('statement_id',p_statement_id,'adjustment',v_diff,
                               'reason_code',v_code,'justification',left(v_reason,400)));
  END IF;

  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'adjustment', v_diff,
                            'item_id', v_item, 'reason_code', v_code) || v_recalc;
END $function$;