CREATE OR REPLACE FUNCTION public.nino_build_facts(_user_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_end date := current_date;
  v_start date := date_trunc('month', current_date)::date;
  v_prev_start date := (date_trunc('month', current_date) - interval '1 month')::date;
  v_prev_end date := v_prev_start + (v_end - v_start);
  v_cur numeric;
  v_prev numeric;
  v_count integer := 0;
  r record;
BEGIN
  v_cur := public.nino_expense_sum(_user_id, v_start, v_end);
  v_prev := public.nino_expense_sum(_user_id, v_prev_start, v_prev_end);

  INSERT INTO public.financial_insight_facts
    (user_id, period_start, period_end, as_of, fact_type, metric_key,
     current_value, comparison_value, absolute_delta, percentage_delta,
     evidence, coverage, confidence, valid_until)
  VALUES (_user_id, v_start, v_end, now(), 'spend_change', 'expense_total',
     v_cur, v_prev, round(v_cur - v_prev, 2),
     CASE WHEN v_prev > 0 THEN round(((v_cur - v_prev) / v_prev) * 100, 1) ELSE NULL END,
     jsonb_build_object('previous_period', jsonb_build_object('start', v_prev_start, 'end', v_prev_end)),
     1, 0.9, now() + interval '2 days')
  ON CONFLICT (user_id, fact_type, metric_key, period_start, period_end,
               COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid),
               COALESCE(merchant_normalized, ''))
  DO UPDATE SET current_value = EXCLUDED.current_value,
                comparison_value = EXCLUDED.comparison_value,
                absolute_delta = EXCLUDED.absolute_delta,
                percentage_delta = EXCLUDED.percentage_delta,
                as_of = now(), valid_until = EXCLUDED.valid_until, updated_at = now();
  v_count := v_count + 1;

  FOR r IN
    WITH cur AS (
      SELECT t.category_id, SUM(t.amount) total, COUNT(*) cnt, array_agg(t.id) ids
      FROM public.transactions t
      WHERE t.user_id = _user_id AND t.type='expense' AND t.status='confirmed'
        AND COALESCE(t.movement_kind,'transaction')='transaction' AND t.transfer_group_id IS NULL
        AND t.occurred_at BETWEEN v_start AND v_end
      GROUP BY t.category_id
    ), prev AS (
      SELECT t.category_id, SUM(t.amount) total
      FROM public.transactions t
      WHERE t.user_id = _user_id AND t.type='expense' AND t.status='confirmed'
        AND COALESCE(t.movement_kind,'transaction')='transaction' AND t.transfer_group_id IS NULL
        AND t.occurred_at BETWEEN v_prev_start AND v_prev_end
      GROUP BY t.category_id
    )
    SELECT c.category_id, c.total, c.cnt, c.ids, COALESCE(p.total,0) prev_total,
           COALESCE(cat.name, 'Sem categoria') cat_name
    FROM cur c
    LEFT JOIN prev p ON p.category_id IS NOT DISTINCT FROM c.category_id
    LEFT JOIN public.categories cat ON cat.id = c.category_id
    ORDER BY abs(c.total - COALESCE(p.total,0)) DESC
    LIMIT 3
  LOOP
    INSERT INTO public.financial_insight_facts
      (user_id, period_start, period_end, as_of, fact_type, metric_key, category_id,
       current_value, comparison_value, absolute_delta, percentage_delta,
       transaction_ids, evidence, coverage, confidence, valid_until)
    VALUES (_user_id, v_start, v_end, now(), 'category_driver', 'expense_by_category', r.category_id,
       r.total, r.prev_total, round(r.total - r.prev_total, 2),
       CASE WHEN r.prev_total > 0 THEN round(((r.total - r.prev_total)/r.prev_total)*100, 1) ELSE NULL END,
       COALESCE(r.ids, '{}'),
       jsonb_build_object('category_name', r.cat_name, 'transaction_count', r.cnt,
                          'share_of_expense', CASE WHEN v_cur > 0 THEN round((r.total/v_cur)*100,1) ELSE NULL END),
       1, 0.85, now() + interval '2 days')
    ON CONFLICT (user_id, fact_type, metric_key, period_start, period_end,
                 COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 COALESCE(merchant_normalized, ''))
    DO UPDATE SET current_value = EXCLUDED.current_value, comparison_value = EXCLUDED.comparison_value,
                  absolute_delta = EXCLUDED.absolute_delta, percentage_delta = EXCLUDED.percentage_delta,
                  transaction_ids = EXCLUDED.transaction_ids, evidence = EXCLUDED.evidence,
                  as_of = now(), valid_until = EXCLUDED.valid_until, updated_at = now();
    v_count := v_count + 1;
  END LOOP;

  INSERT INTO public.financial_insight_facts
    (user_id, period_start, period_end, as_of, fact_type, metric_key,
     current_value, evidence, coverage, confidence, valid_until)
  SELECT _user_id, v_start, v_end, now(), 'data_quality', 'uncategorized_expenses',
         COUNT(*)::numeric,
         jsonb_build_object('total_amount', COALESCE(SUM(t.amount),0)),
         1, 1, now() + interval '2 days'
  FROM public.transactions t
  WHERE t.user_id = _user_id AND t.type='expense' AND t.status='confirmed'
    AND COALESCE(t.movement_kind,'transaction')='transaction'
    AND t.category_id IS NULL AND t.occurred_at BETWEEN v_start AND v_end
  ON CONFLICT (user_id, fact_type, metric_key, period_start, period_end,
               COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid),
               COALESCE(merchant_normalized, ''))
  DO UPDATE SET current_value = EXCLUDED.current_value, evidence = EXCLUDED.evidence,
                as_of = now(), valid_until = EXCLUDED.valid_until, updated_at = now();
  v_count := v_count + 1;

  RETURN v_count;
END $$;