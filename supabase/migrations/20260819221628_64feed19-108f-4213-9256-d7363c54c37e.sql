CREATE TABLE public.proactive_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  as_of date NOT NULL,
  signal_key text NOT NULL,
  domain text NOT NULL,
  label text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  direction text NOT NULL DEFAULT 'context',
  event_date date,
  days_until integer,
  confidence numeric NOT NULL DEFAULT 0.7,
  actionable boolean NOT NULL DEFAULT false,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  formula_version text NOT NULL DEFAULT 'proactive_multifinance.v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, as_of, signal_key)
);

GRANT SELECT ON public.proactive_signals TO authenticated;
GRANT ALL ON public.proactive_signals TO service_role;
ALTER TABLE public.proactive_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "proactive_signals_own_read" ON public.proactive_signals
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.proactive_situations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  fingerprint text NOT NULL,
  as_of date NOT NULL,
  situation_type text NOT NULL,
  communication_kind text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  primary_domain text NOT NULL,
  domains jsonb NOT NULL DEFAULT '[]'::jsonb,
  impact_amount numeric NOT NULL DEFAULT 0,
  days_until integer,
  confidence numeric NOT NULL DEFAULT 0.7,
  actionable boolean NOT NULL DEFAULT false,
  priority_score numeric NOT NULL DEFAULT 0,
  score_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_delivered_at timestamptz,
  formula_version text NOT NULL DEFAULT 'proactive_multifinance.v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, fingerprint)
);

GRANT SELECT ON public.proactive_situations TO authenticated;
GRANT ALL ON public.proactive_situations TO service_role;
ALTER TABLE public.proactive_situations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "proactive_situations_own_read" ON public.proactive_situations
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.proactive_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  as_of date NOT NULL,
  fingerprint text NOT NULL,
  channel text NOT NULL,
  decision text NOT NULL,
  reason text NOT NULL,
  priority_score numeric NOT NULL DEFAULT 0,
  formula_version text NOT NULL DEFAULT 'proactive_multifinance.v1',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.proactive_decisions TO authenticated;
GRANT ALL ON public.proactive_decisions TO service_role;
ALTER TABLE public.proactive_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "proactive_decisions_own_read" ON public.proactive_decisions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE INDEX proactive_signals_user_day_idx ON public.proactive_signals (user_id, as_of DESC);
CREATE INDEX proactive_situations_user_score_idx ON public.proactive_situations (user_id, priority_score DESC);
CREATE INDEX proactive_decisions_day_idx ON public.proactive_decisions (as_of DESC, decision);

CREATE TRIGGER proactive_signals_touch BEFORE UPDATE ON public.proactive_signals
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();
CREATE TRIGGER proactive_situations_touch BEFORE UPDATE ON public.proactive_situations
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

CREATE OR REPLACE FUNCTION public.admin_v2_proactive_intelligence_funnel(_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _from date := (now() AT TIME ZONE 'America/Sao_Paulo')::date - GREATEST(1, COALESCE(_days, 30));
  _result jsonb;
BEGIN
  PERFORM public._require_perm('analytics.read');

  SELECT jsonb_build_object(
    'window_days', GREATEST(1, COALESCE(_days, 30)),
    'signals', (SELECT COUNT(*) FROM public.proactive_signals WHERE as_of >= _from),
    'situations', (SELECT COUNT(*) FROM public.proactive_situations WHERE as_of >= _from),
    'delivered', (SELECT COUNT(*) FROM public.proactive_decisions WHERE as_of >= _from AND decision = 'deliver'),
    'suppressed', (SELECT COUNT(*) FROM public.proactive_decisions WHERE as_of >= _from AND decision = 'suppress'),
    'by_domain', COALESCE((
      SELECT jsonb_agg(row_to_json(d)) FROM (
        SELECT primary_domain AS domain, COUNT(*) AS total,
               ROUND(AVG(priority_score)::numeric, 2) AS avg_score,
               ROUND(SUM(impact_amount)::numeric, 2) AS impact
        FROM public.proactive_situations
        WHERE as_of >= _from
        GROUP BY primary_domain ORDER BY 2 DESC
      ) d), '[]'::jsonb),
    'by_type', COALESCE((
      SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT situation_type AS type, COUNT(*) AS total,
               ROUND(AVG(priority_score)::numeric, 2) AS avg_score,
               COUNT(*) FILTER (WHERE last_delivered_at IS NOT NULL) AS delivered
        FROM public.proactive_situations
        WHERE as_of >= _from
        GROUP BY situation_type ORDER BY 2 DESC LIMIT 20
      ) t), '[]'::jsonb),
    'by_reason', COALESCE((
      SELECT jsonb_agg(row_to_json(r)) FROM (
        SELECT reason, channel, COUNT(*) AS total
        FROM public.proactive_decisions
        WHERE as_of >= _from AND decision = 'suppress'
        GROUP BY reason, channel ORDER BY 3 DESC LIMIT 20
      ) r), '[]'::jsonb),
    'cross_domain', COALESCE((
      SELECT COUNT(*) FROM public.proactive_situations
      WHERE as_of >= _from AND jsonb_array_length(domains) > 1
    ), 0),
    'measured_at', now()
  ) INTO _result;

  RETURN _result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_v2_proactive_intelligence_funnel(integer) TO authenticated;