-- =====================================================================
-- FASES 3-5: RPCs analíticas admin_v2_* sem PII
-- =====================================================================

-- Helper: envelope padrão
CREATE OR REPLACE FUNCTION public._envelope(
  _value numeric, _previous numeric, _sample integer, _polarity text,
  _formula_version text DEFAULT 'v1',
  _extras jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'value', _value,
    'previous', _previous,
    'delta_abs', COALESCE(_value,0) - COALESCE(_previous,0),
    'delta_pct', CASE WHEN COALESCE(_previous,0) = 0 THEN NULL
                      ELSE round(((_value - _previous) / _previous * 100)::numeric, 2) END,
    'sample_size', _sample,
    'sufficient_sample', _sample >= 30,
    'polarity', _polarity,
    'formula_version', _formula_version,
    'timezone', 'America/Sao_Paulo',
    'measurement_started_at', now(),
    'data_quality', CASE WHEN _sample >= 30 THEN 'ok' WHEN _sample >= 10 THEN 'low' ELSE 'insufficient' END,
    'source_kind', 'aggregate'
  ) || _extras
$$;

-- Helper: guard
CREATE OR REPLACE FUNCTION public._require_perm(_action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_platform_permission(_action) THEN
    RAISE EXCEPTION 'permission_denied: %', _action USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------
-- COCKPIT
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_v2_cockpit()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  yest  date := today - 1;
  wvu numeric; wvu_prev numeric; act numeric; act_prev numeric;
  value_deliv numeric; value_deliv_prev numeric;
  cost_today numeric; cost_prev numeric;
  msg_failed numeric; msg_total numeric;
BEGIN
  PERFORM public._require_perm('cockpit.read');

  SELECT wvu_count, activated_count, value_delivered_count
    INTO wvu, act, value_deliv
  FROM public.product_daily_value WHERE day = today;
  SELECT wvu_count, activated_count, value_delivered_count
    INTO wvu_prev, act_prev, value_deliv_prev
  FROM public.product_daily_value WHERE day = yest;

  SELECT COALESCE(SUM(cost_cents),0) INTO cost_today
    FROM public.agent_metrics_daily WHERE day = today;
  SELECT COALESCE(SUM(cost_cents),0) INTO cost_prev
    FROM public.agent_metrics_daily WHERE day = yest;

  SELECT COALESCE(SUM(failed),0), COALESCE(SUM(sent),0)
    INTO msg_failed, msg_total
    FROM public.outbound_metrics_daily WHERE day >= today - 6;

  RETURN jsonb_build_object(
    'wvu',           public._envelope(wvu, wvu_prev, COALESCE(wvu,0)::int, 'higher_is_better'),
    'activation',    public._envelope(act, act_prev, COALESCE(act,0)::int, 'higher_is_better'),
    'value_delivered', public._envelope(value_deliv, value_deliv_prev, COALESCE(value_deliv,0)::int, 'higher_is_better'),
    'agent_cost_cents_today', public._envelope(cost_today, cost_prev, 1, 'lower_is_better'),
    'messaging_failure_rate_7d', public._envelope(
       CASE WHEN msg_total = 0 THEN 0 ELSE round(msg_failed/NULLIF(msg_total,0)*100, 2) END,
       NULL, msg_total::int, 'lower_is_better'),
    'attention', (
      SELECT COALESCE(jsonb_agg(a), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('key', 'messaging_failures', 'severity',
          CASE WHEN msg_failed > 20 THEN 'high' WHEN msg_failed > 5 THEN 'medium' ELSE 'low' END,
          'value', msg_failed) AS a
        WHERE msg_failed > 0
      ) a
    ),
    'series_wvu_14d', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('day', day, 'value', wvu_count) ORDER BY day), '[]'::jsonb)
      FROM public.product_daily_value WHERE day >= today - 13
    )
  );
END;
$$;

