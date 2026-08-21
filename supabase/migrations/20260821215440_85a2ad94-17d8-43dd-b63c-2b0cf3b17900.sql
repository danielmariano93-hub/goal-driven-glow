CREATE OR REPLACE FUNCTION public.my_nino_item_feedback(
  _item_id uuid,
  _feedback text,
  _surface text DEFAULT 'nino'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
declare v_uid uuid:=auth.uid(); v_situation_id uuid; v_opportunity_id uuid;
begin
  if v_uid is null then return jsonb_build_object('ok',false,'error','unauthenticated'); end if;
  if _feedback not in ('useful','not_useful','dismiss') then
    return jsonb_build_object('ok',false,'error','invalid_feedback');
  end if;
  select nullif(evidence->>'situation_id','')::uuid,
         nullif(evidence->>'opportunity_id','')::uuid
    into v_situation_id,v_opportunity_id
    from public.nino_intelligence_items where id=_item_id and user_id=v_uid;
  if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;

  insert into public.nino_item_exposures(user_id,item_id,surface,feedback,outcome,shown_at)
  values(v_uid,_item_id,_surface,_feedback,_feedback,now());

  if v_situation_id is not null then
    insert into public.financial_situation_feedback(user_id,situation_id,item_id,surface,feedback)
    values(v_uid,v_situation_id,_item_id,_surface,_feedback);
  end if;
  if v_opportunity_id is not null then
    update public.anticipation_outcomes
       set user_feedback=_feedback, interacted=true, updated_at=now()
     where user_id=v_uid and opportunity_id=v_opportunity_id;
  end if;

  if _feedback='dismiss' then
    update public.nino_intelligence_items
       set status='dismissed',dismissed_at=now(),updated_at=now()
     where id=_item_id and user_id=v_uid;
    if v_situation_id is not null then
      update public.financial_situations
         set status='suppressed',resolved_at=now(),updated_at=now()
       where id=v_situation_id and user_id=v_uid;
      update public.financial_situation_actions
         set status='dismissed',updated_at=now()
       where situation_id=v_situation_id and status in ('proposed','accepted','in_progress');
    end if;
  else
    -- Leitura respondida sai da vez: o item deixa de ser 'active' e as superfícies
    -- passam a mostrar outras leituras. Nada é apagado: o histórico permanece em
    -- nino_item_exposures / financial_situation_feedback.
    update public.nino_intelligence_items
       set status='archived', updated_at=now()
     where id=_item_id and user_id=v_uid and status='active';
  end if;

  return jsonb_build_object('ok',true,'situation_id',v_situation_id);
end
$function$;

CREATE OR REPLACE FUNCTION public.nino_situation_cooldown_ids(_user_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH last_fb AS (
    SELECT DISTINCT ON (f.situation_id)
      f.situation_id, f.feedback, f.created_at
    FROM public.financial_situation_feedback f
    WHERE f.user_id = _user_id
    ORDER BY f.situation_id, f.created_at DESC
  )
  SELECT COALESCE(array_agg(lf.situation_id), '{}'::uuid[])
  FROM last_fb lf
  JOIN public.financial_situations s ON s.id = lf.situation_id
  WHERE s.severity <> 'critical'
    AND lf.created_at > now() - CASE lf.feedback
        WHEN 'not_useful' THEN interval '30 days'
        WHEN 'useful' THEN interval '7 days'
        WHEN 'acted' THEN interval '14 days'
        WHEN 'dismiss' THEN interval '90 days'
        ELSE interval '7 days'
      END;
$function$;

REVOKE ALL ON FUNCTION public.nino_situation_cooldown_ids(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nino_situation_cooldown_ids(uuid) TO service_role;
COMMENT ON FUNCTION public.nino_situation_cooldown_ids(uuid) IS
  'Situacoes ja respondidas pelo usuario dentro da janela de cooldown. Severidade critica nunca entra em cooldown.';

CREATE OR REPLACE FUNCTION public.nino_home_context_for_user(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v public.nino_diagnosis_snapshots;
  v_cool uuid[] := '{}'::uuid[];
  v_primary jsonb;
  v_primary_id uuid;
  v_action jsonb;
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
      'surface_contract', 'nino_home_context.v1',
      'snapshot_id', null,
      'as_of', now(),
      'overall_state', 'insufficient_data',
      'primary_situation', null,
      'primary_action', null,
      'supporting_situations', '[]'::jsonb,
      'patterns', '[]'::jsonb,
      'anticipations', '[]'::jsonb,
      'operational_tasks', '[]'::jsonb,
      'suppressed_situation_ids', '[]'::jsonb,
      'data_quality', '{}'::jsonb,
      'confidence', 0,
      'rationale', '{}'::jsonb
    );
  END IF;

  v_cool := public.nino_situation_cooldown_ids(_user_id);

  SELECT to_jsonb(s) INTO v_primary
  FROM public.financial_situations s
  WHERE s.id = v.primary_situation_id
    AND NOT (s.id = ANY(v_cool));

  IF v_primary IS NULL THEN
    SELECT to_jsonb(s) INTO v_primary
    FROM public.financial_situations s
    WHERE s.id = ANY(COALESCE(v.supporting_situation_ids, '{}'::uuid[]))
      AND NOT (s.id = ANY(v_cool))
      AND s.status NOT IN ('resolved', 'expired', 'suppressed')
    ORDER BY
      CASE s.severity WHEN 'critical' THEN 4 WHEN 'attention' THEN 3 WHEN 'positive' THEN 2 ELSE 1 END DESC,
      s.relevance_score DESC
    LIMIT 1;
  END IF;

  v_primary_id := NULLIF(v_primary->>'id', '')::uuid;

  SELECT to_jsonb(a) INTO v_action
  FROM public.financial_situation_actions a
  WHERE a.id = v.primary_action_id
    AND v_primary_id IS NOT NULL
    AND a.situation_id = v_primary_id;

  RETURN jsonb_build_object(
    'ok', true,
    'contract', v.contract_version,
    'surface_contract', 'nino_home_context.v1',
    'snapshot_id', v.id,
    'as_of', v.created_at,
    'overall_state', v.overall_state,
    'primary_situation', v_primary,
    'primary_action', v_action,
    'supporting_situations', COALESCE((
      SELECT jsonb_agg((to_jsonb(q) - 'rn_type') - 'sev_weight' ORDER BY q.rn_type, q.sev_weight DESC, q.relevance_score DESC)
      FROM (
        SELECT s.*,
          row_number() OVER (
            PARTITION BY s.situation_type
            ORDER BY
              CASE s.severity WHEN 'critical' THEN 4 WHEN 'attention' THEN 3 WHEN 'positive' THEN 2 ELSE 1 END DESC,
              s.relevance_score DESC
          ) AS rn_type,
          CASE s.severity WHEN 'critical' THEN 4 WHEN 'attention' THEN 3 WHEN 'positive' THEN 2 ELSE 1 END AS sev_weight
        FROM public.financial_situations s
        WHERE s.id = ANY(COALESCE(v.supporting_situation_ids, '{}'::uuid[]))
          AND NOT (s.id = ANY(v_cool))
          AND (v_primary_id IS NULL OR s.id <> v_primary_id)
      ) q
    ), '[]'::jsonb),
    'patterns', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY relevance_score DESC)
      FROM public.financial_situations s
      WHERE user_id = _user_id
        AND run_mode = 'live'
        AND situation_type = 'behavioral_pattern'
        AND status IN ('observed', 'confirmed', 'active')
        AND NOT (s.id = ANY(v_cool))
    ), '[]'::jsonb),
    'anticipations', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY period_end)
      FROM public.financial_situations s
      WHERE user_id = _user_id
        AND run_mode = 'live'
        AND temporal_scope = 'future'
        AND status IN ('active', 'confirmed')
        AND NOT (s.id = ANY(v_cool))
    ), '[]'::jsonb),
    'operational_tasks', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY relevance_score DESC)
      FROM public.financial_situations s
      WHERE user_id = _user_id
        AND run_mode = 'live'
        AND narrative_role = 'operational'
        AND status IN ('observed', 'active', 'confirmed')
        AND NOT (s.id = ANY(v_cool))
    ), '[]'::jsonb),
    'suppressed_situation_ids', COALESCE(to_jsonb(v_cool), '[]'::jsonb),
    'data_quality', COALESCE(v.data_quality, '{}'::jsonb),
    'confidence', v.confidence,
    'rationale', COALESCE(v.rationale, '{}'::jsonb)
  );
END
$function$;

REVOKE ALL ON FUNCTION public.nino_home_context_for_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nino_home_context_for_user(uuid) TO service_role;
COMMENT ON FUNCTION public.nino_home_context_for_user(uuid) IS
  'Hot path da Home: diagnostico enxuto, sem leituras em cooldown e com apoio intercalado por tipo.';