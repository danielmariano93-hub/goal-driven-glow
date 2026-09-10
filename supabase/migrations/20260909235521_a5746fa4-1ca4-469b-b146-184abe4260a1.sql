-- emotion_catalog.v3 — sentimento personalizado por pessoa e rastro de revisão.
CREATE TABLE IF NOT EXISTS public.user_emotions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  emotion_key text NOT NULL,
  label text NOT NULL,
  mood smallint NOT NULL DEFAULT 3,
  emoji text NOT NULL DEFAULT '🫥',
  use_count integer NOT NULL DEFAULT 1,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_emotions_mood_range CHECK (mood BETWEEN 1 AND 5),
  CONSTRAINT user_emotions_key_unique UNIQUE (user_id, emotion_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_emotions TO authenticated;
GRANT ALL ON public.user_emotions TO service_role;

ALTER TABLE public.user_emotions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_emotions_own" ON public.user_emotions
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP TRIGGER IF EXISTS trg_user_emotions_updated_at ON public.user_emotions;
CREATE TRIGGER trg_user_emotions_updated_at
  BEFORE UPDATE ON public.user_emotions
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

-- Rastro de revisão do histórico emocional (backfill auditável).
ALTER TABLE public.emotional_checkins
  ADD COLUMN IF NOT EXISTS revised_at timestamptz,
  ADD COLUMN IF NOT EXISTS revised_from_emotion_key text,
  ADD COLUMN IF NOT EXISTS revision_reason text;