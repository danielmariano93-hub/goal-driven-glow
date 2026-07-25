-- NINO INTELLIGENCE CORE + ADMIN METRICS RELIABILITY
-- Additive/corrective migration. Safe to re-run where CREATE OR REPLACE / IF NOT EXISTS is used.

-- ---------------------------------------------------------------------------
-- 1. Communication preferences and delivery audit
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS proactive_financial boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS emotional_checkin boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS smart_tips boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS whatsapp_proactive boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quiet_start time DEFAULT '21:00',
  ADD COLUMN IF NOT EXISTS quiet_end time DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS max_proactive_per_week smallint NOT NULL DEFAULT 3;

CREATE TABLE IF NOT EXISTS public.communication_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  suggestion_id uuid REFERENCES public.pending_proactive_suggestions(id) ON DELETE SET NULL,
  kind text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('app','whatsapp')),
  status text NOT NULL CHECK (status IN ('selected','suppressed','queued','sent','delivered','failed','acted','dismissed')),
  reason text,
  dedup_key text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  acted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS communication_deliveries_suggestion_channel_uidx
  ON public.communication_deliveries(suggestion_id, channel);
CREATE INDEX IF NOT EXISTS communication_deliveries_user_created_idx
  ON public.communication_deliveries(user_id, created_at DESC);
