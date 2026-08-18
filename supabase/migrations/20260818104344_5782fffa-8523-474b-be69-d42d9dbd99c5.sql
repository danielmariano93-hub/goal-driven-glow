CREATE TABLE IF NOT EXISTS public.proactive_reminder_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  emotional_enabled boolean NOT NULL DEFAULT true,
  emotional_hour integer NOT NULL DEFAULT 19,
  emotional_requires_activity boolean NOT NULL DEFAULT false,
  emotional_channels text[] NOT NULL DEFAULT ARRAY['app','whatsapp']::text[],
  care_max_per_day integer NOT NULL DEFAULT 1,
  care_max_per_week integer NOT NULL DEFAULT 4,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT ALL ON public.proactive_reminder_settings TO service_role;
ALTER TABLE public.proactive_reminder_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'proactive_reminder_settings'
      AND policyname = 'reminder_settings_service_only'
  ) THEN
    CREATE POLICY reminder_settings_service_only
      ON public.proactive_reminder_settings FOR ALL
      TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

INSERT INTO public.proactive_reminder_settings (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_reminder_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public._require_perm('messaging.read');
  SELECT jsonb_build_object(
    'emotional_enabled', emotional_enabled,
    'emotional_hour', emotional_hour,
    'emotional_requires_activity', emotional_requires_activity,
    'emotional_channels', to_jsonb(emotional_channels),
    'care_max_per_day', care_max_per_day,
    'care_max_per_week', care_max_per_week,
    'updated_at', updated_at
  ) INTO v FROM public.proactive_reminder_settings WHERE id;
  RETURN coalesce(v, jsonb_build_object(
    'emotional_enabled', true, 'emotional_hour', 19,
    'emotional_requires_activity', false,
    'emotional_channels', jsonb_build_array('app','whatsapp'),
    'care_max_per_day', 1, 'care_max_per_week', 4, 'updated_at', null));
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_reminder_settings_update(
  _emotional_enabled boolean DEFAULT NULL,
  _emotional_hour integer DEFAULT NULL,
  _emotional_requires_activity boolean DEFAULT NULL,
  _emotional_channels text[] DEFAULT NULL,
  _care_max_per_day integer DEFAULT NULL,
  _care_max_per_week integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_row public.proactive_reminder_settings%ROWTYPE;
BEGIN
  PERFORM public._require_perm('messaging.write');

  INSERT INTO public.proactive_reminder_settings (id) VALUES (true)
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.proactive_reminder_settings SET
    emotional_enabled = coalesce(_emotional_enabled, emotional_enabled),
    emotional_hour = coalesce(greatest(0, least(23, _emotional_hour)), emotional_hour),
    emotional_requires_activity = coalesce(_emotional_requires_activity, emotional_requires_activity),
    emotional_channels = coalesce(
      (SELECT array_agg(c) FROM unnest(_emotional_channels) AS c WHERE c IN ('app','whatsapp')),
      emotional_channels),
    care_max_per_day = coalesce(greatest(0, least(5, _care_max_per_day)), care_max_per_day),
    care_max_per_week = coalesce(greatest(0, least(21, _care_max_per_week)), care_max_per_week),
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id
  RETURNING * INTO v_row;

  INSERT INTO public.platform_admin_audit (actor_user_id, action, meta)
  VALUES (auth.uid(), 'proactive_reminder_settings_update', to_jsonb(v_row));

  RETURN to_jsonb(v_row);
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_communication_catalog_update(
  _kind text,
  _active boolean DEFAULT NULL::boolean,
  _base_priority integer DEFAULT NULL::integer,
  _allowed_channels text[] DEFAULT NULL::text[],
  _cooldown_hours integer DEFAULT NULL::integer,
  _max_per_day integer DEFAULT NULL::integer,
  _requires_manual_approval boolean DEFAULT NULL::boolean,
  _default_channels text[] DEFAULT NULL::text[],
  _min_severity_for_whatsapp text DEFAULT NULL::text,
  _sensitivity text DEFAULT NULL::text,
  _default_window_hours integer DEFAULT NULL::integer,
  _whatsapp_min_absolute_impact numeric DEFAULT NULL::numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.communication_catalog%ROWTYPE;
BEGIN
  PERFORM public._require_perm('messaging.write');

  IF _min_severity_for_whatsapp IS NOT NULL
     AND _min_severity_for_whatsapp NOT IN ('info','attention','critical') THEN
    RAISE EXCEPTION 'invalid_min_severity' USING errcode = '22023';
  END IF;
  IF _sensitivity IS NOT NULL AND _sensitivity NOT IN ('normal','high') THEN
    RAISE EXCEPTION 'invalid_sensitivity' USING errcode = '22023';
  END IF;

  UPDATE public.communication_catalog SET
    active = coalesce(_active, active),
    base_priority = coalesce(_base_priority, base_priority),
    allowed_channels = coalesce(_allowed_channels, allowed_channels),
    cooldown_hours = coalesce(_cooldown_hours, cooldown_hours),
    max_per_day = coalesce(_max_per_day, max_per_day),
    requires_manual_approval = coalesce(_requires_manual_approval, requires_manual_approval),
    default_channels = coalesce(
      (SELECT array_agg(c) FROM unnest(_default_channels) AS c WHERE c IN ('app','whatsapp')),
      default_channels),
    min_severity_for_whatsapp = coalesce(_min_severity_for_whatsapp, min_severity_for_whatsapp),
    sensitivity = coalesce(_sensitivity, sensitivity),
    default_window_hours = coalesce(_default_window_hours, default_window_hours),
    whatsapp_min_absolute_impact = coalesce(_whatsapp_min_absolute_impact, whatsapp_min_absolute_impact),
    updated_at = now()
  WHERE kind = _kind
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'kind_not_found' USING errcode = 'P0002';
  END IF;

  INSERT INTO public.platform_admin_audit (actor_user_id, action, meta)
  VALUES (
    auth.uid(),
    'communication_catalog_update',
    jsonb_build_object(
      'target_type', 'communication_catalog',
      'target_id', _kind,
      'active', v_row.active,
      'base_priority', v_row.base_priority,
      'allowed_channels', to_jsonb(v_row.allowed_channels),
      'default_channels', to_jsonb(v_row.default_channels),
      'min_severity_for_whatsapp', v_row.min_severity_for_whatsapp,
      'sensitivity', v_row.sensitivity,
      'cooldown_hours', v_row.cooldown_hours,
      'max_per_day', v_row.max_per_day,
      'requires_manual_approval', v_row.requires_manual_approval
    )
  );

  RETURN to_jsonb(v_row);
END;
$function$;