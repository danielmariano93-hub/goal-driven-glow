-- =========================================================
-- NINO INTELLIGENCE — contratos de leitura por superfície
-- =========================================================

CREATE OR REPLACE FUNCTION public.nino_item_json(_row public.nino_intelligence_items)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', _row.id,
    'kind', _row.kind,
    'temporal_role', _row.temporal_role,
    'status', _row.status,
    'priority', _row.priority,
    'severity', _row.severity,
    'title', _row.title,
    'summary', _row.summary,
    'explanation', _row.explanation,
    'evidence', _row.evidence,
    'primary_action', _row.primary_action,
    'secondary_action', _row.secondary_action,
    'source', _row.source,
    'period', jsonb_build_object('start', _row.source_period_start, 'end', _row.source_period_end),
    'valid_from', _row.valid_from,
    'valid_until', _row.valid_until,
    'confidence', _row.confidence,
    'data_quality', _row.data_quality,
    'report_id', _row.report_id,
    'dedup_key', _row.dedup_key,
    'created_at', _row.created_at,
    'updated_at', _row.updated_at,
    'acted_at', _row.acted_at,
    'dismissed_at', _row.dismissed_at
  );
$$;
GRANT EXECUTE ON FUNCTION public.nino_item_json(public.nino_intelligence_items) TO authenticated, service_role;

-- ---------- refresh sob demanda (própria conta) ----------
CREATE OR REPLACE FUNCTION public.my_nino_refresh()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v int;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
  v := public.nino_rebuild_items(v_uid, 'on_demand');
  RETURN jsonb_build_object('ok', true, 'items', v, 'at', now());
END $$;
GRANT EXECUTE ON FUNCTION public.my_nino_refresh() TO authenticated;

-- ---------- ABA MAIS ----------
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
        'last_period_label', CASE WHEN fr.id IS NULL THEN NULL
          ELSE to_char(fr.period_start,'DD/MM') || ' a ' || to_char(fr.period_end,'DD/MM') END,
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
      SELECT jsonb_build_object('title', c.title, 'progress', uc.progress, 'status', uc.status)
      FROM public.user_challenges uc
      LEFT JOIN public.challenges_catalog c ON c.id = uc.challenge_id
      WHERE uc.user_id=v_uid AND uc.status='joined'
      ORDER BY uc.started_at DESC LIMIT 1
    )
  );
END $$;
GRANT EXECUTE ON FUNCTION public.my_more_menu_context() TO authenticated;

-- ---------- PÁGINA NINO ----------
CREATE OR REPLACE FUNCTION public.my_nino_intelligence_context()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_last_seen timestamptz;
  v_continuity text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
  SELECT last_seen_at, continuity_topic INTO v_last_seen, v_continuity
    FROM public.nino_surface_state WHERE user_id=v_uid AND surface='nino' AND section='all';

  IF v_continuity IS NULL THEN
    SELECT i.title INTO v_continuity FROM public.nino_intelligence_items i
     WHERE i.user_id=v_uid AND i.status='active' AND i.kind IN ('risk','change')
     ORDER BY i.priority DESC, i.updated_at DESC LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'as_of', now(),
    'continuity_topic', v_continuity,
    'last_seen_at', v_last_seen,
    'new_since_last_visit', (SELECT COUNT(*) FROM public.nino_intelligence_items i
      WHERE i.user_id=v_uid AND i.status='active' AND (v_last_seen IS NULL OR i.created_at > v_last_seen)),
    'now', COALESCE((SELECT jsonb_agg(public.nino_item_json(i) ORDER BY i.priority DESC, i.updated_at DESC)
      FROM public.nino_intelligence_items i
      WHERE i.user_id=v_uid AND i.status='active' AND i.temporal_role='now'
        AND i.kind IN ('risk','recommendation','pending_confirmation','data_quality','projection')), '[]'::jsonb),
    'changes', COALESCE((SELECT jsonb_agg(public.nino_item_json(i) ORDER BY i.priority DESC, i.updated_at DESC)
      FROM public.nino_intelligence_items i
      WHERE i.user_id=v_uid AND i.status='active' AND i.kind='change'), '[]'::jsonb),
    'learnings', COALESCE((SELECT jsonb_agg(public.nino_item_json(i) ORDER BY i.priority DESC, i.confidence DESC)
      FROM public.nino_intelligence_items i
      WHERE i.user_id=v_uid AND i.status='active' AND i.kind='pattern'), '[]'::jsonb),
    'prepare', COALESCE((SELECT jsonb_agg(public.nino_item_json(i) ORDER BY i.priority DESC, i.valid_from)
      FROM public.nino_intelligence_items i
      WHERE i.user_id=v_uid AND i.status='active' AND i.temporal_role='future'), '[]'::jsonb),
    'history', COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'updated_at') DESC) FROM (
        SELECT public.nino_item_json(i) x FROM public.nino_intelligence_items i
        WHERE i.user_id=v_uid AND (i.temporal_role IN ('historical','closed_period') OR i.status IN ('acted','expired','superseded'))
        ORDER BY i.updated_at DESC LIMIT 30) s), '[]'::jsonb),
    'achievements', COALESCE((SELECT jsonb_agg(public.nino_item_json(i) ORDER BY i.updated_at DESC)
      FROM public.nino_intelligence_items i
      WHERE i.user_id=v_uid AND i.status='active' AND i.kind='achievement'), '[]'::jsonb),
    'data_quality', jsonb_build_object(
      'status', CASE
        WHEN (SELECT COUNT(*) FROM public.transactions t WHERE t.user_id=v_uid AND t.status='confirmed') = 0 THEN 'insufficient'
        WHEN EXISTS (SELECT 1 FROM public.nino_intelligence_items i
                      WHERE i.user_id=v_uid AND i.status='active' AND i.kind='data_quality') THEN 'attention'
        ELSE 'ok' END,
      'uncategorized_count', (SELECT COUNT(*) FROM public.transactions t
        WHERE t.user_id=v_uid AND t.category_id IS NULL AND t.status='confirmed'
          AND COALESCE(t.movement_kind,'transaction')='transaction'
          AND t.occurred_at >= date_trunc('month', current_date)::date))
  );