-- ---------------------------------------------------------------------
-- CRESCIMENTO
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_v2_growth_summary(_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  PERFORM public._require_perm('growth.read');
  RETURN jsonb_build_object(
    'lifecycle', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'day', day, 'new_users', new_users, 'active_users', active_users,
        'dormant_users', dormant_users, 'churned_users', churned_users
      ) ORDER BY day), '[]'::jsonb)
      FROM public.user_lifecycle_daily WHERE day >= today - _days
    ),
    'sample_size', (SELECT COUNT(*)::int FROM public.user_pseudonyms)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_v2_growth_cohorts(_weeks integer DEFAULT 8)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._require_perm('growth.read');
  RETURN jsonb_build_object(
    'cohorts', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'cohort_week', cohort_week, 'reference_week', reference_week,
        'week_offset', week_offset, 'activated_users', activated_users,
        'retained_users', retained_users,
        'retention_rate', CASE WHEN activated_users = 0 THEN 0
          ELSE round(retained_users::numeric / activated_users * 100, 2) END
      ) ORDER BY cohort_week DESC, week_offset), '[]'::jsonb)
      FROM public.product_cohorts_weekly
      WHERE cohort_week >= ((now() AT TIME ZONE 'America/Sao_Paulo')::date - (_weeks * 7))
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_v2_growth_funnel(_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  PERFORM public._require_perm('growth.read');
  RETURN jsonb_build_object(
    'funnel', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'feature', feature, 'step', step,
        'users', SUM(users)::int, 'events', SUM(events)::int
      )), '[]'::jsonb)
      FROM (
        SELECT feature, step, SUM(users) AS users, SUM(events) AS events
        FROM public.feature_funnel_daily
        WHERE day >= today - _days
        GROUP BY feature, step
      ) x
    )
  );
END;
$$;

-- ---------------------------------------------------------------------
-- INTELIGÊNCIA DE PRODUTO
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_v2_product_features(_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  PERFORM public._require_perm('product_intel.read');
  RETURN jsonb_build_object(
    'features', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'feature', feature, 'events', events, 'users', users,
        'share', share
      ) ORDER BY events DESC), '[]'::jsonb)
      FROM (
        SELECT feature,
          SUM(events)::int AS events,
          SUM(users)::int AS users,
          round(SUM(events)::numeric / NULLIF((SELECT SUM(events) FROM public.feature_funnel_daily WHERE day >= today - _days),0) * 100, 2) AS share
        FROM public.feature_funnel_daily
        WHERE day >= today - _days
        GROUP BY feature
      ) x
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_v2_product_opportunities()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  PERFORM public._require_perm('product_intel.read');
  -- Oportunidade = feature com muitos 'initiated' e poucos 'completed'/'value_delivered'
  RETURN jsonb_build_object(
    'opportunities', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'feature', feature,
        'initiated', initiated,
        'completed', completed,
        'value_delivered', value_delivered,
        'completion_rate', CASE WHEN initiated = 0 THEN 0 ELSE round(completed::numeric/initiated*100, 2) END,
        'value_rate', CASE WHEN initiated = 0 THEN 0 ELSE round(value_delivered::numeric/initiated*100, 2) END
      ) ORDER BY initiated DESC), '[]'::jsonb)
      FROM (
        SELECT feature,
          SUM(CASE WHEN step='initiated' THEN users ELSE 0 END)::int AS initiated,
          SUM(CASE WHEN step='completed' THEN users ELSE 0 END)::int AS completed,
          SUM(CASE WHEN step='value_delivered' THEN users ELSE 0 END)::int AS value_delivered
        FROM public.feature_funnel_daily
        WHERE day >= today - 30
        GROUP BY feature
      ) x
    )
  );
END;
$$;

