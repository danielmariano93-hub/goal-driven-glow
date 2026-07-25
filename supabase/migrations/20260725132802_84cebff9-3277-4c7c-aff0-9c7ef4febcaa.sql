-- =========================================================================
-- Onda B: Taxonomia, daily_evolution v2, contrato de período em RPCs-chave
-- ROLLBACK (resumo): DROP as funções novas + reaplicar dumps das anteriores.
-- =========================================================================

-- ============================================================
-- M4: Funções auxiliares de taxonomia canônica
-- ============================================================
CREATE OR REPLACE FUNCTION public.activity_events()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT ARRAY[
    'financial_entry_created','financial_entry_edited','financial_entry_categorized',
    'goal_created','goal_progress_recorded',
    'split_created','split_participant_paid',
    'ocr_document_uploaded','ocr_document_confirmed'
  ]::text[];
$$;

CREATE OR REPLACE FUNCTION public.value_events()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT ARRAY[
    'goal_progress_recorded','split_participant_paid',
    'ocr_document_confirmed','financial_entry_created'
  ]::text[];
$$;

REVOKE ALL ON FUNCTION public.activity_events() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.value_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activity_events() TO service_role;
GRANT EXECUTE ON FUNCTION public.value_events() TO service_role;

-- ============================================================
-- M5: admin_v2_daily_evolution v2 (contrato _from,_to,_tz)
-- Implementa dormant_transition.v1 e activation.v1 (primeira ação da vida)
-- ============================================================
DROP FUNCTION IF EXISTS public.admin_v2_daily_evolution(date, date);

