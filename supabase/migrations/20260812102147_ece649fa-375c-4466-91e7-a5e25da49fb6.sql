CREATE OR REPLACE FUNCTION public.refresh_financial_daily_facts(p_user_id uuid, p_from date, p_to date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  affected integer;
BEGIN
  IF p_user_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'invalid_refresh_range';
  END IF;

  DELETE FROM public.financial_daily_facts
   WHERE user_id = p_user_id AND fact_date BETWEEN p_from AND p_to;
  DELETE FROM public.financial_daily_category_facts
   WHERE user_id = p_user_id AND fact_date BETWEEN p_from AND p_to;

  INSERT INTO public.financial_daily_facts(
    user_id, fact_date, income, cash_outflow, behavioral_consumption,
    account_consumption, card_consumption, transaction_count,
    formula_version
  )
  SELECT
    t.user_id,
    t.occurred_at::date,
    coalesce(sum(t.amount) FILTER (
      WHERE t.type = 'income'
        AND coalesce(t.status, 'confirmed') = 'confirmed'
        AND t.transfer_group_id IS NULL
        AND coalesce(t.movement_kind, 'transaction') = 'transaction'
    ), 0),
    coalesce(sum(t.amount) FILTER (
      WHERE t.type = 'expense'
        AND coalesce(t.status, 'confirmed') = 'confirmed'
        AND t.transfer_group_id IS NULL
        AND coalesce(t.movement_kind, 'transaction') <> 'internal_transfer'
        AND t.credit_card_id IS NULL
        AND coalesce(t.payment_method, 'account') <> 'credit_card'
    ), 0),
    coalesce(sum(
      CASE
        WHEN public.is_behavioral_consumption(
          t.type::text, t.status::text, t.movement_kind,
          t.transfer_group_id, t.settles_card_id
        ) THEN t.amount
        WHEN t.type = 'income'
          AND coalesce(t.status, 'confirmed') = 'confirmed'
          AND t.transfer_group_id IS NULL
          AND coalesce(t.movement_kind, 'transaction') = 'refund'
          THEN -t.amount
        ELSE 0
      END
    ), 0),
    coalesce(sum(
      CASE
        WHEN public.is_behavioral_consumption(
          t.type::text, t.status::text, t.movement_kind,
          t.transfer_group_id, t.settles_card_id
        )
        AND t.credit_card_id IS NULL
        AND coalesce(t.payment_method, 'account') <> 'credit_card'
          THEN t.amount
        WHEN t.type = 'income'
          AND coalesce(t.status, 'confirmed') = 'confirmed'
          AND coalesce(t.movement_kind, 'transaction') = 'refund'
          AND t.credit_card_id IS NULL
          AND coalesce(t.payment_method, 'account') <> 'credit_card'
          THEN -t.amount
        ELSE 0
      END
    ), 0),
    coalesce(sum(
      CASE
        WHEN public.is_behavioral_consumption(
          t.type::text, t.status::text, t.movement_kind,
          t.transfer_group_id, t.settles_card_id
        )
        AND (t.credit_card_id IS NOT NULL OR t.payment_method = 'credit_card')
          THEN t.amount
        WHEN t.type = 'income'
          AND coalesce(t.status, 'confirmed') = 'confirmed'
          AND coalesce(t.movement_kind, 'transaction') = 'refund'
          AND (t.credit_card_id IS NOT NULL OR t.payment_method = 'credit_card')
          THEN -t.amount
        ELSE 0
      END
    ), 0),
    (count(*) FILTER (
      WHERE coalesce(t.status, 'confirmed') = 'confirmed'
    ))::integer,
    'financial_daily.v2'
  FROM public.transactions t
  WHERE t.user_id = p_user_id
    AND t.occurred_at::date BETWEEN p_from AND p_to
  GROUP BY t.user_id, t.occurred_at::date;
  GET DIAGNOSTICS affected = ROW_COUNT;

  -- finance_truth.v1: estorno abate a categoria economica original da compra.
  INSERT INTO public.financial_daily_category_facts(
    user_id, fact_date, category_id, consumption, transaction_count,
    formula_version
  )
  SELECT
    t.user_id,
    t.occurred_at::date,
    CASE
      WHEN coalesce(t.movement_kind, 'transaction') = 'refund'
        THEN coalesce(orig.category_id, t.category_id)
      ELSE t.category_id
    END AS effective_category_id,
    sum(CASE WHEN t.movement_kind = 'refund' THEN -t.amount ELSE t.amount END),
    (count(*) FILTER (WHERE t.type = 'expense'))::integer,
    'financial_daily_category.v3'
  FROM public.transactions t
  LEFT JOIN public.transactions orig
    ON orig.id = t.refund_of_transaction_id
   AND orig.user_id = t.user_id
  WHERE t.user_id = p_user_id
    AND t.occurred_at::date BETWEEN p_from AND p_to
    AND (
      public.is_behavioral_consumption(
        t.type::text, t.status::text, t.movement_kind,
        t.transfer_group_id, t.settles_card_id
      )
      OR (
        t.type = 'income'
        AND coalesce(t.status, 'confirmed') = 'confirmed'
        AND t.transfer_group_id IS NULL
        AND coalesce(t.movement_kind, 'transaction') = 'refund'
      )
    )
  GROUP BY t.user_id, t.occurred_at::date, 3;

  RETURN affected;
END
$function$;