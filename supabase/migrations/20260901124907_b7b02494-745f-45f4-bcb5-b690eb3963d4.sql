ALTER TABLE public.nino_change_checkins
  ADD COLUMN IF NOT EXISTS strategy text,
  ADD COLUMN IF NOT EXISTS principle text;

ALTER TABLE public.nino_change_checkins
  DROP CONSTRAINT IF EXISTS nino_change_checkins_strategy_chk,
  DROP CONSTRAINT IF EXISTS nino_change_checkins_outcome_chk,
  DROP CONSTRAINT IF EXISTS nino_change_checkins_score_chk,
  DROP CONSTRAINT IF EXISTS nino_change_checkins_channel_chk;

ALTER TABLE public.nino_change_checkins
  ADD CONSTRAINT nino_change_checkins_strategy_chk
    CHECK (strategy IS NULL OR strategy IN ('reinforce','remind','reframe','pause')),
  ADD CONSTRAINT nino_change_checkins_outcome_chk
    CHECK (outcome IN ('completed','progress','stalled','regressed','no_evidence')),
  ADD CONSTRAINT nino_change_checkins_score_chk
    CHECK (progress_score IS NULL OR (progress_score >= 0 AND progress_score <= 1)),
  ADD CONSTRAINT nino_change_checkins_channel_chk
    CHECK (channel IS NULL OR channel IN ('app','whatsapp','both','push','email'));

CREATE INDEX IF NOT EXISTS nino_change_checkins_user_delivered_idx
  ON public.nino_change_checkins (user_id, delivered_at DESC);

DROP FUNCTION IF EXISTS public.admin_v3_ai_history(date,date,text,text,text,text,text);

CREATE OR REPLACE FUNCTION public.admin_nino_learning_overview(_user_id uuid, _days integer DEFAULT 30)
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
  FROM public.nino_learning_events WHERE user_id = _user_id AND occurred_at >= v_since;

  SELECT count(*) INTO v_runs
  FROM public.agent_runs WHERE user_id = _user_id AND started_at >= v_since;

  SELECT count(*) INTO v_backfill
  FROM public.nino_learning_events
  WHERE user_id = _user_id AND source = 'agent_memory_backfill';

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
    'contract_version', 'nino_learning_overview.v3',
    'totals', jsonb_build_object(
      'events', v_events,
      'applied', (SELECT count(*) FROM public.nino_learning_events
                  WHERE user_id = _user_id AND occurred_at >= v_since AND applied),
      'corrections', (SELECT count(*) FROM public.nino_learning_events
                      WHERE user_id = _user_id AND occurred_at >= v_since AND event_type = 'correction'),
      'dismissals', (SELECT count(*) FROM public.nino_learning_events
                     WHERE user_id = _user_id AND occurred_at >= v_since AND event_type = 'change_dismissal'),
      'commitments', (SELECT count(*) FROM public.nino_change_commitments
                      WHERE user_id = _user_id AND accepted_at >= v_since),
      'checkins', (SELECT count(*) FROM public.nino_change_checkins
                   WHERE user_id = _user_id AND created_at >= v_since),
      'delivered_checkins', (SELECT count(*) FROM public.nino_change_checkins
                             WHERE user_id = _user_id AND created_at >= v_since AND communicated),
      'memory_items', (SELECT count(*) FROM public.agent_memory WHERE user_id = _user_id),
      'backfilled_events', v_backfill,
      'active_commitments', (SELECT count(*) FROM public.nino_change_commitments
                             WHERE user_id = _user_id AND status = 'active'),
      'paused_commitments', (SELECT count(*) FROM public.nino_change_commitments
                             WHERE user_id = _user_id AND status = 'paused'),
      'completed_commitments', (SELECT count(*) FROM public.nino_change_commitments
                                WHERE user_id = _user_id AND status = 'completed'),
      'cancelled_commitments', (SELECT count(*) FROM public.nino_change_commitments
                                WHERE user_id = _user_id AND status = 'cancelled'),
      'recent_agent_runs', v_runs
    ),
    'current_strategy', (
      SELECT jsonb_build_object('strategy', strategy, 'strategy_reason', strategy_reason,
                                'stage', stage, 'title', title, 'last_outcome', last_outcome,
                                'intervention_attempts', intervention_attempts,
                                'dismissals', dismissals,
                                'next_check_at', next_check_at)
      FROM public.nino_change_commitments
      WHERE user_id = _user_id AND status = 'active'
      ORDER BY accepted_at DESC LIMIT 1),
    'by_type', coalesce((
      SELECT jsonb_agg(jsonb_build_object('event_type', event_type, 'total', total, 'applied', applied_count)
             ORDER BY total DESC)
      FROM (SELECT event_type, count(*) AS total, count(*) FILTER (WHERE applied) AS applied_count
            FROM public.nino_learning_events
            WHERE user_id = _user_id AND occurred_at >= v_since
            GROUP BY event_type) t), '[]'::jsonb),
    'by_strategy', coalesce((
      SELECT jsonb_agg(jsonb_build_object('strategy', strategy, 'total', total, 'success', success)
             ORDER BY total DESC)
      FROM (SELECT strategy, count(*) AS total,
                   count(*) FILTER (WHERE outcome IN ('completed','progress')) AS success
            FROM public.nino_change_checkins
            WHERE user_id = _user_id AND created_at >= v_since AND strategy IS NOT NULL
            GROUP BY strategy) s), '[]'::jsonb),
    'by_principle', coalesce((
      SELECT jsonb_agg(jsonb_build_object('principle', principle, 'total', total, 'success', success)
             ORDER BY total DESC)
      FROM (SELECT principle, count(*) AS total,
                   count(*) FILTER (WHERE outcome IN ('completed','progress')) AS success
            FROM public.nino_change_checkins
            WHERE user_id = _user_id AND created_at >= v_since AND principle IS NOT NULL
            GROUP BY principle) p), '[]'::jsonb),
    'by_recommendation_source', coalesce((
      SELECT jsonb_agg(jsonb_build_object('source', source, 'total', total, 'accepted', accepted)
             ORDER BY total DESC)
      FROM (SELECT source, count(*) AS total,
                   count(*) FILTER (WHERE status = 'accepted') AS accepted
            FROM public.nino_change_recommendations
            WHERE user_id = _user_id AND created_at >= v_since
            GROUP BY source) r), '[]'::jsonb),
    'recent', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', id, 'occurred_at', occurred_at, 'event_type', event_type,
                                          'source', source, 'signal', signal, 'subject_key', subject_key,
                                          'confidence', confidence, 'applied', applied) ORDER BY occurred_at DESC)
      FROM (SELECT * FROM public.nino_learning_events
            WHERE user_id = _user_id AND occurred_at >= v_since
            ORDER BY occurred_at DESC LIMIT 20) e), '[]'::jsonb),
    'last_learned_at', v_last,
    'health', v_health,
    'health_reason', v_reason
  );
END;
$function$;