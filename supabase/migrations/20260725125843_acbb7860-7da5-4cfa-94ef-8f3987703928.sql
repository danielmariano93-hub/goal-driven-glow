-- NINO INTELLIGENCE CORE — HARDENING AFTER PR REVIEW
-- Corrects lifecycle semantics without changing or deleting production data.

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
        ORDER BY up.created_at DESC
        LIMIT least(greatest(_limit,1),500)
      ) x
    ),
    'totals', jsonb_build_object(
      'registered', (SELECT count(*)::int FROM public.user_pseudonyms WHERE detached_at IS NULL),
      'with_profile', (SELECT count(*)::int FROM public.profiles),
      'with_financial_data', (SELECT count(distinct user_id)::int FROM public.transactions)
    ),
    'lifecycle_definition', jsonb_build_object(
      'new','cadastro sem onboarding ou ação significativa',
      'activated','onboarding ou primeira ação significativa',
      'active','duas ou mais ações/dias de uso recentes',
      'dormant','sem atividade significativa há mais de 14 dias'
    ),
    'formula_version','clients.live.v5',
    'measured_at',now()
  );
END; $$;

-- Keep registry aligned with the hardened implementation.
UPDATE public.intelligence_metric_registry
SET
  description='Gasto esperado por dia da semana combinando frequência observada e mediana robusta dos dias ativos.',
  formula='active_rate * median(active_daily_spend_without_high_outliers)',
  minimum_sample=3,
  formula_version='weekday.robust.v2',
  updated_at=now()
WHERE metric_key='weekday_typical_spend';