CREATE TABLE public.user_advisor_topic_affinity (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  topic_key TEXT NOT NULL,
  score NUMERIC NOT NULL DEFAULT 0,
  signals INTEGER NOT NULL DEFAULT 0,
  last_signal TEXT,
  last_seen_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, topic_key)
);
GRANT SELECT ON public.user_advisor_topic_affinity TO authenticated;
GRANT ALL ON public.user_advisor_topic_affinity TO service_role;
ALTER TABLE public.user_advisor_topic_affinity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "affinity_own_read" ON public.user_advisor_topic_affinity FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.financial_performance_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  as_of DATE NOT NULL,
  mode TEXT NOT NULL,
  headline TEXT NOT NULL,
  methodology TEXT,
  highlights JSONB NOT NULL DEFAULT '[]'::jsonb,
  suppressed JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_action TEXT,
  formula_version TEXT NOT NULL,
  valid_until DATE,
  invalidated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fps_user_valid ON public.financial_performance_snapshots (user_id, as_of DESC) WHERE invalidated_at IS NULL;
GRANT SELECT ON public.financial_performance_snapshots TO authenticated;
GRANT ALL ON public.financial_performance_snapshots TO service_role;
ALTER TABLE public.financial_performance_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fps_own_read" ON public.financial_performance_snapshots FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.advisor_register_topic_signal(_topic_key TEXT, _signal TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _delta NUMERIC;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  _delta := CASE _signal
    WHEN 'acted' THEN 0.35
    WHEN 'asked_more' THEN 0.25
    WHEN 'followed_up' THEN 0.25
    WHEN 'opened' THEN 0.1
    WHEN 'ignored' THEN -0.05
    WHEN 'dismissed' THEN -0.2
    WHEN 'marked_not_useful' THEN -0.4
    ELSE 0 END;
  INSERT INTO public.user_advisor_topic_affinity (user_id, topic_key, score, signals, last_signal, last_seen_at)
  VALUES (_uid, _topic_key, GREATEST(-1, LEAST(1, _delta)), 1, _signal, CURRENT_DATE)
  ON CONFLICT (user_id, topic_key) DO UPDATE
    SET score = GREATEST(-1, LEAST(1, public.user_advisor_topic_affinity.score + _delta)),
        signals = public.user_advisor_topic_affinity.signals + 1,
        last_signal = _signal,
        last_seen_at = CURRENT_DATE,
        updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.advisor_register_topic_signal(TEXT, TEXT) TO authenticated;