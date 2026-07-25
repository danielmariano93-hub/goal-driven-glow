
-- =============================================================================
-- 1) admin_v2_clients_list → clients.live.v6 (client-scoped)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_v2_clients_list(_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public._require_perm('clients.read');
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
          EXISTS(SELECT 1 FROM public.transactions t WHERE t.user_id=up.user_id) AS has_financial_data,
          CASE
            WHEN up.detached_at IS NOT NULL THEN 'deleted'
            WHEN coalesce(ev.significant_actions,0)=0 AND pr.onboarding_completed_at IS NULL THEN 'new'
            WHEN coalesce(ev.last_event_at,pr.onboarding_completed_at) < now() - interval '14 days' THEN 'dormant'
            WHEN coalesce(ev.activity_days,0) >= 2 OR coalesce(ev.significant_actions,0) >= 2 THEN 'active'
            ELSE 'activated'
          END AS lifecycle_status
        FROM public.user_pseudonyms up
        LEFT JOIN public.profiles pr ON pr.id=up.user_id
        LEFT JOIN LATERAL (
          SELECT
            min(e.occurred_at) FILTER (WHERE e.event_name <> 'user_registered') AS first_event_at,
            max(e.occurred_at) FILTER (WHERE e.event_name <> 'user_registered') AS last_event_at,
            count(*) AS total_events,
            count(*) FILTER (WHERE e.event_name IN (
              'financial_entry_created','goal_created','goal_progress_recorded',
              'split_created','split_participant_paid','document_confirmed',
              'onboarding_completed','agent_response_delivered'
            )) AS significant_actions,
            count(distinct (e.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date)
              FILTER (WHERE e.event_name <> 'user_registered') AS activity_days
          FROM public.product_events e
          WHERE e.pseudo_id=up.pseudo_id
        ) ev ON true
        WHERE public.is_client_user(up.user_id)
        ORDER BY up.created_at DESC
        LIMIT least(greatest(_limit,1),500)
      ) x
    ),
    'totals', jsonb_build_object(
      'registered', (SELECT count(*)::int FROM public.v_client_users),
      'with_profile', (
        SELECT count(*)::int FROM public.v_client_users v
        JOIN public.profiles p ON p.id=v.user_id
      ),
      'with_financial_data', (
        SELECT count(distinct t.user_id)::int FROM public.transactions t
        JOIN public.v_client_users v ON v.user_id=t.user_id
      )
    ),
    'lifecycle_definition', jsonb_build_object(
      'new','cadastro sem onboarding ou ação significativa',
      'activated','onboarding ou primeira ação significativa',
      'active','duas ou mais ações/dias de uso recentes',
      'dormant','sem atividade significativa há mais de 14 dias'
    ),
    'formula_version','clients.live.v6',
    'universe','clients_only',
    'measured_at',now()
  );
END; $$;