-- ---------------------------------------------------------------------
-- OPERAÇÃO
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_v2_operations_health()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._require_perm('ops.read');
  RETURN jsonb_build_object(
    'heartbeats', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'job_key', job_key, 'last_run_at', last_run_at, 'last_ok', last_ok,
        'processed', processed, 'failed', failed
      ) ORDER BY job_key), '[]'::jsonb)
      FROM public.job_heartbeats
    ),
    'today_agent', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'surface', surface, 'runs', runs, 'runs_ok', runs_ok, 'runs_error', runs_error,
        'latency_p50', latency_ms_p50, 'latency_p95', latency_ms_p95
      )), '[]'::jsonb)
      FROM public.agent_metrics_daily
      WHERE day = (now() AT TIME ZONE 'America/Sao_Paulo')::date
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_v2_messaging_activity(_days integer DEFAULT 7)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  PERFORM public._require_perm('messaging.read');
  RETURN jsonb_build_object(
    'daily', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'day', day, 'surface', surface, 'feature', feature,
        'sent', sent, 'delivered', delivered, 'read', read, 'failed', failed
      ) ORDER BY day DESC), '[]'::jsonb)
      FROM public.outbound_metrics_daily WHERE day >= today - _days
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_v2_ia_ocr_metrics(_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  PERFORM public._require_perm('ops.read');
  RETURN jsonb_build_object(
    'uploaded', (SELECT COUNT(*) FROM public.product_events
       WHERE event_name='ocr_document_uploaded' AND occurred_at >= now() - make_interval(days => _days)),
    'confirmed', (SELECT COUNT(*) FROM public.product_events
       WHERE event_name='ocr_document_confirmed' AND occurred_at >= now() - make_interval(days => _days)),
    'confirmation_rate', (
      SELECT CASE WHEN u = 0 THEN 0 ELSE round(c::numeric/u*100, 2) END
      FROM (
        SELECT
          (SELECT COUNT(*) FROM public.product_events WHERE event_name='ocr_document_uploaded' AND occurred_at >= now() - make_interval(days => _days)) AS u,
          (SELECT COUNT(*) FROM public.product_events WHERE event_name='ocr_document_confirmed' AND occurred_at >= now() - make_interval(days => _days)) AS c
      ) x
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_v2_whatsapp_monitor(_days integer DEFAULT 7)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  PERFORM public._require_perm('whatsapp.read');
  RETURN jsonb_build_object(
    'daily', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'day', day, 'feature', feature, 'sent', sent, 'delivered', delivered,
        'read', read, 'failed', failed
      ) ORDER BY day DESC), '[]'::jsonb)
      FROM public.outbound_metrics_daily
      WHERE day >= today - _days AND surface = 'whatsapp'
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_v2_assistant_health(_days integer DEFAULT 7)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  PERFORM public._require_perm('agent.read');
  RETURN jsonb_build_object(
    'daily', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'day', day, 'surface', surface, 'runs', runs, 'runs_ok', runs_ok, 'runs_error', runs_error,
        'tokens_in', tokens_in, 'tokens_out', tokens_out, 'cost_cents', cost_cents,
        'latency_p50', latency_ms_p50, 'latency_p95', latency_ms_p95
      ) ORDER BY day DESC), '[]'::jsonb)
      FROM public.agent_metrics_daily WHERE day >= today - _days
    )
  );
END;
$$;

