CREATE TABLE IF NOT EXISTS public.communication_policy_settings (
  id boolean NOT NULL DEFAULT true,
  pilot_mode boolean NOT NULL DEFAULT true,
  high_priority_threshold numeric NOT NULL DEFAULT 75,
  critical_priority_threshold numeric NOT NULL DEFAULT 90,
  allow_high_priority_override boolean NOT NULL DEFAULT true,
  high_priority_kinds text[] NOT NULL DEFAULT ARRAY[
    'wealth_building_action','cash_flow_imbalance','debt_pressure','bill_due',
    'goal_feasibility','change_progress','change_reframe','recommendation_changed',
    'high_priority_financial_action'
  ]::text[],
  cap_behavior text NOT NULL DEFAULT 'defer',
  quiet_hours_high_priority_behavior text NOT NULL DEFAULT 'defer',
  attention_weights jsonb NOT NULL DEFAULT '{"care":1,"informational":2,"financial":4}'::jsonb,
  pilot_budget_multiplier numeric NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT communication_policy_settings_pkey PRIMARY KEY (id),
  CONSTRAINT communication_policy_settings_singleton CHECK (id),
  CONSTRAINT communication_policy_settings_cap_behavior_chk CHECK (cap_behavior IN ('defer','suppress')),
  CONSTRAINT communication_policy_settings_quiet_chk CHECK (quiet_hours_high_priority_behavior IN ('defer','immediate')),
  CONSTRAINT communication_policy_settings_threshold_chk CHECK (high_priority_threshold >= 0 AND critical_priority_threshold >= high_priority_threshold),
  CONSTRAINT communication_policy_settings_multiplier_chk CHECK (pilot_budget_multiplier >= 1 AND pilot_budget_multiplier <= 20)
);

GRANT SELECT ON public.communication_policy_settings TO authenticated;
GRANT ALL ON public.communication_policy_settings TO service_role;

ALTER TABLE public.communication_policy_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS communication_policy_settings_read ON public.communication_policy_settings;
CREATE POLICY communication_policy_settings_read
  ON public.communication_policy_settings FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

