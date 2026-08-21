-- Nino Home Hot Path v3
-- =====================
-- Objetivo: remover do caminho crítico da Home os dois custos comprovados em
-- produção em 2026-08-21:
--   1) my_nino_diagnosis_context: ~6,06 MB por resposta no usuário pesado,
--      dos quais ~6,02 MB eram timeline não consumida pela Home;
--   2) passagem pela Edge Function mesmo quando o snapshot financeiro já
--      estava materializado ou presente no cache derivado versionado.
--
-- Esta migration NÃO altera fórmula financeira, ledger, saldo, classificação,
-- metas ou regras de negócio. Ela só cria/otimiza contratos de LEITURA.

-- O índice já existe hoje, mas o IF NOT EXISTS torna a migration segura em
-- ambientes onde ele ainda não tenha sido criado. A nova timeline filtra
-- explicitamente user_id para que o planner consiga usá-lo.
CREATE INDEX IF NOT EXISTS financial_situation_events_timeline_idx
  ON public.financial_situation_events (user_id, situation_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- 1) Contexto enxuto do Nino para a Home
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nino_home_context_for_user(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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
      'data_quality', '{}'::jsonb,
      'confidence', 0,
      'rationale', '{}'::jsonb
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'contract', v.contract_version,
    'surface_contract', 'nino_home_context.v1',
    'snapshot_id', v.id,
    'as_of', v.created_at,
    'overall_state', v.overall_state,
    'primary_situation', (
      SELECT to_jsonb(s)
      FROM public.financial_situations s
      WHERE s.id = v.primary_situation_id
    ),
    'primary_action', (
      SELECT to_jsonb(a)
      FROM public.financial_situation_actions a
      WHERE a.id = v.primary_action_id
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
    'data_quality', COALESCE(v.data_quality, '{}'::jsonb),
    'confidence', v.confidence,
    'rationale', COALESCE(v.rationale, '{}'::jsonb)
  );
END
$function$;

REVOKE ALL ON FUNCTION public.nino_home_context_for_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nino_home_context_for_user(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.my_nino_home_context()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;
  RETURN public.nino_home_context_for_user(v_uid);
END
$function$;

REVOKE ALL ON FUNCTION public.my_nino_home_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_nino_home_context() TO authenticated, service_role;
COMMENT ON FUNCTION public.my_nino_home_context() IS
  'Hot path da Home: diagnóstico sem timeline, closings ou snapshot_payload.';

-- ---------------------------------------------------------------------------
-- 2) Corrige o endpoint completo sem remover funcionalidade da página Nino.
--    A UI do Histórico usa somente events[0].narrative; portanto o servidor
--    retorna no máximo 20 situações e 1 evento recente por situação.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nino_diagnosis_context_for_user(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v public.nino_diagnosis_snapshots;
  v_base jsonb;
  v_timeline jsonb := '[]'::jsonb;
  v_closings jsonb := '[]'::jsonb;
BEGIN
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_user');
  END IF;

  v_base := public.nino_home_context_for_user(_user_id);

  SELECT * INTO v
  FROM public.nino_diagnosis_snapshots
  WHERE user_id = _user_id
    AND run_mode = 'live'
    AND is_current
  ORDER BY created_at DESC
  LIMIT 1;

  IF v.id IS NULL THEN
    RETURN (v_base - 'surface_contract') || jsonb_build_object(
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

  -- Primeiro escolhemos as 20 situações com evento mais recente usando um
  -- lookup indexado por situação. Só depois buscamos UM evento por situação.
  WITH recent_situations AS (
    SELECT
      s.id,
      s.situation_key,
      s.headline,
      latest.occurred_at AS last_event_at
    FROM public.financial_situations s
    JOIN LATERAL (
      SELECT e.occurred_at
      FROM public.financial_situation_events e
      WHERE e.user_id = _user_id
        AND e.situation_id = s.id
      ORDER BY e.occurred_at DESC
      LIMIT 1
    ) latest ON true
    WHERE s.user_id = _user_id
    ORDER BY latest.occurred_at DESC
    LIMIT 20
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'situation_id', rs.id,
        'situation_key', rs.situation_key,
        'headline', rs.headline,
        'last_event_at', rs.last_event_at,
        'events', COALESCE((
          SELECT jsonb_agg(to_jsonb(ev) ORDER BY ev.occurred_at DESC)
          FROM (
            SELECT e.*
            FROM public.financial_situation_events e
            WHERE e.user_id = _user_id
              AND e.situation_id = rs.id
            ORDER BY e.occurred_at DESC
            LIMIT 1
          ) ev
        ), '[]'::jsonb)
      )
      ORDER BY rs.last_event_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_timeline
  FROM recent_situations rs;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', q.id,
        'report_type', q.report_type,
        'period_start', q.period_start,
        'period_end', q.period_end,
        'summary', q.executive_summary,
        'closing_text', q.closing_text,
        'created_at', q.created_at
      )
      ORDER BY q.period_end DESC
    ),
    '[]'::jsonb
  )
  INTO v_closings
  FROM (
    SELECT
      id, report_type, period_start, period_end,
      executive_summary, closing_text, created_at
    FROM public.financial_reports
    WHERE user_id = _user_id
      AND status IN ('generated', 'published')
    ORDER BY period_end DESC
    LIMIT 12
  ) q;

  RETURN (v_base - 'surface_contract') || jsonb_build_object(
    'contract', v.contract_version,
    'timeline', v_timeline,
    'closings', v_closings,
    'narrative', COALESCE(v.payload->'narrative', '{}'::jsonb),
    'forecast', COALESCE(v.forecast, '{}'::jsonb),
    'data_quality', COALESCE(v.data_quality, '{}'::jsonb),
    'confidence', v.confidence,
    'rationale', COALESCE(v.rationale, '{}'::jsonb),
    'snapshot_payload', COALESCE(v.payload, '{}'::jsonb)
  );
