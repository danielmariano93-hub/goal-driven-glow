-- emotion_finance.v1 — configuração editável do motor emocional-financeiro.
CREATE TABLE IF NOT EXISTS public.emotion_finance_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  window_days smallint NOT NULL DEFAULT 1,
  min_sample smallint NOT NULL DEFAULT 5,
  min_composite_sample smallint NOT NULL DEFAULT 4,
  min_uplift_pct numeric NOT NULL DEFAULT 15,
  min_delta_abs numeric NOT NULL DEFAULT 30,
  lookback_days smallint NOT NULL DEFAULT 120,
  prospective_enabled boolean NOT NULL DEFAULT true,
  prospective_channels text[] NOT NULL DEFAULT ARRAY['app','whatsapp']::text[],
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT ON public.emotion_finance_config TO authenticated;
GRANT ALL ON public.emotion_finance_config TO service_role;

ALTER TABLE public.emotion_finance_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "emotion_finance_config_read" ON public.emotion_finance_config;
CREATE POLICY "emotion_finance_config_read" ON public.emotion_finance_config
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.emotion_finance_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.emotion_finance_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT jsonb_build_object(
    'window_days', window_days,
    'min_sample', min_sample,
    'min_composite_sample', min_composite_sample,
    'min_uplift_pct', min_uplift_pct,
    'min_delta_abs', min_delta_abs,
    'lookback_days', lookback_days,
    'prospective_enabled', prospective_enabled,
    'prospective_channels', to_jsonb(prospective_channels)
  ) FROM public.emotion_finance_config WHERE id;
$fn$;

REVOKE ALL ON FUNCTION public.emotion_finance_settings() FROM public;
GRANT EXECUTE ON FUNCTION public.emotion_finance_settings() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_emotion_finance_config()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v jsonb;
BEGIN
  PERFORM public._require_perm('agent.read');
  SELECT public.emotion_finance_settings() || jsonb_build_object('updated_at', updated_at)
    INTO v FROM public.emotion_finance_config WHERE id;
  RETURN coalesce(v, '{}'::jsonb);
END; $fn$;

REVOKE ALL ON FUNCTION public.admin_emotion_finance_config() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_emotion_finance_config() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_emotion_finance_config_update(
  _window_days int,
  _min_sample int,
  _min_composite_sample int,
  _min_uplift_pct numeric,
  _min_delta_abs numeric,
  _lookback_days int,
  _prospective_enabled boolean,
  _prospective_channels text[]
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_window int := greatest(0, least(3, coalesce(_window_days, 1)));
  v_sample int := greatest(3, least(30, coalesce(_min_sample, 5)));
  v_comp int := greatest(3, least(30, coalesce(_min_composite_sample, 4)));
  v_uplift numeric := greatest(5, least(200, coalesce(_min_uplift_pct, 15)));
  v_delta numeric := greatest(0, least(5000, coalesce(_min_delta_abs, 30)));
  v_look int := greatest(30, least(365, coalesce(_lookback_days, 120)));
  v_channels text[] := coalesce(
    (SELECT array_agg(c) FROM unnest(coalesce(_prospective_channels, ARRAY[]::text[])) AS c
      WHERE c IN ('app','whatsapp')),
    ARRAY[]::text[]
  );
BEGIN
  PERFORM public._require_perm('agent.write');

  INSERT INTO public.emotion_finance_config AS cfg (
    id, window_days, min_sample, min_composite_sample, min_uplift_pct,
    min_delta_abs, lookback_days, prospective_enabled, prospective_channels,
    updated_at, updated_by
  ) VALUES (
    true, v_window, v_sample, v_comp, v_uplift, v_delta, v_look,
    coalesce(_prospective_enabled, true), v_channels, now(), auth.uid()
  )
  ON CONFLICT (id) DO UPDATE SET
    window_days = excluded.window_days,
    min_sample = excluded.min_sample,
    min_composite_sample = excluded.min_composite_sample,
    min_uplift_pct = excluded.min_uplift_pct,
    min_delta_abs = excluded.min_delta_abs,
    lookback_days = excluded.lookback_days,
    prospective_enabled = excluded.prospective_enabled,
    prospective_channels = excluded.prospective_channels,
    updated_at = now(),
    updated_by = excluded.updated_by;

  INSERT INTO public.platform_admin_audit (actor_user_id, action, meta)
  VALUES (auth.uid(), 'emotion_finance_config_update', public.emotion_finance_settings());

  RETURN public.emotion_finance_settings();
END; $fn$;

REVOKE ALL ON FUNCTION public.admin_emotion_finance_config_update(int,int,int,numeric,numeric,int,boolean,text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_emotion_finance_config_update(int,int,int,numeric,numeric,int,boolean,text[]) TO authenticated;