ALTER TABLE public.communication_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS communication_deliveries_owner_read ON public.communication_deliveries;
CREATE POLICY communication_deliveries_owner_read ON public.communication_deliveries
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. Model routes and canonical metric registry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_model_routes (
  task text PRIMARY KEY,
  primary_model text NOT NULL,
  fallback_model text,
  max_latency_ms integer NOT NULL DEFAULT 25000,
  max_steps smallint NOT NULL DEFAULT 6,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.ai_model_routes(task, primary_model, fallback_model, max_latency_ms, max_steps)
VALUES
  ('fast_operation','google/gemini-2.5-flash','google/gemini-2.5-flash',15000,6),
  ('semantic_classification','google/gemini-2.5-flash','google/gemini-2.5-flash',15000,4),
  ('financial_analysis','google/gemini-2.5-flash','google/gemini-2.5-flash',25000,6),
  ('complex_reasoning','google/gemini-2.5-flash','google/gemini-2.5-flash',30000,8),
  ('vision','google/gemini-2.5-flash','google/gemini-2.5-flash',30000,8)
ON CONFLICT (task) DO NOTHING;

ALTER TABLE public.ai_model_routes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_model_routes FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_model_routes TO service_role;

CREATE TABLE IF NOT EXISTS public.intelligence_metric_registry (
  metric_key text PRIMARY KEY,
  label text NOT NULL,
  description text NOT NULL,
  formula text NOT NULL,
  default_window_days integer NOT NULL,
  minimum_sample integer NOT NULL,
  include_zero_days boolean NOT NULL DEFAULT false,
  outlier_policy text NOT NULL,
  formula_version text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.intelligence_metric_registry
(metric_key,label,description,formula,default_window_days,minimum_sample,include_zero_days,outlier_policy,formula_version)
VALUES
  ('weekday_typical_spend','Gasto típico por dia da semana','Mediana do gasto diário por dia da semana, separando picos altos.','median(daily_spend_without_high_outliers)',84,4,true,'exclude_for_typical','weekday.robust.v1'),
  ('weekday_total_concentration','Concentração total por dia da semana','Participação do valor total em cada dia da semana.','sum(weekday_spend)/sum(total_spend)',84,1,false,'keep','weekday.total.v1'),
  ('weekday_purchase_frequency','Frequência de compras por dia da semana','Quantidade média de transações por ocorrência do dia.','count(transactions)/weekday_occurrences',84,4,true,'keep','weekday.frequency.v1'),
  ('weekday_average_ticket','Ticket médio por dia da semana','Valor médio por transação em cada dia da semana.','sum(spend)/count(transactions)',84,4,false,'separate','weekday.ticket.v1')
ON CONFLICT (metric_key) DO UPDATE SET
  label=excluded.label, description=excluded.description, formula=excluded.formula,
  default_window_days=excluded.default_window_days, minimum_sample=excluded.minimum_sample,
  include_zero_days=excluded.include_zero_days, outlier_policy=excluded.outlier_policy,
  formula_version=excluded.formula_version, updated_at=now();

ALTER TABLE public.intelligence_metric_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.intelligence_metric_registry FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.intelligence_metric_registry TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Instrument registration immediately (not only after first product event)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.instrument_user_registration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.product_events(
    pseudo_id,event_name,event_source,feature,surface,outcome,occurred_at,idempotency_key
  ) VALUES (
    NEW.pseudo_id,'user_registered','live','onboarding','app','success',NEW.created_at,
    'live:signup:'||NEW.user_id::text
  ) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS user_pseudonym_instrument_registration ON public.user_pseudonyms;
CREATE TRIGGER user_pseudonym_instrument_registration
AFTER INSERT ON public.user_pseudonyms
FOR EACH ROW EXECUTE FUNCTION public.instrument_user_registration();

INSERT INTO public.product_events(
  pseudo_id,event_name,event_source,feature,surface,outcome,occurred_at,idempotency_key
)
SELECT pseudo_id,'user_registered','backfill','onboarding','app','success',created_at,
       'live:signup:'||user_id::text
FROM public.user_pseudonyms
ON CONFLICT (idempotency_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Admin Clients: every signup is visible immediately, even with zero events
-- ---------------------------------------------------------------------------
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
            WHEN ev.last_event_at IS NULL THEN 'new'
            WHEN ev.last_event_at < now() - interval '14 days' THEN 'dormant'
            ELSE 'active'
          END AS lifecycle_status
        FROM public.user_pseudonyms up
        LEFT JOIN public.profiles pr ON pr.id=up.user_id
        LEFT JOIN LATERAL (
          SELECT min(e.occurred_at) AS first_event_at,
                 max(e.occurred_at) AS last_event_at,
                 count(*) AS total_events,
                 count(distinct e.event_name) FILTER (WHERE e.event_name IN
                   ('financial_entry_created','goal_progress_recorded','split_participant_paid')) AS significant_actions
          FROM public.product_events e WHERE e.pseudo_id=up.pseudo_id
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
    'formula_version','clients.live.v4',
    'measured_at',now()
  );
END; $$;

-- ---------------------------------------------------------------------------
-- 5. Growth: calculate live from source tables and use São Paulo boundaries
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_v2_growth_summary(_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  PERFORM public._require_perm('growth.read');
  RETURN jsonb_build_object(
    'lifecycle', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'day', d.day,
        'new_users', (SELECT count(*)::int FROM public.user_pseudonyms up
          WHERE (up.created_at AT TIME ZONE 'America/Sao_Paulo')::date=d.day),
        'active_users', (SELECT count(distinct e.pseudo_id)::int FROM public.product_events e
          WHERE (e.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date=d.day),
        'dormant_users', (SELECT count(*)::int FROM public.user_pseudonyms up
          WHERE up.detached_at IS NULL
            AND (up.created_at AT TIME ZONE 'America/Sao_Paulo')::date <= d.day
            AND NOT EXISTS (SELECT 1 FROM public.product_events e WHERE e.pseudo_id=up.pseudo_id
              AND e.occurred_at >= ((d.day - 13)::timestamp AT TIME ZONE 'America/Sao_Paulo')
              AND e.occurred_at < ((d.day + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'))
            AND EXISTS (SELECT 1 FROM public.product_events e WHERE e.pseudo_id=up.pseudo_id
              AND e.occurred_at < ((d.day - 13)::timestamp AT TIME ZONE 'America/Sao_Paulo'))),
        'churned_users', (SELECT count(*)::int FROM public.user_pseudonyms up
          WHERE up.detached_at IS NULL
            AND (up.created_at AT TIME ZONE 'America/Sao_Paulo')::date <= d.day
            AND NOT EXISTS (SELECT 1 FROM public.product_events e WHERE e.pseudo_id=up.pseudo_id
              AND e.occurred_at >= ((d.day - 29)::timestamp AT TIME ZONE 'America/Sao_Paulo')
              AND e.occurred_at < ((d.day + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'))
            AND EXISTS (SELECT 1 FROM public.product_events e WHERE e.pseudo_id=up.pseudo_id
              AND e.occurred_at < ((d.day - 29)::timestamp AT TIME ZONE 'America/Sao_Paulo')))
      ) ORDER BY d.day), '[]'::jsonb)
      FROM (SELECT generate_series(v_today-greatest(_days,1),v_today,'1 day')::date AS day) d
    ),
    'sample_size', (SELECT count(*)::int FROM public.user_pseudonyms WHERE detached_at IS NULL),
    'source_kind','live',
    'timezone','America/Sao_Paulo',
    'formula_version','growth.lifecycle.live.v4',
    'measured_at',now()
  );
END; $$;

-- ---------------------------------------------------------------------------
-- 6. Cockpit: live indicators plus a self-audit of missing/stale contracts
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_v2_cockpit()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_start timestamptz := v_today::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_end timestamptz := (v_today+1)::timestamp AT TIME ZONE 'America/Sao_Paulo';
  wvu numeric; wvu_prev numeric; act numeric; act_prev numeric;
  value_deliv numeric; value_deliv_prev numeric; registered numeric; registered_prev numeric;
  total_users numeric; total_prev numeric; cost_today numeric; cost_prev numeric;
  msg_failed numeric; msg_total numeric; v_last_refresh timestamptz;
BEGIN
  PERFORM public._require_perm('cockpit.read');

  SELECT count(distinct e.pseudo_id)::numeric INTO wvu FROM public.product_events e
  WHERE e.occurred_at >= v_start-interval '6 days' AND e.occurred_at < v_end
    AND EXISTS (SELECT 1 FROM public.product_events s WHERE s.pseudo_id=e.pseudo_id
      AND s.occurred_at >= v_start-interval '6 days' AND s.occurred_at < v_end
      AND s.event_name IN ('financial_entry_created','goal_progress_recorded','split_participant_paid'))
    AND EXISTS (SELECT 1 FROM public.product_events v WHERE v.pseudo_id=e.pseudo_id
      AND v.occurred_at >= v_start-interval '6 days' AND v.occurred_at < v_end
      AND v.event_name IN ('insight_delivered','forecast_delivered','personalized_response_delivered',
        'goal_progress_explained','split_result_delivered','split_reminder_prepared','agent_response_delivered'));
  SELECT count(distinct e.pseudo_id)::numeric INTO wvu_prev FROM public.product_events e
  WHERE e.occurred_at >= v_start-interval '13 days' AND e.occurred_at < v_start-interval '6 days'
    AND EXISTS (SELECT 1 FROM public.product_events s WHERE s.pseudo_id=e.pseudo_id
      AND s.occurred_at >= v_start-interval '13 days' AND s.occurred_at < v_start-interval '6 days'
      AND s.event_name IN ('financial_entry_created','goal_progress_recorded','split_participant_paid'))
    AND EXISTS (SELECT 1 FROM public.product_events v WHERE v.pseudo_id=e.pseudo_id
      AND v.occurred_at >= v_start-interval '13 days' AND v.occurred_at < v_start-interval '6 days'
      AND v.event_name IN ('insight_delivered','forecast_delivered','personalized_response_delivered',
        'goal_progress_explained','split_result_delivered','split_reminder_prepared','agent_response_delivered'));

  SELECT count(distinct pseudo_id)::numeric INTO act FROM public.product_events
    WHERE occurred_at>=v_start AND occurred_at<v_end
      AND event_name IN ('financial_entry_created','goal_created','split_created');
  SELECT count(distinct pseudo_id)::numeric INTO act_prev FROM public.product_events
    WHERE occurred_at>=v_start-interval '1 day' AND occurred_at<v_start
      AND event_name IN ('financial_entry_created','goal_created','split_created');
  SELECT count(*)::numeric INTO value_deliv FROM public.product_events
    WHERE occurred_at>=v_start AND occurred_at<v_end
      AND event_name IN ('insight_delivered','forecast_delivered','personalized_response_delivered',
        'goal_progress_explained','split_result_delivered','agent_response_delivered');
  SELECT count(*)::numeric INTO value_deliv_prev FROM public.product_events
    WHERE occurred_at>=v_start-interval '1 day' AND occurred_at<v_start
      AND event_name IN ('insight_delivered','forecast_delivered','personalized_response_delivered',
        'goal_progress_explained','split_result_delivered','agent_response_delivered');

  SELECT count(*)::numeric INTO registered FROM public.user_pseudonyms WHERE created_at>=v_start AND created_at<v_end;
  SELECT count(*)::numeric INTO registered_prev FROM public.user_pseudonyms WHERE created_at>=v_start-interval '1 day' AND created_at<v_start;
  SELECT count(*)::numeric INTO total_users FROM public.user_pseudonyms WHERE detached_at IS NULL AND created_at<v_end;
  SELECT count(*)::numeric INTO total_prev FROM public.user_pseudonyms WHERE detached_at IS NULL AND created_at<v_start;
  SELECT coalesce(sum(cost_cents),0)::numeric INTO cost_today FROM public.agent_runs WHERE started_at>=v_start AND started_at<v_end;
  SELECT coalesce(sum(cost_cents),0)::numeric INTO cost_prev FROM public.agent_runs WHERE started_at>=v_start-interval '1 day' AND started_at<v_start;
  SELECT count(*) FILTER (WHERE status::text IN ('failed','dead'))::numeric,
         count(*)::numeric INTO msg_failed,msg_total
    FROM public.outbound_messages WHERE created_at>=v_start-interval '6 days' AND created_at<v_end;
  SELECT max(last_run_at) INTO v_last_refresh FROM public.job_heartbeats
    WHERE job_key IN ('product_aggregates_incremental','product_aggregates_full');

  RETURN jsonb_build_object(
    'wvu', public._envelope(wvu,wvu_prev,coalesce(wvu,0)::int,'higher_is_better','wvu.live.v4',jsonb_build_object('source_kind','live')),
    'activation', public._envelope(act,act_prev,coalesce(act,0)::int,'higher_is_better','activation.live.v4',jsonb_build_object('source_kind','live')),
    'value_delivered', public._envelope(value_deliv,value_deliv_prev,coalesce(value_deliv,0)::int,'higher_is_better','value.live.v4',jsonb_build_object('source_kind','live')),
    'registered_today', public._envelope(registered,registered_prev,coalesce(registered,0)::int,'higher_is_better','registrations.live.v1',jsonb_build_object('source_kind','live')),
    'total_users', public._envelope(total_users,total_prev,coalesce(total_users,0)::int,'higher_is_better','users.total.live.v1',jsonb_build_object('source_kind','live')),
    'agent_cost_cents_today', public._envelope(cost_today,cost_prev,1,'lower_is_better','agent.cost.live.v1',jsonb_build_object('source_kind','live')),
    'messaging_failure_rate_7d', public._envelope(
      CASE WHEN msg_total=0 THEN null ELSE round(msg_failed/nullif(msg_total,0)*100,2) END,
      null,msg_total::int,'lower_is_better','messaging.failure.live.v1',jsonb_build_object('source_kind','live')),
    'attention', (
      SELECT coalesce(jsonb_agg(a),'[]'::jsonb) FROM (
        SELECT jsonb_build_object('key','messaging_failures','severity',CASE WHEN msg_failed>20 THEN 'high' WHEN msg_failed>5 THEN 'medium' ELSE 'low' END,'value',msg_failed) a WHERE msg_failed>0
        UNION ALL
        SELECT jsonb_build_object('key','missing_profiles','severity','high','value',count(*)::numeric) FROM auth.users u LEFT JOIN public.profiles p ON p.id=u.id WHERE p.id IS NULL HAVING count(*)>0
        UNION ALL
        SELECT jsonb_build_object('key','missing_pseudonyms','severity','high','value',count(*)::numeric) FROM auth.users u LEFT JOIN public.user_pseudonyms p ON p.user_id=u.id WHERE p.user_id IS NULL HAVING count(*)>0
      ) q
    ),
    'metrics_health', jsonb_build_object(
      'last_refresh_at',v_last_refresh,
      'stale',v_last_refresh IS NULL OR v_last_refresh<now()-interval '30 minutes',
      'auth_users',(SELECT count(*)::int FROM auth.users),
      'profiles',(SELECT count(*)::int FROM public.profiles),
      'pseudonyms',(SELECT count(*)::int FROM public.user_pseudonyms WHERE detached_at IS NULL),
      'measured_at',now(),
      'timezone','America/Sao_Paulo'
    ),
    'series_wvu_14d', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('day',d.day,'value',(
        SELECT count(distinct e.pseudo_id)::int FROM public.product_events e
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
      FROM (SELECT generate_series(v_today-13,v_today,'1 day')::date day) d
    )
  );
END; $$;

CREATE OR REPLACE FUNCTION public.admin_v2_metrics_audit()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public._require_perm('cockpit.read');
  RETURN jsonb_build_object(
    'auth_users',(SELECT count(*)::int FROM auth.users),
    'profiles',(SELECT count(*)::int FROM public.profiles),
    'active_pseudonyms',(SELECT count(*)::int FROM public.user_pseudonyms WHERE detached_at IS NULL),
    'missing_profiles',(SELECT count(*)::int FROM auth.users u LEFT JOIN public.profiles p ON p.id=u.id WHERE p.id IS NULL),
    'missing_pseudonyms',(SELECT count(*)::int FROM auth.users u LEFT JOIN public.user_pseudonyms p ON p.user_id=u.id WHERE p.user_id IS NULL),
    'users_with_events_30d',(SELECT count(distinct pseudo_id)::int FROM public.product_events WHERE occurred_at>=now()-interval '30 days'),
    'users_with_transactions',(SELECT count(distinct user_id)::int FROM public.transactions),
    'latest_registration',(SELECT max(created_at) FROM public.user_pseudonyms),
    'latest_event',(SELECT max(occurred_at) FROM public.product_events),
    'measured_at',now(),
    'timezone','America/Sao_Paulo',
    'formula_version','admin.metrics.audit.v1'
  );
END; $$;

-- Refresh current aggregate rows after correcting registration instrumentation.
DO $$ BEGIN
  PERFORM public.refresh_product_aggregates_full(3);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Aggregate refresh deferred: %', SQLERRM;
END $$;

-- Harden new admin function permissions consistently.
REVOKE ALL ON FUNCTION public.admin_v2_metrics_audit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_v2_metrics_audit() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.instrument_user_registration() FROM PUBLIC;
