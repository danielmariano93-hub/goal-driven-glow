-- ============================================================================
-- Verdade financeira: reconciliação real de cartão (fim do plug artificial)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.financial_reconciliation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  statement_id uuid REFERENCES public.credit_card_statements(id) ON DELETE CASCADE,
  credit_card_id uuid REFERENCES public.credit_cards(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  reason_code text,
  amount numeric(14,2),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.financial_reconciliation_audit TO authenticated;
GRANT ALL ON public.financial_reconciliation_audit TO service_role;

ALTER TABLE public.financial_reconciliation_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own reconciliation audit read" ON public.financial_reconciliation_audit;
CREATE POLICY "own reconciliation audit read"
  ON public.financial_reconciliation_audit FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "own reconciliation audit insert" ON public.financial_reconciliation_audit;
CREATE POLICY "own reconciliation audit insert"
  ON public.financial_reconciliation_audit FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_fin_recon_audit_user_created
  ON public.financial_reconciliation_audit (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fin_recon_audit_statement
  ON public.financial_reconciliation_audit (statement_id);

DROP TRIGGER IF EXISTS trg_fin_recon_audit_touch ON public.financial_reconciliation_audit;
CREATE TRIGGER trg_fin_recon_audit_touch
  BEFORE UPDATE ON public.financial_reconciliation_audit
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

-- Faturas: motivo, evidência e revisão manual explícitos
ALTER TABLE public.credit_card_statements
  ADD COLUMN IF NOT EXISTS adjustment_reason_code text,
  ADD COLUMN IF NOT EXISTS adjustment_evidence jsonb,
  ADD COLUMN IF NOT EXISTS requires_manual_review boolean NOT NULL DEFAULT false;

-- ============================================================================
-- Ajuste de conciliação só com motivo padronizado + evidência
-- ============================================================================
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
  v_item uuid;
  v_recalc jsonb;
  v_reason text;
  v_code text;
  v_allowed text[] := ARRAY['missing_document','duplicate_item','fx_rounding','previous_balance','refund_pending'];
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  v_reason := trim(coalesce(p_justification,''));
  v_code := nullif(trim(coalesce(p_reason_code,'')),'');

  IF length(v_reason) < 3 THEN RAISE EXCEPTION 'justification_required' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_stmt FROM public.credit_card_statements
   WHERE id = p_statement_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'statement_not_found' USING ERRCODE='P0002'; END IF;

  -- Sem motivo padronizado ou sem evidência: nada de plug. Vai para revisão manual.
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

-- ============================================================================
-- Competência canônica pelo ciclo real do cartão
-- ============================================================================
CREATE OR REPLACE FUNCTION public.card_competence_for(p_card_id uuid, p_date date)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_closing smallint; v_due smallint;
  v_closing_month date; v_due_month date;
BEGIN
  SELECT closing_day, due_day INTO v_closing, v_due FROM public.credit_cards WHERE id = p_card_id;
  IF v_closing IS NULL THEN RETURN date_trunc('month', p_date)::date; END IF;

  -- mês de fechamento: o próprio mês se a compra ocorreu até o dia de fechamento
  IF extract(day from p_date)::int <= least(v_closing, extract(day from (date_trunc('month', p_date) + interval '1 month - 1 day'))::int)
  THEN v_closing_month := date_trunc('month', p_date)::date;
  ELSE v_closing_month := (date_trunc('month', p_date) + interval '1 month')::date;
  END IF;

  -- vencimento posterior ao fechamento: mesmo mês se o dia é maior, senão mês seguinte
  IF coalesce(v_due, v_closing) > v_closing
  THEN v_due_month := v_closing_month;
  ELSE v_due_month := (v_closing_month + interval '1 month')::date;
  END IF;

  RETURN v_due_month;
END $function$;

GRANT EXECUTE ON FUNCTION public.card_competence_for(uuid, date) TO authenticated, service_role;

-- ============================================================================
-- Reconciliação real de uma competência: sem plug, com trilha
-- ============================================================================
CREATE OR REPLACE FUNCTION public.reconcile_card_competence(
  p_card_id uuid,
  p_competence date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_stmt public.credit_card_statements%ROWTYPE;
  v_moved int := 0;
  v_items_removed int := 0;
  v_plugs_removed int := 0;
  v_plug_total numeric(14,2) := 0;
  v_absorbed int := 0;
  v_diff numeric(14,2);
  v_recalc jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.credit_cards WHERE id = p_card_id AND user_id = v_user) THEN
    RAISE EXCEPTION 'card_not_found' USING ERRCODE='P0002';
  END IF;

  -- 1. Competência canônica das transações do cartão pelo ciclo real
  WITH fixed AS (
    UPDATE public.transactions t
       SET competence_date = public.card_competence_for(p_card_id, coalesce(t.purchase_date, t.occurred_at)),
           updated_at = now()
     WHERE t.user_id = v_user
       AND t.credit_card_id = p_card_id
       AND t.competence_date IS DISTINCT FROM
           public.card_competence_for(p_card_id, coalesce(t.purchase_date, t.occurred_at))
    RETURNING 1
  ) SELECT count(*) INTO v_moved FROM fixed;

  -- 2. Parcelas seguem a mesma competência canônica
  UPDATE public.credit_card_installments i
     SET competence_month = public.card_competence_for(p_card_id, coalesce(i.due_date, i.competence_month)),
         updated_at = now()
   WHERE i.user_id = v_user
     AND i.credit_card_id = p_card_id
     AND i.due_date IS NOT NULL
     AND i.competence_month IS DISTINCT FROM public.card_competence_for(p_card_id, i.due_date);

  SELECT * INTO v_stmt FROM public.credit_card_statements
   WHERE user_id = v_user AND credit_card_id = p_card_id
     AND date_trunc('month', competence_month) = date_trunc('month', p_competence)
   FOR UPDATE;

  IF FOUND THEN
    -- 3. Itens fora do ciclo da fatura saem dela (a transação continua existindo)
    WITH removed AS (
      DELETE FROM public.credit_card_statement_items ci
       WHERE ci.statement_id = v_stmt.id
         AND ci.item_kind <> 'adjustment'
         AND ci.occurred_at IS NOT NULL
         AND v_stmt.period_start IS NOT NULL AND v_stmt.period_end IS NOT NULL
         AND (ci.occurred_at < v_stmt.period_start OR ci.occurred_at > v_stmt.period_end)
      RETURNING 1
    ) SELECT count(*) INTO v_items_removed FROM removed;

    -- 4. Ajustes artificiais legados (sem motivo padronizado) deixam de existir
    IF v_stmt.adjustment_reason_code IS NULL THEN
      WITH plugs AS (
        DELETE FROM public.credit_card_statement_items ci
         WHERE ci.statement_id = v_stmt.id AND ci.item_kind = 'adjustment'
        RETURNING ci.amount
      ) SELECT count(*), coalesce(sum(amount),0) INTO v_plugs_removed, v_plug_total FROM plugs;
    END IF;

    v_recalc := public.recalc_credit_card_statement(v_stmt.id);

    -- 5. Parcelas da competência ficam vinculadas à fatura
    WITH absorbed AS (
      UPDATE public.credit_card_installments i
         SET absorbed_by_statement_id = v_stmt.id,
             absorbed_at = coalesce(i.absorbed_at, now()),
             updated_at = now()
       WHERE i.user_id = v_user
         AND i.credit_card_id = p_card_id
         AND date_trunc('month', i.competence_month) = date_trunc('month', v_stmt.competence_month)
         AND i.absorbed_by_statement_id IS DISTINCT FROM v_stmt.id
      RETURNING 1
    ) SELECT count(*) INTO v_absorbed FROM absorbed;

    -- 6. Parcelas de outras competências não podem ficar presas a esta fatura
    UPDATE public.credit_card_installments i
       SET absorbed_by_statement_id = NULL, absorbed_at = NULL, updated_at = now()
     WHERE i.user_id = v_user
       AND i.absorbed_by_statement_id = v_stmt.id
       AND date_trunc('month', i.competence_month) <> date_trunc('month', v_stmt.competence_month);

    SELECT round(stated_total - reconciled_total, 2) INTO v_diff
      FROM public.credit_card_statements WHERE id = v_stmt.id;

    UPDATE public.credit_card_statements
       SET requires_manual_review = (abs(coalesce(v_diff,0)) > 0.005),
           updated_at = now()
     WHERE id = v_stmt.id;

    INSERT INTO public.financial_reconciliation_audit
      (user_id, statement_id, credit_card_id, event_type, reason_code, amount, evidence, actor_id)
    VALUES (v_user, v_stmt.id, p_card_id, 'competence_reconciled', NULL, v_diff,
            jsonb_build_object(
              'competence', p_competence,
              'transactions_recompetenced', v_moved,
              'items_removed_out_of_cycle', v_items_removed,
              'legacy_plugs_removed', v_plugs_removed,
              'legacy_plug_total', v_plug_total,
              'installments_absorbed', v_absorbed,
              'remaining_difference', v_diff
            ), v_user);
  ELSE
    INSERT INTO public.financial_reconciliation_audit
      (user_id, statement_id, credit_card_id, event_type, reason_code, amount, evidence, actor_id)
    VALUES (v_user, NULL, p_card_id, 'competence_reconciled_no_statement', NULL, NULL,
            jsonb_build_object('competence', p_competence, 'transactions_recompetenced', v_moved), v_user);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'competence', p_competence,
    'transactions_recompetenced', v_moved,
    'items_removed_out_of_cycle', v_items_removed,
    'legacy_plugs_removed', v_plugs_removed,
    'legacy_plug_total', v_plug_total,
    'installments_absorbed', v_absorbed,
    'remaining_difference', coalesce(v_diff, 0),
    'requires_manual_review', (abs(coalesce(v_diff,0)) > 0.005)
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.reconcile_card_competence(uuid, date) TO authenticated, service_role;