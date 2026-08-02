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

  UPDATE public.credit_card_installments i
     SET competence_month = public.card_competence_for(p_card_id, i.due_date),
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
    -- Apenas COMPRAS fora do ciclo saem da fatura. Parcela de compra antiga
    -- pertence à fatura por definição e nunca é removida por data de compra.
    WITH removed AS (
      DELETE FROM public.credit_card_statement_items ci
       WHERE ci.statement_id = v_stmt.id
         AND ci.item_kind = 'purchase'
         AND ci.occurred_at IS NOT NULL
         AND v_stmt.period_start IS NOT NULL AND v_stmt.period_end IS NOT NULL
         AND (ci.occurred_at < v_stmt.period_start OR ci.occurred_at > v_stmt.period_end)
      RETURNING 1
    ) SELECT count(*) INTO v_items_removed FROM removed;

    IF v_stmt.adjustment_reason_code IS NULL THEN
      WITH plugs AS (
        DELETE FROM public.credit_card_statement_items ci
         WHERE ci.statement_id = v_stmt.id AND ci.item_kind = 'adjustment'
        RETURNING ci.amount
      ) SELECT count(*), coalesce(sum(amount),0) INTO v_plugs_removed, v_plug_total FROM plugs;
    END IF;

    v_recalc := public.recalc_credit_card_statement(v_stmt.id);

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
              'purchases_removed_out_of_cycle', v_items_removed,
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
    'purchases_removed_out_of_cycle', v_items_removed,
    'legacy_plugs_removed', v_plugs_removed,
    'legacy_plug_total', v_plug_total,
    'installments_absorbed', v_absorbed,
    'remaining_difference', coalesce(v_diff, 0),
    'requires_manual_review', (abs(coalesce(v_diff,0)) > 0.005)
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.reconcile_card_competence(uuid, date) TO authenticated, service_role;