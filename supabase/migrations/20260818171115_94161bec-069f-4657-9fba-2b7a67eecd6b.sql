CREATE OR REPLACE FUNCTION public.backfill_card_competence(
  p_user_id uuid DEFAULT NULL,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row record;
  v_target date;
  v_source text;
  v_changed integer := 0;
  v_scanned integer := 0;
BEGIN
  FOR v_row IN
    SELECT t.id, t.user_id, t.credit_card_id, t.amount,
           t.competence_date, t.purchase_date, t.occurred_at::date AS occurred_on,
           c.closing_day, c.due_day
      FROM public.transactions t
      JOIN public.credit_cards c ON c.id = t.credit_card_id
     WHERE t.credit_card_id IS NOT NULL
       AND coalesce(t.movement_kind, 'transaction') = 'transaction'
       AND coalesce(t.status::text, 'confirmed') = 'confirmed'
       AND (p_user_id IS NULL OR t.user_id = p_user_id)
  LOOP
    v_scanned := v_scanned + 1;
    v_target := NULL;
    v_source := NULL;

    SELECT date_trunc('month', s.competence_month)::date INTO v_target
      FROM public.credit_card_statement_items i
      JOIN public.credit_card_statements s ON s.id = i.statement_id
     WHERE i.legacy_transaction_id = v_row.id
     ORDER BY s.competence_month
     LIMIT 1;
    IF v_target IS NOT NULL THEN v_source := 'statement'; END IF;

    IF v_target IS NULL THEN
      SELECT date_trunc('month', ci.competence_month)::date INTO v_target
        FROM public.credit_card_installments ci
       WHERE ci.legacy_transaction_id = v_row.id
       LIMIT 1;
      IF v_target IS NOT NULL THEN v_source := 'installment'; END IF;
    END IF;

    IF v_target IS NULL AND coalesce(v_row.closing_day, 0) >= 1 THEN
      SELECT date_trunc('month', cy.competence_month)::date INTO v_target
        FROM public.card_cycle_for(
               v_row.closing_day::smallint,
               coalesce(v_row.due_day, v_row.closing_day)::smallint,
               coalesce(v_row.purchase_date, v_row.occurred_on)
             ) cy
       LIMIT 1;
      IF v_target IS NOT NULL THEN v_source := 'cycle'; END IF;
    END IF;

    IF v_target IS NULL THEN CONTINUE; END IF;

    IF date_trunc('month', coalesce(v_row.competence_date, v_row.occurred_on))::date = v_target THEN
      CONTINUE;
    END IF;

    v_changed := v_changed + 1;

    IF NOT p_dry_run THEN
      UPDATE public.transactions
         SET competence_date = v_target
       WHERE id = v_row.id;
    END IF;

    INSERT INTO public.card_reconciliation_events(
      user_id, credit_card_id, event_kind, transaction_id,
      competence_before, competence_after, amount, reason, evidence
    ) VALUES (
      v_row.user_id, v_row.credit_card_id,
      CASE WHEN p_dry_run THEN 'competence_backfill_preview' ELSE 'competence_backfill' END,
      v_row.id,
      date_trunc('month', coalesce(v_row.competence_date, v_row.occurred_on))::date,
      v_target, v_row.amount, v_source,
      jsonb_build_object('source', v_source, 'dry_run', p_dry_run)
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'scanned', v_scanned, 'changed', v_changed, 'dry_run', p_dry_run);
END;
$fn$;