REVOKE ALL ON FUNCTION public.admin_v2_clients_list(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_v2_clients_list(integer) TO authenticated, service_role;

-- =============================================================================
-- 2) admin_v2_cockpit(_from date, _to date) with client-scoped counts
--    Zero-arg overload preserved via DEFAULT NULL params.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_v2_cockpit(
  _from date DEFAULT NULL,
  _to date DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_from date := coalesce(_from, v_today);
  v_to date := coalesce(_to, v_today);
  v_start timestamptz := v_from::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_end timestamptz := (v_to + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_span_days int := greatest((v_to - v_from) + 1, 1);
  v_prev_start timestamptz := (v_from - v_span_days)::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_prev_end timestamptz := v_start;
  wvu numeric; wvu_prev numeric; act numeric; act_prev numeric;
  value_deliv numeric; value_deliv_prev numeric; registered numeric; registered_prev numeric;
  total_users numeric; total_prev numeric; cost_today numeric; cost_prev numeric;
  msg_failed numeric; msg_total numeric; v_last_refresh timestamptz;
BEGIN
  PERFORM public._require_perm('cockpit.read');

  -- WVU no período (client-only)
  SELECT count(distinct e.pseudo_id)::numeric INTO wvu FROM public.product_events e
  JOIN public.v_client_pseudonyms cp ON cp.pseudo_id=e.pseudo_id
  WHERE e.occurred_at >= v_start AND e.occurred_at < v_end
    AND EXISTS (SELECT 1 FROM public.product_events s WHERE s.pseudo_id=e.pseudo_id
      AND s.occurred_at >= v_start AND s.occurred_at < v_end
      AND s.event_name IN ('financial_entry_created','goal_progress_recorded','split_participant_paid'))
    AND EXISTS (SELECT 1 FROM public.product_events v WHERE v.pseudo_id=e.pseudo_id
      AND v.occurred_at >= v_start AND v.occurred_at < v_end
      AND v.event_name IN ('insight_delivered','forecast_delivered','personalized_response_delivered',
        'goal_progress_explained','split_result_delivered','split_reminder_prepared','agent_response_delivered'));

  SELECT count(distinct e.pseudo_id)::numeric INTO wvu_prev FROM public.product_events e
  JOIN public.v_client_pseudonyms cp ON cp.pseudo_id=e.pseudo_id
  WHERE e.occurred_at >= v_prev_start AND e.occurred_at < v_prev_end
    AND EXISTS (SELECT 1 FROM public.product_events s WHERE s.pseudo_id=e.pseudo_id
      AND s.occurred_at >= v_prev_start AND s.occurred_at < v_prev_end
      AND s.event_name IN ('financial_entry_created','goal_progress_recorded','split_participant_paid'))
    AND EXISTS (SELECT 1 FROM public.product_events v WHERE v.pseudo_id=e.pseudo_id
      AND v.occurred_at >= v_prev_start AND v.occurred_at < v_prev_end
      AND v.event_name IN ('insight_delivered','forecast_delivered','personalized_response_delivered',
        'goal_progress_explained','split_result_delivered','split_reminder_prepared','agent_response_delivered'));

  -- Ativações
  SELECT count(distinct e.pseudo_id)::numeric INTO act FROM public.product_events e
  JOIN public.v_client_pseudonyms cp ON cp.pseudo_id=e.pseudo_id
  WHERE e.occurred_at>=v_start AND e.occurred_at<v_end
    AND e.event_name IN ('financial_entry_created','goal_created','split_created');
  SELECT count(distinct e.pseudo_id)::numeric INTO act_prev FROM public.product_events e
  JOIN public.v_client_pseudonyms cp ON cp.pseudo_id=e.pseudo_id
  WHERE e.occurred_at>=v_prev_start AND e.occurred_at<v_prev_end
    AND e.event_name IN ('financial_entry_created','goal_created','split_created');

  -- Valor entregue
  SELECT count(*)::numeric INTO value_deliv FROM public.product_events e
  JOIN public.v_client_pseudonyms cp ON cp.pseudo_id=e.pseudo_id
  WHERE e.occurred_at>=v_start AND e.occurred_at<v_end
    AND e.event_name IN ('insight_delivered','forecast_delivered','personalized_response_delivered',
      'goal_progress_explained','split_result_delivered','agent_response_delivered');
  SELECT count(*)::numeric INTO value_deliv_prev FROM public.product_events e
  JOIN public.v_client_pseudonyms cp ON cp.pseudo_id=e.pseudo_id
  WHERE e.occurred_at>=v_prev_start AND e.occurred_at<v_prev_end
    AND e.event_name IN ('insight_delivered','forecast_delivered','personalized_response_delivered',
      'goal_progress_explained','split_result_delivered','agent_response_delivered');

  -- Cadastros (clientes reais)
  SELECT count(*)::numeric INTO registered FROM public.v_client_users v
  WHERE v.registered_at>=v_start AND v.registered_at<v_end;
  SELECT count(*)::numeric INTO registered_prev FROM public.v_client_users v
  WHERE v.registered_at>=v_prev_start AND v.registered_at<v_prev_end;

  -- Estoque de clientes
  SELECT count(*)::numeric INTO total_users FROM public.v_client_users v WHERE v.registered_at<v_end;
  SELECT count(*)::numeric INTO total_prev FROM public.v_client_users v WHERE v.registered_at<v_start;

  -- Custos e mensageria (não pseudonimizados; permanecem em user_id → filtramos clientes)
  SELECT coalesce(sum(ar.cost_cents),0)::numeric INTO cost_today
  FROM public.agent_runs ar
  JOIN public.v_client_users v ON v.user_id=ar.user_id
  WHERE ar.started_at>=v_start AND ar.started_at<v_end;
  SELECT coalesce(sum(ar.cost_cents),0)::numeric INTO cost_prev
  FROM public.agent_runs ar
  JOIN public.v_client_users v ON v.user_id=ar.user_id
  WHERE ar.started_at>=v_prev_start AND ar.started_at<v_prev_end;

  SELECT count(*) FILTER (WHERE om.status::text IN ('failed','dead'))::numeric,
         count(*)::numeric INTO msg_failed,msg_total
  FROM public.outbound_messages om
  JOIN public.v_client_users v ON v.user_id=om.user_id
  WHERE om.created_at>=v_start-interval '6 days' AND om.created_at<v_end;

  SELECT max(last_run_at) INTO v_last_refresh FROM public.job_heartbeats
    WHERE job_key IN ('product_aggregates_incremental','product_aggregates_full');

  RETURN jsonb_build_object(
    'wvu', public._envelope(wvu,wvu_prev,coalesce(wvu,0)::int,'higher_is_better','wvu.live.v5',jsonb_build_object('source_kind','live','universe','clients_only')),
    'activation', public._envelope(act,act_prev,coalesce(act,0)::int,'higher_is_better','activation.live.v5',jsonb_build_object('source_kind','live','universe','clients_only')),
    'value_delivered', public._envelope(value_deliv,value_deliv_prev,coalesce(value_deliv,0)::int,'higher_is_better','value.live.v5',jsonb_build_object('source_kind','live','universe','clients_only')),
    'registered_today', public._envelope(registered,registered_prev,coalesce(registered,0)::int,'higher_is_better','registrations.live.v2',jsonb_build_object('source_kind','live','universe','clients_only')),
    'total_users', public._envelope(total_users,total_prev,coalesce(total_users,0)::int,'higher_is_better','users.total.live.v2',jsonb_build_object('source_kind','live','universe','clients_only')),
    'agent_cost_cents_today', public._envelope(cost_today,cost_prev,1,'lower_is_better','agent.cost.live.v2',jsonb_build_object('source_kind','live','universe','clients_only')),
    'messaging_failure_rate_7d', public._envelope(
      CASE WHEN msg_total=0 THEN null ELSE round(msg_failed/nullif(msg_total,0)*100,2) END,
      null,msg_total::int,'lower_is_better','messaging.failure.live.v2',jsonb_build_object('source_kind','live','universe','clients_only')),
    'period', jsonb_build_object('from',v_from,'to',v_to,'timezone','America/Sao_Paulo','days',v_span_days),
    'attention', (
      SELECT coalesce(jsonb_agg(a),'[]'::jsonb) FROM (
        SELECT jsonb_build_object('key','messaging_failures','severity',CASE WHEN msg_failed>20 THEN 'high' WHEN msg_failed>5 THEN 'medium' ELSE 'low' END,'value',msg_failed) a WHERE msg_failed>0
        UNION ALL
        SELECT jsonb_build_object('key','missing_profiles','severity','high','value',count(*)::numeric)
          FROM auth.users u LEFT JOIN public.profiles p ON p.id=u.id
          WHERE p.id IS NULL AND public.is_client_user(u.id) HAVING count(*)>0
        UNION ALL
        SELECT jsonb_build_object('key','missing_pseudonyms','severity','high','value',count(*)::numeric)
          FROM auth.users u LEFT JOIN public.user_pseudonyms p ON p.user_id=u.id
          WHERE p.user_id IS NULL AND public.is_client_user(u.id) HAVING count(*)>0
      ) q
    ),
    'metrics_health', jsonb_build_object(
      'last_refresh_at',v_last_refresh,
      'stale',v_last_refresh IS NULL OR v_last_refresh<now()-interval '30 minutes',
      'auth_users',(SELECT count(*)::int FROM auth.users),
      'profiles',(SELECT count(*)::int FROM public.profiles),
      'pseudonyms',(SELECT count(*)::int FROM public.user_pseudonyms WHERE detached_at IS NULL),
      'client_users',(SELECT count(*)::int FROM public.v_client_users),
      'platform_admins',(SELECT count(*)::int FROM public.platform_admins WHERE active),
      'measured_at',now(),
      'timezone','America/Sao_Paulo'
    ),
    'series_wvu_14d', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('day',d.day,'value',(
        SELECT count(distinct e.pseudo_id)::int FROM public.product_events e
        JOIN public.v_client_pseudonyms cp ON cp.pseudo_id=e.pseudo_id
        WHERE e.occurred_at >= ((d.day-6)::timestamp AT TIME ZONE 'America/Sao_Paulo')
          AND e.occurred_at < ((d.day+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
          AND EXISTS (SELECT 1 FROM public.product_events s WHERE s.pseudo_id=e.pseudo_id
            AND s.occurred_at >= ((d.day-6)::timestamp AT TIME ZONE 'America/Sao_Paulo')
            AND s.occurred_at < ((d.day+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
            AND s.event_name IN ('financial_entry_created','goal_progress_recorded','split_participant_paid'))
          AND EXISTS (SELECT 1 FROM public.product_events v WHERE v.pseudo_id=e.pseudo_id
            AND v.occurred_at >= ((d.day-6)::timestamp AT TIME ZONE 'America/Sao_Paulo')
            AND v.occurred_at < ((d.day+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
            AND v.event_name IN ('insight_delivered','forecast_delivered','personalized_response_delivered',
              'goal_progress_explained','split_result_delivered','split_reminder_prepared','agent_response_delivered'))
      )) ORDER BY d.day),'[]'::jsonb)
      FROM (SELECT generate_series(v_today-13,v_today,'1 day')::date AS day) d
    )
  );
END; $$;

REVOKE ALL ON FUNCTION public.admin_v2_cockpit(date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_v2_cockpit(date,date) TO authenticated, service_role;

-- =============================================================================
-- 3) admin_v2_daily_evolution(_from, _to)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_v2_daily_evolution(
  _from date DEFAULT NULL,
  _to date DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_from date := coalesce(_from, v_today - 29);
  v_to date := coalesce(_to, v_today);
  v_sample int;
BEGIN
  PERFORM public._require_perm('cockpit.read');
  SELECT count(*)::int INTO v_sample FROM public.v_client_users;

  RETURN jsonb_build_object(
    'series', (
      SELECT coalesce(jsonb_agg(row_to_json(x) ORDER BY x.day),'[]'::jsonb)
      FROM (
        WITH days AS (SELECT generate_series(v_from, v_to, '1 day'::interval)::date AS day),
        sig_events AS (
          SELECT e.pseudo_id,
                 (e.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date AS d,
                 e.event_name
          FROM public.product_events e
          JOIN public.v_client_pseudonyms cp ON cp.pseudo_id=e.pseudo_id
          WHERE e.event_name <> 'user_registered'
        )
        SELECT
          d.day,
          (SELECT count(*)::int FROM public.v_client_users v
             WHERE (v.registered_at AT TIME ZONE 'America/Sao_Paulo')::date = d.day) AS new_clients,
          (SELECT count(distinct s.pseudo_id)::int FROM sig_events s
             WHERE s.d = d.day
               AND s.event_name IN ('financial_entry_created','goal_created','split_created')
               AND NOT EXISTS (
                 SELECT 1 FROM sig_events s2
                 WHERE s2.pseudo_id = s.pseudo_id AND s2.d < d.day
                   AND s2.event_name IN ('financial_entry_created','goal_created','split_created')
               )) AS activated,
          (SELECT count(distinct s.pseudo_id)::int FROM sig_events s
             WHERE s.d = d.day) AS active_unique,
          (SELECT count(*)::int FROM public.v_client_users v
             WHERE EXISTS (SELECT 1 FROM sig_events s WHERE s.pseudo_id=v.pseudo_id AND s.d = d.day - 14)
               AND NOT EXISTS (SELECT 1 FROM sig_events s2 WHERE s2.pseudo_id=v.pseudo_id
                 AND s2.d > d.day - 14 AND s2.d <= d.day)) AS went_dormant,
          (SELECT count(*)::int FROM public.v_client_users v
             WHERE (v.registered_at AT TIME ZONE 'America/Sao_Paulo')::date <= d.day) AS cumulative_clients,
          (SELECT count(distinct t.user_id)::int FROM public.transactions t
             JOIN public.v_client_users v ON v.user_id=t.user_id
             WHERE (t.created_at AT TIME ZONE 'America/Sao_Paulo')::date = d.day
               AND NOT EXISTS (SELECT 1 FROM public.transactions t2
                 WHERE t2.user_id=t.user_id
                   AND (t2.created_at AT TIME ZONE 'America/Sao_Paulo')::date < d.day)) AS first_financial_action
        FROM days d
      ) x
    ),
    'totals', (
      SELECT jsonb_build_object(
        'new_clients', (SELECT count(*)::int FROM public.v_client_users v
          WHERE (v.registered_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to),
        'active_unique_period', (SELECT count(distinct e.pseudo_id)::int FROM public.product_events e
          JOIN public.v_client_pseudonyms cp ON cp.pseudo_id=e.pseudo_id
          WHERE e.event_name <> 'user_registered'
            AND (e.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to)
      )
    ),
    'period', jsonb_build_object('from',v_from,'to',v_to,'timezone','America/Sao_Paulo'),
    'sample_size', v_sample,
    'sufficient_sample', v_sample >= 10,
    'formula_version', 'daily.evolution.v1',
    'measured_at', now()
  );
END; $$;

REVOKE ALL ON FUNCTION public.admin_v2_daily_evolution(date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_v2_daily_evolution(date,date) TO authenticated, service_role;

-- =============================================================================
-- 4) Growth / Product functions — patch client-scoping without changing signatures
--    Recria versões existentes com filtro por v_client_pseudonyms.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_v2_growth_summary(_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_start timestamptz := (v_today - greatest(_days,1) + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_end timestamptz := (v_today + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo';
BEGIN
  PERFORM public._require_perm('growth.read');
  RETURN jsonb_build_object(
    'total_clients', (SELECT count(*)::int FROM public.v_client_users),
    'new_clients', (SELECT count(*)::int FROM public.v_client_users v
      WHERE v.registered_at >= v_start AND v.registered_at < v_end),
    'active_clients', (SELECT count(distinct e.pseudo_id)::int FROM public.product_events e
      JOIN public.v_client_pseudonyms cp ON cp.pseudo_id=e.pseudo_id
      WHERE e.occurred_at>=v_start AND e.occurred_at<v_end AND e.event_name<>'user_registered'),
    'activated_clients', (SELECT count(distinct e.pseudo_id)::int FROM public.product_events e
      JOIN public.v_client_pseudonyms cp ON cp.pseudo_id=e.pseudo_id
      WHERE e.occurred_at>=v_start AND e.occurred_at<v_end
        AND e.event_name IN ('financial_entry_created','goal_created','split_created')),
    'dormant_clients', (SELECT count(*)::int FROM public.v_client_users v
      WHERE NOT EXISTS (SELECT 1 FROM public.product_events e
        WHERE e.pseudo_id=v.pseudo_id AND e.event_name<>'user_registered'
          AND e.occurred_at>=now()-interval '14 days')),
    'with_financial_data', (SELECT count(distinct t.user_id)::int FROM public.transactions t
      JOIN public.v_client_users v ON v.user_id=t.user_id),
    'period', jsonb_build_object('from',(v_start AT TIME ZONE 'America/Sao_Paulo')::date,
      'to',v_today,'days',_days,'timezone','America/Sao_Paulo'),
    'universe','clients_only',
    'formula_version','growth.summary.live.v2',
    'measured_at',now()
  );
END; $$;

REVOKE ALL ON FUNCTION public.admin_v2_growth_summary(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_v2_growth_summary(integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_v2_clients_list(integer) IS 'clients.live.v6 — filtra por v_client_users (exclui admins).';
COMMENT ON FUNCTION public.admin_v2_cockpit(date,date) IS 'cockpit.live.v2 — client-scoped + filtro de período opcional.';
COMMENT ON FUNCTION public.admin_v2_daily_evolution(date,date) IS 'daily.evolution.v1 — série diária de novos/ativados/ativos/dormant/acumulado.';
COMMENT ON FUNCTION public.admin_v2_growth_summary(integer) IS 'growth.summary.live.v2 — client-scoped.';