END
$function$;

-- O helper completo continua restrito; clientes usam my_nino_diagnosis_context().
REVOKE ALL ON FUNCTION public.nino_diagnosis_context_for_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nino_diagnosis_context_for_user(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Hot path financeiro: MTD materializado + cache derivado de qualquer
--    período quente. Cache miss continua caindo no home-snapshot canônico.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_financial_home_snapshot(
  _start date,
  _end date,
  _today date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_snapshot public.financial_current_snapshots;
  v_cache public.financial_derived_cache;
  v_current_version bigint := 0;
  v_snapshot_version bigint := -1;
  v_local_today date := COALESCE(_today, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_period_start date;
  v_cache_key text;
  v_stale_response jsonb := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;
  IF _start IS NULL OR _end IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_period');
  END IF;

  SELECT COALESCE(version, 0)
  INTO v_current_version
  FROM public.financial_ledger_versions
  WHERE user_id = v_uid;
  v_current_version := COALESCE(v_current_version, 0);
  v_period_start := date_trunc('month', v_local_today)::date;

  -- MTD atual: read model proativo, disponível antes de qualquer abertura da Home.
  IF _start = v_period_start AND _end = v_local_today THEN
    SELECT * INTO v_snapshot
    FROM public.financial_current_snapshots
    WHERE user_id = v_uid
    LIMIT 1;

    IF v_snapshot.user_id IS NOT NULL
       AND v_snapshot.period_start = v_period_start
       AND v_snapshot.as_of_date = v_local_today
       AND v_snapshot.payload->'snapshot' IS NOT NULL THEN
      BEGIN
        v_snapshot_version := COALESCE((v_snapshot.payload->>'ledger_version')::bigint, -1);
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        v_snapshot_version := -1;
      END;

      IF v_snapshot_version = v_current_version THEN
        RETURN jsonb_build_object(
          'ok', true,
          'snapshot', v_snapshot.payload->'snapshot',
          'missing_sources', COALESCE(v_snapshot.payload->'missing_sources', '[]'::jsonb),
          'computed_at', v_snapshot.computed_at,
          'cache_hit', true,
          'freshness', 'fresh',
          'ledger_version', v_current_version,
          'read_path', 'materialized_current'
        );
      END IF;

      -- Guarda o último read model como fallback visual, mas ainda procura um
      -- derived cache da versão nova antes de devolver dado stale.
      v_stale_response := jsonb_build_object(
        'ok', true,
        'snapshot', v_snapshot.payload->'snapshot',
        'missing_sources', COALESCE(v_snapshot.payload->'missing_sources', '[]'::jsonb),
        'computed_at', v_snapshot.computed_at,
        'cache_hit', true,
        'freshness', 'stale_recomputing',
        'ledger_version', v_current_version,
        'read_path', 'materialized_current_stale'
      );
    END IF;
  END IF;

  -- Qualquer período já calculado pode ser servido pelo cache derivado, desde
  -- que a versão corresponda exatamente ao ledger atual.
  v_cache_key := format(
    'home_snapshot_v2|%s|%s|%s',
    _start::text,
    _end::text,
    v_local_today::text
  );

  SELECT * INTO v_cache
  FROM public.financial_derived_cache
  WHERE user_id = v_uid
    AND cache_key = v_cache_key
  LIMIT 1;

  IF v_cache.user_id IS NOT NULL
     AND v_cache.ledger_version = v_current_version
     AND v_cache.payload->'snapshot' IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'snapshot', v_cache.payload->'snapshot',
      'missing_sources', COALESCE(v_cache.payload->'missing_sources', '[]'::jsonb),
      'computed_at', v_cache.computed_at,
      'cache_hit', true,
      'freshness', 'fresh',
      'ledger_version', v_current_version,
      'read_path', 'derived_cache'
    );
  END IF;

  IF v_stale_response IS NOT NULL THEN
    RETURN v_stale_response;
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'snapshot_cache_miss');
END
$function$;

REVOKE ALL ON FUNCTION public.my_financial_home_snapshot(date, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_financial_home_snapshot(date, date, date) TO authenticated, service_role;
COMMENT ON FUNCTION public.my_financial_home_snapshot(date, date, date) IS
  'Hot path O(1) da Home: read model MTD ou cache derivado versionado; nunca recalcula ledger.';
