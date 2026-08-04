CREATE OR REPLACE FUNCTION public.my_more_menu_context()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_last_seen timestamptz;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
  SELECT last_seen_at INTO v_last_seen FROM public.nino_surface_state
   WHERE user_id=v_uid AND surface='nino' AND section='all';

  RETURN jsonb_build_object(
    'ok', true,
    'as_of', now(),
    'split', (
      SELECT jsonb_build_object(
        'open_count', COUNT(*) FILTER (WHERE p.status IN ('pending','notified','partial','payment_reported','awaiting_owner_confirmation')),
        'awaiting_confirmation', COUNT(*) FILTER (WHERE p.status IN ('payment_reported','awaiting_owner_confirmation')),
        'amount_to_receive', COALESCE(SUM(GREATEST(COALESCE(p.amount_due,0) - COALESCE(p.amount_paid,0), 0))
                                     FILTER (WHERE p.status NOT IN ('paid','waived','opted_out')), 0))
      FROM public.shared_expense_participants p
      JOIN public.shared_expenses se ON se.id=p.shared_expense_id
      WHERE se.owner_user_id=v_uid AND se.deleted_at IS NULL AND se.status IN ('active','draft')
    ),
    'reports', (
      SELECT jsonb_build_object(
        'last_period_label', to_char(fr.period_start,'DD/MM') || ' a ' || to_char(fr.period_end,'DD/MM'),
        'last_report_id', fr.id,
        'unread', (SELECT COUNT(*) FROM public.financial_reports x
                    WHERE x.user_id=v_uid AND x.status<>'deleted' AND x.viewed_at IS NULL))
      FROM public.financial_reports fr
      WHERE fr.user_id=v_uid AND fr.status<>'deleted'
      ORDER BY fr.period_end DESC LIMIT 1
    ),
    'nino', jsonb_build_object(
      'active_items', (SELECT COUNT(*) FROM public.nino_intelligence_items i
                        WHERE i.user_id=v_uid AND i.status='active'),
      'new_since_last_visit', (SELECT COUNT(*) FROM public.nino_intelligence_items i
                                WHERE i.user_id=v_uid AND i.status='active'
                                  AND (v_last_seen IS NULL OR i.created_at > v_last_seen)),
      'attention_items', (SELECT COUNT(*) FROM public.nino_intelligence_items i
                           WHERE i.user_id=v_uid AND i.status='active'
                             AND i.severity IN ('attention','critical','high'))
    ),
    'data_quality', jsonb_build_object(
      'uncategorized_count', (SELECT COUNT(*) FROM public.transactions t
        WHERE t.user_id=v_uid AND t.category_id IS NULL AND t.status='confirmed'
          AND COALESCE(t.movement_kind,'transaction')='transaction'
          AND t.occurred_at >= date_trunc('month', current_date)::date)
    ),
    'recurring', jsonb_build_object(
      'active', (SELECT COUNT(*) FROM public.recurring_rules r WHERE r.user_id=v_uid AND r.status='active')
    ),
    'debts', jsonb_build_object(
      'active', (SELECT COUNT(*) FROM public.debts d WHERE d.user_id=v_uid AND d.status='active')
    ),
    'investments', jsonb_build_object(
      'count', (SELECT COUNT(*) FROM public.investments iv WHERE iv.user_id=v_uid)
    ),
    'challenge', (
      SELECT jsonb_build_object('title', ch.title, 'progress', uc.progress, 'status', uc.status)
      FROM public.user_challenges uc
      LEFT JOIN public.challenges ch ON ch.id = uc.challenge_id
      WHERE uc.user_id=v_uid AND uc.status='joined'
      ORDER BY uc.started_at DESC LIMIT 1
    )
  );
END $$;