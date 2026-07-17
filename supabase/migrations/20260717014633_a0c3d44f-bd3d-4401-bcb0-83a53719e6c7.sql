-- Pulse snapshots (histórico do Pulso Financeiro por usuário)
CREATE TABLE IF NOT EXISTS public.pulse_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  band TEXT NOT NULL,
  factors JSONB NOT NULL DEFAULT '{}'::jsonb,
  next_action TEXT,
  week_delta NUMERIC(6,2),
  state TEXT NOT NULL DEFAULT 'ok',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pulse_snapshots_user_time
  ON public.pulse_snapshots (user_id, computed_at DESC);

GRANT SELECT, INSERT ON public.pulse_snapshots TO authenticated;
GRANT ALL ON public.pulse_snapshots TO service_role;

ALTER TABLE public.pulse_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own pulse snapshots read" ON public.pulse_snapshots;
CREATE POLICY "own pulse snapshots read"
  ON public.pulse_snapshots FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "own pulse snapshots insert" ON public.pulse_snapshots;
CREATE POLICY "own pulse snapshots insert"
  ON public.pulse_snapshots FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Consolidação diária dos check-ins emocionais (anti-gaming):
-- um único check-in por dia por usuário (data local America/Sao_Paulo).
CREATE UNIQUE INDEX IF NOT EXISTS emotional_checkins_one_per_day
  ON public.emotional_checkins (user_id, ((occurred_at AT TIME ZONE 'America/Sao_Paulo')::date));
