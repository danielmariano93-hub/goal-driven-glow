-- =====================================================================
-- nino_screen_truth.v1
-- Uma única coleção editorial para badge, Home e tela do Nino.
-- Separa visibilidade de tela (dismiss explícito) de elegibilidade
-- proativa (cooldown de feedback), que continua intacta.
-- =====================================================================

-- 1) Visibilidade de tela: apenas o dismiss explícito esconde.
CREATE OR REPLACE FUNCTION public.nino_situation_screen_hidden_ids(_user_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
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
  WHERE lf.feedback = 'dismiss'
    AND lf.created_at > now() - CASE
      -- Risco crítico volta rápido mesmo após dispensa explícita.
      WHEN s.severity = 'critical' THEN interval '3 days'
      ELSE interval '90 days'
    END;
$function$;

-- 2) Coleção canônica de leituras exibíveis (a mesma para todas as superfícies).
CREATE OR REPLACE FUNCTION public.nino_screen_situations(_user_id uuid)
RETURNS TABLE (
  id uuid,
  situation_key text,
  situation_type text,
  status text,
  temporal_scope text,
  severity text,
  narrative_role text,
  relevance_score integer,
  headline text,
  created_at timestamptz,
  last_material_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH hidden AS (
    SELECT public.nino_situation_screen_hidden_ids(_user_id) AS ids
  ), eligible AS (
    SELECT
      s.id, s.situation_key, s.situation_type, s.status, s.temporal_scope,
      s.severity, s.narrative_role, s.relevance_score, s.headline, s.created_at,
      GREATEST(
        s.created_at,
        COALESCE((
          SELECT max(e.occurred_at)
          FROM public.financial_situation_events e
          WHERE e.situation_id = s.id
            AND e.event_type IN ('detected', 'improved', 'worsened')
        ), s.created_at)
      ) AS last_material_at,
      CASE s.severity WHEN 'critical' THEN 4 WHEN 'attention' THEN 3 WHEN 'positive' THEN 2 ELSE 1 END AS sev_weight
    FROM public.financial_situations s, hidden h
    WHERE s.user_id = _user_id
      AND s.run_mode = 'live'
      AND s.status IN ('observed', 'confirmed', 'active', 'improving', 'worsening')
      AND (s.valid_until IS NULL OR s.valid_until > now())
      AND NOT (s.id = ANY(h.ids))
  )
  SELECT DISTINCT ON (e.situation_type, e.headline)
    e.id, e.situation_key, e.situation_type, e.status, e.temporal_scope,
    e.severity, e.narrative_role, e.relevance_score, e.headline,
    e.created_at, e.last_material_at
  FROM eligible e
  ORDER BY e.situation_type, e.headline, e.sev_weight DESC, e.relevance_score DESC, e.created_at DESC;
$function$;

-- 3) Home/tela do Nino: cooldown proativo não esconde mais leitura válida.
CREATE OR REPLACE FUNCTION public.nino_home_context_for_user(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v public.nino_diagnosis_snapshots;
  v_cool uuid[] := '{}'::uuid[];
  v_hidden uuid[] := '{}'::uuid[];
  v_visible uuid[] := '{}'::uuid[];
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
      'proactive_cooldown_ids', '[]'::jsonb,
      'data_quality', '{}'::jsonb,
      'confidence', 0,
      'rationale', '{}'::jsonb
    );
  END IF;

  -- Cooldown proativo continua existindo, mas SÓ governa mensagem proativa.
  v_cool := public.nino_situation_cooldown_ids(_user_id);
  v_hidden := public.nino_situation_screen_hidden_ids(_user_id);
  SELECT COALESCE(array_agg(c.id), '{}'::uuid[]) INTO v_visible
  FROM public.nino_screen_situations(_user_id) c;

  SELECT to_jsonb(s) INTO v_primary
  FROM public.financial_situations s
  WHERE s.id = v.primary_situation_id
    AND s.id = ANY(v_visible);

  IF v_primary IS NULL THEN
    SELECT to_jsonb(s) INTO v_primary
    FROM public.financial_situations s
    WHERE s.id = ANY(COALESCE(v.supporting_situation_ids, '{}'::uuid[]))
      AND s.id = ANY(v_visible)
    ORDER BY
      CASE s.severity WHEN 'critical' THEN 4 WHEN 'attention' THEN 3 WHEN 'positive' THEN 2 ELSE 1 END DESC,
      s.relevance_score DESC
    LIMIT 1;
  END IF;

  -- Nada urgente só depois de esgotar a coleção canônica inteira.
  IF v_primary IS NULL THEN
    SELECT to_jsonb(s) INTO v_primary
    FROM public.financial_situations s
    WHERE s.id = ANY(v_visible)
      AND COALESCE(s.narrative_role, 'support') <> 'operational'
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
        WHERE s.id = ANY(v_visible)
          AND COALESCE(s.narrative_role, 'support') <> 'operational'
          AND (v_primary_id IS NULL OR s.id <> v_primary_id)
      ) q
    ), '[]'::jsonb),
    'patterns', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY relevance_score DESC)
      FROM public.financial_situations s
      WHERE s.id = ANY(v_visible)
        AND s.situation_type = 'behavioral_pattern'
    ), '[]'::jsonb),
    'anticipations', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY period_end)
      FROM public.financial_situations s
      WHERE s.id = ANY(v_visible)
        AND s.temporal_scope = 'future'
    ), '[]'::jsonb),
    'operational_tasks', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY relevance_score DESC)
      FROM public.financial_situations s
      WHERE s.id = ANY(v_visible)
        AND COALESCE(s.narrative_role, 'support') = 'operational'
    ), '[]'::jsonb),
    'suppressed_situation_ids', COALESCE(to_jsonb(v_hidden), '[]'::jsonb),
    'proactive_cooldown_ids', COALESCE(to_jsonb(v_cool), '[]'::jsonb),
    'data_quality', COALESCE(v.data_quality, '{}'::jsonb),
    'confidence', v.confidence,
    'rationale', COALESCE(v.rationale, '{}'::jsonb)
  );
END
$function$;

-- 4) Badge da aba Mais: mesma coleção canônica da tela do Nino.
CREATE OR REPLACE FUNCTION public.my_more_menu_context()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    -- Badge verdadeiro: conta exatamente o que a tela do Nino consegue mostrar.
    'nino', (
      SELECT jsonb_build_object(
        'active_items', COUNT(*),
        'new_since_last_visit', COUNT(*) FILTER (
          WHERE v_last_seen IS NULL OR c.last_material_at > v_last_seen),
        'attention_items', COUNT(*) FILTER (WHERE c.severity IN ('attention','critical'))
      )
      FROM public.nino_screen_situations(v_uid) c
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
END $function$;

-- 5) Guardrail de amostra para leitura de ritmo (fim do "dia 1").
CREATE OR REPLACE FUNCTION public.nino_diag_pace_sample_ok(
  _user_id uuid, _period_start date, _period_end date,
  _min_days int DEFAULT 5, _min_tx int DEFAULT 5
) RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT (_period_end - _period_start + 1) >= _min_days
     AND (
       SELECT COUNT(*) FROM public.transactions t
       WHERE t.user_id = _user_id
         AND t.status = 'confirmed'
         AND t.type = 'expense'
         AND COALESCE(t.movement_kind,'transaction') = 'transaction'
         AND t.occurred_at BETWEEN _period_start AND _period_end
     ) >= _min_tx;
$function$;