END $$;
GRANT EXECUTE ON FUNCTION public.my_nino_intelligence_context() TO authenticated;

-- ---------- HOME (item único, cascata) ----------
CREATE OR REPLACE FUNCTION public.my_nino_home_item()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_item public.nino_intelligence_items; v_as_of timestamptz; v_topic text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;

  SELECT * INTO v_item FROM public.nino_intelligence_items i
   WHERE i.user_id=v_uid AND i.status='active'
     AND i.kind IN ('pending_confirmation','risk','change','opportunity','recommendation','data_quality','pattern')
     AND (i.valid_until IS NULL OR i.valid_until > now())
   ORDER BY
     CASE i.kind
       WHEN 'pending_confirmation' THEN 1 WHEN 'risk' THEN 2 WHEN 'change' THEN 3
       WHEN 'opportunity' THEN 4 WHEN 'recommendation' THEN 5 WHEN 'data_quality' THEN 6 ELSE 7 END,
     i.priority DESC, i.updated_at DESC
   LIMIT 1;

  IF v_item.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'kind', 'item', 'item', public.nino_item_json(v_item));
  END IF;

  SELECT MAX(as_of) INTO v_as_of FROM public.financial_insight_facts WHERE user_id=v_uid;
  SELECT continuity_topic INTO v_topic FROM public.nino_surface_state
   WHERE user_id=v_uid AND surface='nino' AND section='all';

  RETURN jsonb_build_object('ok', true, 'kind', 'stability',
    'item', jsonb_build_object(
      'id', NULL, 'kind', 'achievement', 'severity', 'info',
      'title', 'Nada urgente mudou',
      'summary', 'Sua situação segue estável.',
      'explanation', 'Seus dados foram analisados'
        || CASE WHEN v_as_of IS NULL THEN '.' ELSE ' até ' || to_char(v_as_of, 'DD/MM às HH24:MI') || '.' END
        || CASE WHEN v_topic IS NULL THEN '' ELSE ' Seu principal ponto de atenção continua sendo ' || v_topic || '.' END,
      'primary_action', jsonb_build_object('label','Ver detalhes','route','/app/nino')));
END $$;
GRANT EXECUTE ON FUNCTION public.my_nino_home_item() TO authenticated;

