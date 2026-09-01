ALTER TABLE public.communication_policy_settings
  ADD COLUMN IF NOT EXISTS pilot_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

CREATE OR REPLACE FUNCTION public.admin_communication_policy()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r public.communication_policy_settings;
BEGIN
  PERFORM public._require_perm('messaging.read');
  SELECT * INTO r FROM public.communication_policy_settings LIMIT 1;
  RETURN jsonb_build_object(
    'pilot_mode', COALESCE(r.pilot_mode, false),
    'pilot_user_ids', COALESCE(to_jsonb(r.pilot_user_ids), '[]'::jsonb),
    'high_priority_threshold', COALESCE(r.high_priority_threshold, 75),
    'critical_priority_threshold', COALESCE(r.critical_priority_threshold, 90),
    'allow_high_priority_override', COALESCE(r.allow_high_priority_override, false),
    'high_priority_kinds', COALESCE(to_jsonb(r.high_priority_kinds), '[]'::jsonb),
    'cap_behavior', COALESCE(r.cap_behavior, 'suppress'),
    'quiet_hours_high_priority_behavior', COALESCE(r.quiet_hours_high_priority_behavior, 'defer'),
    'attention_weights', COALESCE(r.attention_weights, '{"care":1,"informational":2,"financial":4}'::jsonb),
    'pilot_budget_multiplier', COALESCE(r.pilot_budget_multiplier, 3),
    'updated_at', r.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_communication_policy_update(
  _pilot_mode boolean,
  _high_priority_threshold numeric,
  _critical_priority_threshold numeric,
  _allow_high_priority_override boolean,
  _high_priority_kinds text[],
  _cap_behavior text,
  _quiet_hours_high_priority_behavior text,
  _pilot_budget_multiplier numeric,
  _pilot_user_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r public.communication_policy_settings;
BEGIN
  PERFORM public._require_perm('messaging.write');
  IF _cap_behavior NOT IN ('defer','suppress') THEN
    RAISE EXCEPTION 'cap_behavior invalido';
  END IF;
  IF _quiet_hours_high_priority_behavior NOT IN ('defer','immediate') THEN
    RAISE EXCEPTION 'quiet_hours_high_priority_behavior invalido';
  END IF;
  IF _critical_priority_threshold < _high_priority_threshold THEN
    RAISE EXCEPTION 'limiar critico deve ser maior ou igual ao alto';
  END IF;

  SELECT * INTO r FROM public.communication_policy_settings LIMIT 1;
  IF r.id IS NULL THEN
    INSERT INTO public.communication_policy_settings DEFAULT VALUES RETURNING * INTO r;
  END IF;

  UPDATE public.communication_policy_settings SET
    pilot_mode = _pilot_mode,
    high_priority_threshold = _high_priority_threshold,
    critical_priority_threshold = _critical_priority_threshold,
    allow_high_priority_override = _allow_high_priority_override,
    high_priority_kinds = COALESCE(_high_priority_kinds, high_priority_kinds),
    cap_behavior = _cap_behavior,
    quiet_hours_high_priority_behavior = _quiet_hours_high_priority_behavior,
    pilot_budget_multiplier = GREATEST(1, LEAST(20, _pilot_budget_multiplier)),
    pilot_user_ids = COALESCE(_pilot_user_ids, pilot_user_ids),
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = r.id;

  RETURN public.admin_communication_policy();
END;
$$;