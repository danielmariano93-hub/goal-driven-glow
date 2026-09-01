DROP FUNCTION IF EXISTS public.admin_nino_learning_overview(uuid, integer);

CREATE OR REPLACE FUNCTION public.admin_nino_learning_overview(_user_id uuid DEFAULT NULL, _days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_days int := greatest(1, least(180, coalesce(_days, 30)));
  v_since timestamptz := now() - make_interval(days => v_days);
  v_events int; v_runs int; v_last timestamptz; v_backfill int;
  v_health text; v_reason text;
BEGIN
  PERFORM public._require_perm('cockpit.read');

  SELECT count(*), max(occurred_at) INTO v_events, v_last
  FROM public.nino_learning_events
  WHERE (_user_id IS NULL OR user_id = _user_id) AND occurred_at >= v_since;

  SELECT count(*) INTO v_runs
  FROM public.agent_runs
  WHERE (_user_id IS NULL OR user_id = _user_id) AND started_at >= v_since;

  SELECT count(*) INTO v_backfill
  FROM public.nino_learning_events
  WHERE (_user_id IS NULL OR user_id = _user_id) AND source = 'agent_memory_backfill';

  IF v_runs > 3 AND v_events = 0 THEN
    v_health := 'attention';
    v_reason := 'Há conversas no período, mas nenhum evento de aprendizado foi registrado.';
  ELSIF v_events = 0 THEN
    v_health := 'warming_up';
    v_reason := 'Ainda sem eventos no recorte.';
  ELSE
    v_health := 'healthy';
    v_reason := 'Aprendizado sendo registrado e aplicado.';
  END IF;

  RETURN jsonb_build_object(
    'period_days', v_days,
    'contract_version', 'nino_learning_overview.v4',
    'scope', CASE WHEN _user_id IS NULL THEN 'global' ELSE 'user' END,
    'totals', jsonb_build_object(
      'events', v_events,
      'applied', (SELECT count(*) FROM public.nino_learning_events
                  WHERE (_user_id IS NULL OR user_id = _user_id) AND occurred_at >= v_since AND applied),
      'corrections', (SELECT count(*) FROM public.nino_learning_events
                      WHERE (_user_id IS NULL OR user_id = _user_id) AND occurred_at >= v_since AND event_type = 'correction'),
      'dismissals', (SELECT count(*) FROM public.nino_learning_events
                     WHERE (_user_id IS NULL OR user_id = _user_id) AND occurred_at >= v_since AND event_type = 'change_dismissal'),
      'commitments', (SELECT count(*) FROM public.nino_change_commitments
                      WHERE (_user_id IS NULL OR user_id = _user_id) AND accepted_at >= v_since),
      'checkins', (SELECT count(*) FROM public.nino_change_checkins
                   WHERE (_user_id IS NULL OR user_id = _user_id) AND created_at >= v_since),
      'delivered_checkins', (SELECT count(*) FROM public.nino_change_checkins
                             WHERE (_user_id IS NULL OR user_id = _user_id) AND created_at >= v_since AND communicated),
      'memory_items', (SELECT count(*) FROM public.agent_memory WHERE (_user_id IS NULL OR user_id = _user_id)),
      'backfilled_events', v_backfill,
      'learning_users', (SELECT count(DISTINCT user_id) FROM public.nino_learning_events
                         WHERE (_user_id IS NULL OR user_id = _user_id) AND occurred_at >= v_since),
      'active_commitments', (SELECT count(*) FROM public.nino_change_commitments
                             WHERE (_user_id IS NULL OR user_id = _user_id) AND status = 'active'),
      'paused_commitments', (SELECT count(*) FROM public.nino_change_commitments
                             WHERE (_user_id IS NULL OR user_id = _user_id) AND status = 'paused'),
      'completed_commitments', (SELECT count(*) FROM public.nino_change_commitments
                                WHERE (_user_id IS NULL OR user_id = _user_id) AND status = 'completed'),
      'cancelled_commitments', (SELECT count(*) FROM public.nino_change_commitments
                                WHERE (_user_id IS NULL OR user_id = _user_id) AND status = 'cancelled'),
      'recent_agent_runs', v_runs
    ),
    'current_strategy', CASE WHEN _user_id IS NULL THEN NULL ELSE (
      SELECT jsonb_build_object('strategy', strategy, 'strategy_reason', strategy_reason,
                                'stage', stage, 'title', title, 'last_outcome', last_outcome,
                                'intervention_attempts', intervention_attempts,
                                'dismissals', dismissals,
                                'next_check_at', next_check_at)
      FROM public.nino_change_commitments
      WHERE user_id = _user_id AND status = 'active'
      ORDER BY accepted_at DESC LIMIT 1) END,
    'by_type', coalesce((
      SELECT jsonb_agg(jsonb_build_object('event_type', event_type, 'total', total, 'applied', applied_count)
             ORDER BY total DESC)
      FROM (SELECT event_type, count(*) AS total, count(*) FILTER (WHERE applied) AS applied_count
            FROM public.nino_learning_events
            WHERE (_user_id IS NULL OR user_id = _user_id) AND occurred_at >= v_since
            GROUP BY event_type) t), '[]'::jsonb),
    'by_strategy', coalesce((
      SELECT jsonb_agg(jsonb_build_object('strategy', strategy, 'total', total, 'success', success)
             ORDER BY total DESC)
      FROM (SELECT strategy, count(*) AS total,
                   count(*) FILTER (WHERE outcome IN ('completed','progress')) AS success
            FROM public.nino_change_checkins
            WHERE (_user_id IS NULL OR user_id = _user_id) AND created_at >= v_since AND strategy IS NOT NULL
            GROUP BY strategy) s), '[]'::jsonb),
    'by_principle', coalesce((
      SELECT jsonb_agg(jsonb_build_object('principle', principle, 'total', total, 'success', success)
             ORDER BY total DESC)
      FROM (SELECT principle, count(*) AS total,
                   count(*) FILTER (WHERE outcome IN ('completed','progress')) AS success
            FROM public.nino_change_checkins
            WHERE (_user_id IS NULL OR user_id = _user_id) AND created_at >= v_since AND principle IS NOT NULL
            GROUP BY principle) p), '[]'::jsonb),
    'by_recommendation_source', coalesce((
      SELECT jsonb_agg(jsonb_build_object('source', source, 'total', total, 'accepted', accepted)
             ORDER BY total DESC)
      FROM (SELECT source, count(*) AS total,
                   count(*) FILTER (WHERE status = 'accepted') AS accepted
            FROM public.nino_change_recommendations
            WHERE (_user_id IS NULL OR user_id = _user_id) AND created_at >= v_since
            GROUP BY source) r), '[]'::jsonb),
    'top_users', CASE WHEN _user_id IS NOT NULL THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(jsonb_build_object('pseudo_id', pseudo_id, 'events', events,
                                          'corrections', corrections, 'last_at', last_at)
             ORDER BY events DESC)
      FROM (
        SELECT coalesce(p.pseudonym, left(e.user_id::text, 8)) AS pseudo_id,
               count(*) AS events,
               count(*) FILTER (WHERE e.event_type = 'correction') AS corrections,
               max(e.occurred_at) AS last_at
        FROM public.nino_learning_events e
        LEFT JOIN public.user_pseudonyms p ON p.user_id = e.user_id
        WHERE e.occurred_at >= v_since
        GROUP BY 1
        ORDER BY count(*) DESC
        LIMIT 10) u), '[]'::jsonb) END,
    'recent', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', id, 'occurred_at', occurred_at, 'event_type', event_type,
                                          'source', source, 'signal', signal, 'subject_key', subject_key,
                                          'confidence', confidence, 'applied', applied) ORDER BY occurred_at DESC)
      FROM (SELECT * FROM public.nino_learning_events
            WHERE (_user_id IS NULL OR user_id = _user_id) AND occurred_at >= v_since
            ORDER BY occurred_at DESC LIMIT 20) e), '[]'::jsonb),
    'last_learned_at', v_last,
    'health', v_health,
    'health_reason', v_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_nino_learning_overview(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_nino_learning_overview(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_nino_learning_overview(uuid, integer) TO service_role;