CREATE OR REPLACE FUNCTION public.nino_diagnosis_context_for_user(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v public.nino_diagnosis_snapshots;
BEGIN
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_user');
  END IF;

  SELECT * INTO v
  FROM public.nino_diagnosis_snapshots
  WHERE user_id = _user_id
    AND run_mode = 'live'
    AND is_current
  ORDER BY created_at DESC
  LIMIT 1;

  IF v.id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'contract', 'nino_diagnosis_contract.v1.1',
      'snapshot_id', null,
      'as_of', now(),
      'overall_state', 'insufficient_data',
      'primary_situation', null,
      'primary_action', null,
      'supporting_situations', '[]'::jsonb,
      'patterns', '[]'::jsonb,
      'anticipations', '[]'::jsonb,
      'operational_tasks', '[]'::jsonb,
      'timeline', '[]'::jsonb,
      'closings', '[]'::jsonb,
      'narrative', '{}'::jsonb,
      'forecast', '{}'::jsonb,
      'data_quality', '{}'::jsonb,
      'confidence', 0,
      'rationale', '{}'::jsonb,
      'snapshot_payload', '{}'::jsonb
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'contract', v.contract_version,
    'snapshot_id', v.id,
    'as_of', v.created_at,
    'overall_state', v.overall_state,
    'primary_situation', (
      SELECT to_jsonb(s) FROM public.financial_situations s WHERE s.id = v.primary_situation_id
    ),
    'primary_action', (
      SELECT to_jsonb(a) FROM public.financial_situation_actions a WHERE a.id = v.primary_action_id
    ),
    'supporting_situations', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY array_position(v.supporting_situation_ids, s.id))
      FROM public.financial_situations s
      WHERE s.id = ANY(v.supporting_situation_ids)
    ), '[]'::jsonb),
    'patterns', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY relevance_score DESC)
      FROM public.financial_situations s
      WHERE user_id = _user_id
        AND run_mode = 'live'
        AND situation_type = 'behavioral_pattern'
        AND status IN ('observed', 'confirmed', 'active')
    ), '[]'::jsonb),
    'anticipations', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY period_end)
      FROM public.financial_situations s
      WHERE user_id = _user_id
        AND run_mode = 'live'
        AND temporal_scope = 'future'
        AND status IN ('active', 'confirmed')
    ), '[]'::jsonb),
    'operational_tasks', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY relevance_score DESC)
      FROM public.financial_situations s
      WHERE user_id = _user_id
        AND run_mode = 'live'
        AND narrative_role = 'operational'
        AND status IN ('observed', 'active', 'confirmed')
    ), '[]'::jsonb),
    'timeline', COALESCE((
      SELECT jsonb_agg(x ORDER BY x->>'last_event_at' DESC)
      FROM (
        SELECT jsonb_build_object(
          'situation_id', s.id,
          'situation_key', s.situation_key,
          'headline', s.headline,
          'last_event_at', max(e.occurred_at),
          'events', jsonb_agg(to_jsonb(e) ORDER BY e.occurred_at DESC)
        ) x
        FROM public.financial_situations s
        JOIN public.financial_situation_events e ON e.situation_id = s.id
        WHERE s.user_id = _user_id
        GROUP BY s.id
        ORDER BY max(e.occurred_at) DESC
        LIMIT 20
      ) q
    ), '[]'::jsonb),
    'closings', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', id,
          'report_type', report_type,
          'period_start', period_start,
          'period_end', period_end,
          'summary', executive_summary,
          'closing_text', closing_text,
          'created_at', created_at
        ) ORDER BY period_end DESC
      )
      FROM public.financial_reports
      WHERE user_id = _user_id
        AND status IN ('generated', 'published')
    ), '[]'::jsonb),
    'narrative', COALESCE(v.payload->'narrative', '{}'::jsonb),
    'forecast', COALESCE(v.forecast, '{}'::jsonb),
    'data_quality', COALESCE(v.data_quality, '{}'::jsonb),
    'confidence', v.confidence,
    'rationale', COALESCE(v.rationale, '{}'::jsonb),
    'snapshot_payload', COALESCE(v.payload, '{}'::jsonb)
  );
END
$function$;

REVOKE ALL ON FUNCTION public.nino_diagnosis_context_for_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nino_diagnosis_context_for_user(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.my_nino_diagnosis_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_nino_diagnosis_context() TO authenticated;