-- ---------------------------------------------------------------------
-- CLIENTES (pseudonimizada)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_v2_clients_list(_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._require_perm('clients.read');
  RETURN jsonb_build_object(
    'clients', (
      SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM (
        SELECT
          up.pseudo_id,
          (SELECT MIN(occurred_at) FROM public.product_events WHERE pseudo_id = up.pseudo_id) AS first_event_at,
          (SELECT MAX(occurred_at) FROM public.product_events WHERE pseudo_id = up.pseudo_id) AS last_event_at,
          (SELECT COUNT(*) FROM public.product_events WHERE pseudo_id = up.pseudo_id) AS total_events,
          (SELECT COUNT(DISTINCT event_name) FROM public.product_events WHERE pseudo_id = up.pseudo_id AND event_name IN
            ('financial_entry_created','goal_progress_recorded','split_participant_paid')) AS significant_actions,
          CASE WHEN up.detached_at IS NOT NULL THEN 'deleted' ELSE 'active' END AS lifecycle_status
        FROM public.user_pseudonyms up
        ORDER BY last_event_at DESC NULLS LAST
        LIMIT _limit
      ) x
    )
  );
END;
$$;

-- ---------------------------------------------------------------------
-- RECEITA (placeholder honesto — sem dados de pagamento reais)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_v2_revenue_summary()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._require_perm('revenue.read');
  RETURN jsonb_build_object(
    'status', 'not_configured',
    'note', 'Integração de pagamentos ainda não conectada. Nenhum MRR/ARR real disponível.',
    'active_users_last_30d', (SELECT COUNT(DISTINCT pseudo_id) FROM public.product_events
       WHERE occurred_at >= now() - interval '30 days')
  );
END;
$$;

-- ---------------------------------------------------------------------
-- GOVERNANÇA / AUDITORIA
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_v2_governance_summary()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._require_perm('governance.read');
  RETURN jsonb_build_object(
    'admins_total', (SELECT COUNT(*) FROM public.platform_admins),
    'admins_by_role', (
      SELECT COALESCE(jsonb_object_agg(role, cnt), '{}'::jsonb) FROM (
        SELECT role::text, COUNT(*) AS cnt FROM public.platform_admins GROUP BY role
      ) x
    ),
    'break_glass_active', (SELECT COUNT(*) FROM public.break_glass_sessions
       WHERE closed_at IS NULL AND expires_at > now()),
    'break_glass_last_7d', (SELECT COUNT(*) FROM public.break_glass_sessions
       WHERE opened_at >= now() - interval '7 days'),
    'reauth_last_7d', (SELECT COUNT(*) FROM public.admin_reauth_events
       WHERE created_at >= now() - interval '7 days')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_v2_audit_list(_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._require_perm('audit.read');
  RETURN jsonb_build_object(
    'events', (
      SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM (
        SELECT action, actor_admin_id, target_kind, created_at
        FROM public.platform_admin_audit
        ORDER BY created_at DESC
        LIMIT _limit
      ) x
    )
  );
END;
$$;

-- ---------------------------------------------------------------------
-- Seed novas ações de permissão
-- ---------------------------------------------------------------------
INSERT INTO public.platform_permissions (role, action, allowed) VALUES
  ('platform_owner','cockpit.read',true),
  ('platform_admin','cockpit.read',true),
  ('support','cockpit.read',true),
  ('analyst','cockpit.read',true),
  ('platform_owner','growth.read',true),
  ('platform_admin','growth.read',true),
  ('analyst','growth.read',true),
  ('platform_owner','product_intel.read',true),
  ('platform_admin','product_intel.read',true),
  ('analyst','product_intel.read',true),
  ('platform_owner','messaging.read',true),
  ('platform_admin','messaging.read',true),
  ('support','messaging.read',true),
  ('platform_owner','clients.read',true),
  ('platform_admin','clients.read',true),
  ('support','clients.read',true),
  ('platform_owner','revenue.read',true),
  ('platform_admin','revenue.read',true),
  ('platform_owner','governance.read',true),
  ('platform_admin','governance.read',true),
  ('platform_owner','audit.read',true),
  ('platform_admin','audit.read',true)
ON CONFLICT (role, action) DO UPDATE SET allowed = EXCLUDED.allowed;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.admin_v2_cockpit() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_v2_growth_summary(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_v2_growth_cohorts(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_v2_growth_funnel(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_v2_product_features(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_v2_product_opportunities() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_v2_operations_health() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_v2_messaging_activity(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_v2_ia_ocr_metrics(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_v2_whatsapp_monitor(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_v2_assistant_health(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_v2_clients_list(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_v2_revenue_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_v2_governance_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_v2_audit_list(integer) TO authenticated;