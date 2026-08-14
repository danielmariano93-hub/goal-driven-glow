CREATE OR REPLACE FUNCTION public.nino_guard_legacy_proactive_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Compatibilidade: a função permanece para instalações antigas, mas a
  -- coordenação de fontes agora ocorre por dedup_key/logical_dedup_key.
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.nino_project_diagnosis_communications(_user_id uuid, _snapshot_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_count int := 0;
  v_action jsonb;
  v_communication_mode text;
BEGIN
  SELECT communication_mode INTO v_communication_mode
  FROM public.nino_diagnosis_config
  WHERE singleton = true;

  IF coalesce(v_communication_mode, 'disabled') = 'disabled' THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT s.*, a.title action_title, a.route action_route, a.action_type
    FROM public.financial_situations s
    JOIN public.financial_situation_actions a
      ON a.situation_id = s.id
     AND a.status IN ('proposed', 'accepted', 'in_progress')
    WHERE s.user_id = _user_id
      AND s.run_mode = 'live'
      AND s.status IN ('active', 'worsening', 'confirmed')
      AND s.confidence >= 0.70
      AND s.relevance_score >= 70
      AND (
        s.temporal_scope = 'future'
        OR s.severity = 'critical'
        OR s.situation_type = 'recurring_commitment_pressure'
      )
      AND (s.valid_until IS NULL OR s.valid_until > now())
    ORDER BY s.relevance_score DESC
    LIMIT 2
  LOOP
    v_action := jsonb_build_object(
      'label', r.action_title,
      'route', r.action_route,
      'type', r.action_type,
      'situation_id', r.id,
      'diagnosis_snapshot_id', _snapshot_id
    );

    INSERT INTO public.pending_proactive_suggestions (
      user_id, kind, severity, title, body, action, evidence,
      channel_ready, dedup_key, logical_dedup_key, status,
      expires_at, next_attempt_at
    ) VALUES (
      _user_id,
      r.situation_type,
      CASE r.severity
        WHEN 'critical' THEN 'critical'
        WHEN 'attention' THEN 'attention'
        ELSE 'info'
      END,
      r.headline,
      trim(coalesce(r.cause_summary, '') || CASE
        WHEN r.forecast_summary IS NOT NULL THEN ' ' || r.forecast_summary
        ELSE ''
      END),
      v_action,
      r.evaluation || jsonb_build_object(
        'situation_id', r.id,
        'diagnosis_snapshot_id', _snapshot_id
      ),
      'both',
      'diagnosis:' || r.situation_key,
      'diagnosis:' || r.situation_key,
      'pending',
      coalesce(r.valid_until, now() + interval '3 days'),
      now()
    )
    ON CONFLICT (user_id, dedup_key) DO UPDATE SET
      title = excluded.title,
      body = excluded.body,
      action = excluded.action,
      evidence = excluded.evidence,
      channel_ready = excluded.channel_ready,
      severity = excluded.severity,
      expires_at = excluded.expires_at,
      status = CASE
        WHEN public.pending_proactive_suggestions.status = 'dispatched' THEN 'dispatched'
        ELSE 'pending'
      END,
      next_attempt_at = CASE
        WHEN public.pending_proactive_suggestions.status = 'dispatched'
          THEN public.pending_proactive_suggestions.next_attempt_at
        ELSE now()
      END;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.nino_project_diagnosis_communications(uuid, uuid) FROM public, anon, authenticated;

UPDATE public.nino_diagnosis_config
SET communication_mode = 'full', updated_at = now()
WHERE singleton = true;

UPDATE public.pending_proactive_suggestions AS suggestion
SET status = 'pending',
    dismissed_at = NULL,
    dispatched_at = NULL,
    next_attempt_at = now(),
    defer_reason = NULL,
    channel_ready = 'both'
WHERE suggestion.status = 'dismissed'
  AND suggestion.defer_reason IN (
    'legacy_source_disabled_by_diagnosis_core_v1',
    'superseded_by_diagnosis_core_v1'
  )
  AND suggestion.created_at >= now() - interval '7 days'
  AND (suggestion.expires_at IS NULL OR suggestion.expires_at > now())
  AND suggestion.severity IN ('attention', 'critical')
  AND suggestion.kind IN (
    SELECT catalog.kind
    FROM public.communication_catalog AS catalog
    WHERE catalog.active = true
      AND 'whatsapp' = ANY(catalog.default_channels)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.communication_deliveries AS delivery
    WHERE delivery.suggestion_id = suggestion.id
      AND delivery.status IN ('queued', 'sent', 'delivered', 'acted')
  );