-- ---------- RELATÓRIOS ----------
CREATE OR REPLACE FUNCTION public.my_reports_current_context(_start date DEFAULT NULL, _end date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_from date := COALESCE(_start, date_trunc('month', current_date)::date);
  v_to date := COALESCE(_end, current_date);
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'period', jsonb_build_object('start', v_from, 'end', v_to),
    'facts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'fact_type', f.fact_type, 'metric_key', f.metric_key,
        'current_value', f.current_value, 'comparison_value', f.comparison_value,
        'absolute_delta', f.absolute_delta, 'percentage_delta', f.percentage_delta,
        'category_id', f.category_id, 'evidence', f.evidence, 'as_of', f.as_of,
        'coverage', f.coverage, 'confidence', f.confidence)
        ORDER BY f.fact_type, abs(COALESCE(f.absolute_delta,0)) DESC)
      FROM public.financial_insight_facts f
      WHERE f.user_id=v_uid AND f.period_start >= v_from - interval '40 days'), '[]'::jsonb),
    'items', COALESCE((SELECT jsonb_agg(public.nino_item_json(i) ORDER BY i.priority DESC)
      FROM public.nino_intelligence_items i
      WHERE i.user_id=v_uid AND i.status='active'
        AND i.kind IN ('change','risk','opportunity','data_quality','recommendation')), '[]'::jsonb),
    'closed_periods', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'report_id', fr.id, 'report_type', fr.report_type,
        'period_start', fr.period_start, 'period_end', fr.period_end,
        'health_score', fr.health_score, 'executive_summary', fr.executive_summary,
        'viewed_at', fr.viewed_at, 'data_quality_status', fr.data_quality_status)
        ORDER BY fr.period_end DESC)
      FROM public.financial_reports fr
      WHERE fr.user_id=v_uid AND fr.status<>'deleted'), '[]'::jsonb)
  );
END $$;
GRANT EXECUTE ON FUNCTION public.my_reports_current_context(date, date) TO authenticated;

-- ---------- INTERAÇÕES ----------
CREATE OR REPLACE FUNCTION public.my_nino_mark_seen(_surface text, _section text DEFAULT 'all')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
  INSERT INTO public.nino_surface_state (user_id, surface, section, last_seen_at)
  VALUES (v_uid, _surface, COALESCE(_section,'all'), now())
  ON CONFLICT (user_id, surface, section)
  DO UPDATE SET last_seen_at = now(), updated_at = now();
  RETURN jsonb_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION public.my_nino_mark_seen(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.my_nino_record_exposure(_item_id uuid, _surface text, _rank integer DEFAULT NULL, _selection_reason text DEFAULT NULL, _channel text DEFAULT 'app')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.nino_intelligence_items WHERE id=_item_id AND user_id=v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  INSERT INTO public.nino_item_exposures (user_id, item_id, surface, channel, rank, selection_reason, shown_at)
  VALUES (v_uid, _item_id, _surface, COALESCE(_channel,'app'), _rank, _selection_reason, now());
  RETURN jsonb_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION public.my_nino_record_exposure(uuid, text, integer, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.my_nino_item_feedback(_item_id uuid, _feedback text, _surface text DEFAULT 'nino')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
  IF _feedback NOT IN ('useful','not_useful','dismiss') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_feedback');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.nino_intelligence_items WHERE id=_item_id AND user_id=v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  INSERT INTO public.nino_item_exposures (user_id, item_id, surface, feedback, outcome, shown_at)
  VALUES (v_uid, _item_id, _surface, _feedback, _feedback, now());

  IF _feedback = 'dismiss' THEN
    UPDATE public.nino_intelligence_items
       SET status='dismissed', dismissed_at=now(), updated_at=now()
     WHERE id=_item_id AND user_id=v_uid;
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION public.my_nino_item_feedback(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.my_nino_item_act(_item_id uuid, _surface text DEFAULT 'nino')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
  UPDATE public.nino_intelligence_items
     SET acted_at = COALESCE(acted_at, now()), updated_at = now()
   WHERE id=_item_id AND user_id=v_uid;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  INSERT INTO public.nino_item_exposures (user_id, item_id, surface, acted_at, outcome, shown_at)
  VALUES (v_uid, _item_id, _surface, now(), 'acted', now());
  RETURN jsonb_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION public.my_nino_item_act(uuid, text) TO authenticated;

-- ---------- TRILHA ADMIN ----------
CREATE OR REPLACE FUNCTION public.admin_v2_nino_item_trace(_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  PERFORM public._require_perm('audit.read');
  SELECT jsonb_build_object(
    'item', public.nino_item_json(i),
    'facts', COALESCE((SELECT jsonb_agg(to_jsonb(f)) FROM public.financial_insight_facts f
              WHERE f.id::text IN (SELECT jsonb_array_elements_text(i.facts))), '[]'::jsonb),
    'exposures', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at)
              FROM public.nino_item_exposures e WHERE e.item_id=i.id), '[]'::jsonb),
    'sources', jsonb_build_object('source', i.source, 'pattern_id', i.pattern_id,
              'opportunity_id', i.opportunity_id, 'review_id', i.review_id,
              'report_id', i.report_id, 'insight_id', i.insight_id, 'suggestion_id', i.suggestion_id)
  ) INTO v FROM public.nino_intelligence_items i WHERE i.id=_item_id;
  RETURN COALESCE(v, jsonb_build_object('error','not_found'));
END $$;
GRANT EXECUTE ON FUNCTION public.admin_v2_nino_item_trace(uuid) TO authenticated;