INSERT INTO public.communication_policy_settings (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_communication_policy_settings_touch ON public.communication_policy_settings;
CREATE TRIGGER trg_communication_policy_settings_touch
  BEFORE UPDATE ON public.communication_policy_settings
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

CREATE OR REPLACE FUNCTION public.admin_communication_policy()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public._require_perm('messaging.read');
  SELECT to_jsonb(t) - 'id' INTO v
  FROM public.communication_policy_settings t WHERE t.id;
  RETURN coalesce(v, '{}'::jsonb);
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_communication_policy_update(
  _pilot_mode boolean DEFAULT NULL,
  _high_priority_threshold numeric DEFAULT NULL,
  _critical_priority_threshold numeric DEFAULT NULL,
  _allow_high_priority_override boolean DEFAULT NULL,
  _high_priority_kinds text[] DEFAULT NULL,
  _cap_behavior text DEFAULT NULL,
  _quiet_hours_high_priority_behavior text DEFAULT NULL,
  _pilot_budget_multiplier numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public._require_perm('messaging.write');

  INSERT INTO public.communication_policy_settings (id) VALUES (true)
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.communication_policy_settings SET
    pilot_mode = coalesce(_pilot_mode, pilot_mode),
    high_priority_threshold = coalesce(_high_priority_threshold, high_priority_threshold),
    critical_priority_threshold = coalesce(_critical_priority_threshold, critical_priority_threshold),
    allow_high_priority_override = coalesce(_allow_high_priority_override, allow_high_priority_override),
    high_priority_kinds = coalesce(_high_priority_kinds, high_priority_kinds),
    cap_behavior = coalesce(_cap_behavior, cap_behavior),
    quiet_hours_high_priority_behavior = coalesce(_quiet_hours_high_priority_behavior, quiet_hours_high_priority_behavior),
    pilot_budget_multiplier = coalesce(_pilot_budget_multiplier, pilot_budget_multiplier),
    updated_by = auth.uid()
  WHERE id;

  SELECT to_jsonb(t) - 'id' INTO v FROM public.communication_policy_settings t WHERE t.id;

  INSERT INTO public.platform_admin_audit (actor_user_id, action, meta)
  VALUES (auth.uid(), 'communication_policy_update', v);

  RETURN v;
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_v2_communication_override_metrics(_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_since timestamptz := now() - (greatest(1, coalesce(_days, 30)) || ' days')::interval;
  v_totals jsonb;
  v_by_band jsonb;
  v_by_kind jsonb;
  v_by_user jsonb;
BEGIN
  PERFORM public._require_perm('messaging.read');

  WITH rows AS (
    SELECT
      d.*,
      coalesce((d.block_context->>'cap_override')::boolean, false) AS cap_override,
      nullif(d.block_context->>'cap_original_reason','') AS cap_original_reason,
      coalesce((d.block_context->>'priority_score')::numeric, 0) AS priority_score
    FROM public.communication_deliveries d
    WHERE d.created_at >= v_since
  )
  SELECT jsonb_build_object(
    'total', count(*),
    'delivered', count(*) FILTER (WHERE status IN ('delivered','queued','sent','acted')),
    'blocked_by_cap', count(*) FILTER (WHERE reason IN ('daily_frequency_cap','weekly_frequency_cap','attention_budget_exhausted')),
    'deferred', count(*) FILTER (WHERE reason LIKE '%_defer' OR coalesce((block_context->>'temporary')::boolean, false)),
    'override_delivered', count(*) FILTER (WHERE cap_override),
    'dismissed', count(*) FILTER (WHERE action_taken = 'dismissed'),
    'acted', count(*) FILTER (WHERE acted_at IS NOT NULL),
    'dismiss_rate', CASE WHEN count(*) FILTER (WHERE status IN ('delivered','queued','sent','acted')) = 0 THEN 0
      ELSE round(count(*) FILTER (WHERE action_taken = 'dismissed')::numeric
        / count(*) FILTER (WHERE status IN ('delivered','queued','sent','acted')), 4) END,
    'action_rate', CASE WHEN count(*) FILTER (WHERE status IN ('delivered','queued','sent','acted')) = 0 THEN 0
      ELSE round(count(*) FILTER (WHERE acted_at IS NOT NULL)::numeric
        / count(*) FILTER (WHERE status IN ('delivered','queued','sent','acted')), 4) END
  ) INTO v_totals FROM rows;

  WITH rows AS (
    SELECT
      coalesce((d.block_context->>'priority_score')::numeric, 0) AS priority_score,
      coalesce((d.block_context->>'cap_override')::boolean, false) AS cap_override
    FROM public.communication_deliveries d
    WHERE d.created_at >= v_since
      AND coalesce((d.block_context->>'cap_override')::boolean, false)
  ), banded AS (
    SELECT CASE
      WHEN priority_score >= 90 THEN '90+'
      WHEN priority_score >= 75 THEN '75-89'
      WHEN priority_score >= 50 THEN '50-74'
      ELSE '0-49' END AS band, count(*) AS total
    FROM rows GROUP BY 1
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('band', band, 'total', total) ORDER BY band DESC), '[]'::jsonb)
  INTO v_by_band FROM banded;

  WITH rows AS (
    SELECT d.kind,
      count(*) FILTER (WHERE coalesce((d.block_context->>'cap_override')::boolean, false)) AS overrides,
      count(*) FILTER (WHERE d.reason IN ('daily_frequency_cap','weekly_frequency_cap','attention_budget_exhausted')) AS blocked,
      count(*) FILTER (WHERE d.status IN ('delivered','queued','sent','acted')) AS delivered,
      count(*) FILTER (WHERE d.acted_at IS NOT NULL) AS acted,
      count(*) FILTER (WHERE d.action_taken = 'dismissed') AS dismissed
    FROM public.communication_deliveries d
    WHERE d.created_at >= v_since
    GROUP BY d.kind
  )
  SELECT coalesce(jsonb_agg(to_jsonb(rows) ORDER BY rows.overrides DESC, rows.delivered DESC), '[]'::jsonb)
  INTO v_by_kind FROM rows;

  WITH rows AS (
    SELECT d.user_id,
      count(*) FILTER (WHERE coalesce((d.block_context->>'cap_override')::boolean, false)) AS overrides,
      count(*) FILTER (WHERE d.status IN ('delivered','queued','sent','acted')) AS delivered,
      count(*) FILTER (WHERE d.reason IN ('daily_frequency_cap','weekly_frequency_cap','attention_budget_exhausted')) AS blocked
    FROM public.communication_deliveries d
    WHERE d.created_at >= v_since
    GROUP BY d.user_id
  )
  SELECT coalesce(jsonb_agg(to_jsonb(rows) ORDER BY rows.overrides DESC), '[]'::jsonb)
  INTO v_by_user FROM rows;

  RETURN jsonb_build_object(
    'days', greatest(1, coalesce(_days, 30)),
    'totals', coalesce(v_totals, '{}'::jsonb),
    'override_by_band', v_by_band,
    'by_kind', v_by_kind,
    'by_user', v_by_user,
    'commitments_from_override', (
      SELECT count(*) FROM public.nino_learning_events e
      WHERE e.occurred_at >= v_since
        AND e.event_type = 'communication_cap_override'
        AND coalesce((e.metadata->>'commitment_created')::boolean, false)
    )
  );
END; $function$;