CREATE OR REPLACE FUNCTION public.admin_v2_daily_evolution(
  _from date,
  _to date,
  _tz text DEFAULT 'America/Sao_Paulo'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text := coalesce(_tz, 'America/Sao_Paulo');
  v_from date := coalesce(_from, ((now() AT TIME ZONE v_tz)::date - 29));
  v_to date := coalesce(_to, (now() AT TIME ZONE v_tz)::date);
  v_sample int;
  v_activity text[] := public.activity_events();
BEGIN
  PERFORM public._require_perm('cockpit.read');
  IF (v_to - v_from) > 365 THEN
    RAISE EXCEPTION 'invalid_parameter_value: range excede 365 dias';
  END IF;
  IF v_to < v_from THEN
    RAISE EXCEPTION 'invalid_parameter_value: _to menor que _from';
  END IF;

  SELECT count(*)::int INTO v_sample FROM public.v_client_users;

  RETURN jsonb_build_object(
    'series', (
      SELECT coalesce(jsonb_agg(row_to_json(x) ORDER BY x.day),'[]'::jsonb)
      FROM (
        WITH days AS (
          SELECT generate_series(v_from, v_to, '1 day'::interval)::date AS day
        ),
        -- Eventos de atividade dos clientes reais, bucketizados no TZ pedido
        sig AS (
          SELECT
            e.pseudo_id,
            (e.occurred_at AT TIME ZONE v_tz)::date AS d,
            e.occurred_at,
            e.event_name
          FROM public.product_events e
          JOIN public.v_client_pseudonyms cp ON cp.pseudo_id = e.pseudo_id
          WHERE e.event_name = ANY (v_activity)
            AND e.event_source = 'live'
        ),
        -- Primeira ação significativa da VIDA de cada cliente
        first_sig AS (
          SELECT pseudo_id, min(d) AS first_d
          FROM sig
          GROUP BY pseudo_id
        ),
        -- Última atividade de cada cliente até (e inclusive) cada dia D:
        -- Para dormant_transition usamos o dia da última atividade antes de D
        last_act_per_day AS (
          SELECT
            d.day,
            s.pseudo_id,
            max(s.d) AS last_active_d
          FROM days d
          JOIN sig s ON s.d <= d.day
          GROUP BY d.day, s.pseudo_id
        )
        SELECT
          d.day,
          (SELECT count(*)::int FROM public.v_client_users v
             WHERE (v.registered_at AT TIME ZONE v_tz)::date = d.day) AS new_clients,
          (SELECT count(*)::int FROM first_sig fs
             WHERE fs.first_d = d.day) AS activated,
          (SELECT count(distinct s.pseudo_id)::int FROM sig s
             WHERE s.d = d.day) AS active_unique,
          -- went_dormant(D) = clientes cuja última atividade até D é exatamente D-14
          -- (transição atinge 14 dias exatos em D e nenhuma atividade em [D-13, D])
          (SELECT count(*)::int FROM last_act_per_day lap
             WHERE lap.day = d.day AND lap.last_active_d = d.day - 14) AS went_dormant,
          (SELECT count(*)::int FROM public.v_client_users v
             WHERE (v.registered_at AT TIME ZONE v_tz)::date <= d.day) AS cumulative_clients,
          (SELECT count(distinct t.user_id)::int FROM public.transactions t
             JOIN public.v_client_users v ON v.user_id = t.user_id
             WHERE (t.created_at AT TIME ZONE v_tz)::date = d.day
               AND NOT EXISTS (
                 SELECT 1 FROM public.transactions t2
                 WHERE t2.user_id = t.user_id
                   AND (t2.created_at AT TIME ZONE v_tz)::date < d.day
               )) AS first_financial_action
        FROM days d
      ) x
    ),
    'totals', jsonb_build_object(
      'new_clients', (SELECT count(*)::int FROM public.v_client_users v
        WHERE (v.registered_at AT TIME ZONE v_tz)::date BETWEEN v_from AND v_to),
      'activated_period', (
        SELECT count(*)::int FROM (
          SELECT pseudo_id, min((e.occurred_at AT TIME ZONE v_tz)::date) AS first_d
          FROM public.product_events e
          JOIN public.v_client_pseudonyms cp ON cp.pseudo_id = e.pseudo_id
          WHERE e.event_name = ANY (v_activity) AND e.event_source = 'live'
          GROUP BY pseudo_id
        ) fs WHERE fs.first_d BETWEEN v_from AND v_to
      )
    ),
    'period', jsonb_build_object('from', v_from, 'to', v_to, 'timezone', v_tz),
    'sample_size', v_sample,
    'sufficient_sample', v_sample >= 10,
    'formula_version', 'daily.evolution.v2',
    'universe','clients_only',
    'measured_at', now()
  );
END; $$;

-- ============================================================
-- M3-A: admin_v2_growth_summary(_from,_to,_tz) — substitui (_days)
-- Usa activity_events() e universo canônico
-- ============================================================
DROP FUNCTION IF EXISTS public.admin_v2_growth_summary(integer);

CREATE OR REPLACE FUNCTION public.admin_v2_growth_summary(
  _from date,
  _to date,
  _tz text DEFAULT 'America/Sao_Paulo'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text := coalesce(_tz, 'America/Sao_Paulo');
  v_from date := coalesce(_from, ((now() AT TIME ZONE v_tz)::date - 29));
  v_to date := coalesce(_to, (now() AT TIME ZONE v_tz)::date);
  v_start timestamptz;
  v_end timestamptz;
  v_activity text[] := public.activity_events();
BEGIN
  PERFORM public._require_perm('growth.read');
  IF (v_to - v_from) > 365 THEN
    RAISE EXCEPTION 'invalid_parameter_value: range excede 365 dias';
  END IF;
  IF v_to < v_from THEN
    RAISE EXCEPTION 'invalid_parameter_value: _to menor que _from';
  END IF;
  v_start := (v_from::text || ' 00:00:00')::timestamp AT TIME ZONE v_tz;
  v_end   := ((v_to + 1)::text || ' 00:00:00')::timestamp AT TIME ZONE v_tz;

  RETURN jsonb_build_object(
    -- Estoque atual (não reage ao filtro)
    'total_clients', (SELECT count(*)::int FROM public.v_client_users),
    -- Fluxo no período
    'new_clients', (SELECT count(*)::int FROM public.v_client_users v
      WHERE v.registered_at >= v_start AND v.registered_at < v_end),
    'active_clients', (SELECT count(distinct e.pseudo_id)::int
      FROM public.product_events e
      JOIN public.v_client_pseudonyms cp ON cp.pseudo_id = e.pseudo_id
      WHERE e.occurred_at >= v_start AND e.occurred_at < v_end
        AND e.event_name = ANY (v_activity)
        AND e.event_source = 'live'),
    -- Ativados no período = primeira ação significativa da vida ocorreu no período
    'activated_clients', (
      SELECT count(*)::int FROM (
        SELECT pseudo_id, min(occurred_at) AS first_at
        FROM public.product_events e
        JOIN public.v_client_pseudonyms cp ON cp.pseudo_id = e.pseudo_id
        WHERE e.event_name = ANY (v_activity)
          AND e.event_source = 'live'
        GROUP BY pseudo_id
      ) fs WHERE fs.first_at >= v_start AND fs.first_at < v_end
    ),
    -- Dormant snapshot ao fim do período: sem atividade nos 14 dias anteriores a v_end
    'dormant_clients', (SELECT count(*)::int FROM public.v_client_users v
      WHERE NOT EXISTS (
        SELECT 1 FROM public.product_events e
        WHERE e.pseudo_id = v.pseudo_id
          AND e.event_name = ANY (v_activity)
          AND e.event_source = 'live'
          AND e.occurred_at >= v_end - interval '14 days'
          AND e.occurred_at < v_end
      )),
    'with_financial_data', (SELECT count(distinct t.user_id)::int
      FROM public.transactions t
      JOIN public.v_client_users v ON v.user_id = t.user_id),
    'period', jsonb_build_object('from', v_from, 'to', v_to, 'timezone', v_tz),
    'universe','clients_only',
    'formula_version','growth.summary.v3',
    'measured_at', now()
  );
END; $$;

-- ============================================================
-- M3-B: admin_v2_clients_list — novo contrato com filtros server-side
-- ============================================================
DROP FUNCTION IF EXISTS public.admin_v2_clients_list(integer);

CREATE OR REPLACE FUNCTION public.admin_v2_clients_list(
  _from date DEFAULT NULL,
  _to date DEFAULT NULL,
  _tz text DEFAULT 'America/Sao_Paulo',
  _limit integer DEFAULT 100,
  _lifecycle text DEFAULT NULL,
  _financial text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text := coalesce(_tz, 'America/Sao_Paulo');
  v_to date := coalesce(_to, (now() AT TIME ZONE v_tz)::date);
  v_from date := coalesce(_from, v_to - 29);
  v_activity text[] := public.activity_events();
  v_lifecycle text := lower(coalesce(_lifecycle, 'all'));
  v_financial text := lower(coalesce(_financial, 'all'));
BEGIN
  PERFORM public._require_perm('clients.read');
  IF (v_to - v_from) > 365 THEN
    RAISE EXCEPTION 'invalid_parameter_value: range excede 365 dias';
  END IF;

  RETURN jsonb_build_object(
    'clients', (
      SELECT coalesce(jsonb_agg(row_to_json(x) ORDER BY x.registered_at DESC), '[]'::jsonb)
      FROM (
        SELECT
          up.pseudo_id,
          up.created_at AS registered_at,
          pr.onboarding_completed_at,
          ev.first_event_at,
          ev.last_event_at,
          coalesce(ev.total_events,0)::int AS total_events,
          coalesce(ev.significant_actions,0)::int AS significant_actions,
          EXISTS(SELECT 1 FROM public.transactions t WHERE t.user_id = up.user_id) AS has_financial_data,
          CASE
            WHEN up.detached_at IS NOT NULL THEN 'deleted'
            WHEN coalesce(ev.significant_actions,0) = 0 AND pr.onboarding_completed_at IS NULL THEN 'new'
            WHEN coalesce(ev.last_event_at, pr.onboarding_completed_at) < now() - interval '14 days' THEN 'dormant'
            WHEN coalesce(ev.activity_days,0) >= 2 OR coalesce(ev.significant_actions,0) >= 2 THEN 'active'
            ELSE 'activated'
          END AS lifecycle_status
        FROM public.user_pseudonyms up
        LEFT JOIN public.profiles pr ON pr.id = up.user_id
        LEFT JOIN LATERAL (
          SELECT
            min(e.occurred_at) AS first_event_at,
            max(e.occurred_at) AS last_event_at,
            count(*) AS total_events,
            count(*) FILTER (WHERE e.event_name = ANY (v_activity)) AS significant_actions,
            count(distinct (e.occurred_at AT TIME ZONE v_tz)::date)
              FILTER (WHERE e.event_name = ANY (v_activity)) AS activity_days
          FROM public.product_events e
          WHERE e.pseudo_id = up.pseudo_id
            AND e.event_source = 'live'
            AND e.event_name = ANY (v_activity)
        ) ev ON true
        WHERE public.is_client_user(up.user_id)
        ORDER BY up.created_at DESC
        LIMIT least(greatest(_limit,1),500)
      ) x
      WHERE (v_lifecycle = 'all' OR x.lifecycle_status = v_lifecycle)
        AND (v_financial = 'all'
             OR (v_financial = 'with' AND x.has_financial_data)
             OR (v_financial = 'without' AND NOT x.has_financial_data))
    ),
    'totals', jsonb_build_object(
      'registered', (SELECT count(*)::int FROM public.v_client_users),
      'with_profile', (
        SELECT count(*)::int FROM public.v_client_users v
        JOIN public.profiles p ON p.id = v.user_id
      ),
      'with_financial_data', (
        SELECT count(distinct t.user_id)::int FROM public.transactions t
        JOIN public.v_client_users v ON v.user_id = t.user_id
      )
    ),
    'lifecycle_definition', jsonb_build_object(
      'new','cadastro sem onboarding ou ação significativa',
      'activated','onboarding ou primeira ação significativa',
      'active','duas ou mais ações/dias de uso recentes',
      'dormant','sem atividade significativa há mais de 14 dias'
    ),
    'filters', jsonb_build_object(
      'lifecycle', v_lifecycle,
      'financial', v_financial,
      'from', v_from,
      'to', v_to,
      'tz', v_tz
    ),
    'formula_version','clients.live.v7',
    'universe','clients_only',
    'measured_at', now()
  );
END; $$;

-- ============================================================
-- M6: Normalização de grants nas admin_v2_*
-- ============================================================
DO $$
DECLARE r record; BEGIN
  FOR r IN
    SELECT n.nspname AS schema, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'admin_v2_%' OR p.proname IN ('activity_events','value_events','is_client_user'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC', r.schema, r.proname, r.args);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM anon', r.schema, r.proname, r.args);
    IF r.proname LIKE 'admin_v2_%' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO authenticated', r.schema, r.proname, r.args);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role', r.schema, r.proname, r.args);
  END LOOP;
END $$;