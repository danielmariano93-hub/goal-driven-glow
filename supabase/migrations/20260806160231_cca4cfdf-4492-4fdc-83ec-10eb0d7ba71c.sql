-- 1) Desafios: alinhar user_challenges ao catálogo por slug
ALTER TABLE public.user_challenges
  ALTER COLUMN challenge_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS challenge_slug TEXT REFERENCES public.challenges_catalog(slug) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS current_progress NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS user_challenges_user_slug_key
  ON public.user_challenges (user_id, challenge_slug) WHERE challenge_slug IS NOT NULL;

-- 2) Registro emocional canônico
ALTER TABLE public.emotional_checkins
  ADD COLUMN IF NOT EXISTS emotion_key TEXT;
UPDATE public.emotional_checkins SET emotion_key = trigger_label WHERE emotion_key IS NULL;

-- 3) Metas: tipo e doação
ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'savings',
  ADD COLUMN IF NOT EXISTS donation_mode TEXT,
  ADD COLUMN IF NOT EXISTS donation_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS monthly_target NUMERIC;

DO $$ BEGIN
  ALTER TABLE public.goals ADD CONSTRAINT goals_kind_check CHECK (kind IN ('savings','donation'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.goals ADD CONSTRAINT goals_donation_mode_check
    CHECK (donation_mode IS NULL OR donation_mode IN ('fixed','income_percent'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4) RPCs de desafios
DROP FUNCTION IF EXISTS public.join_challenge(TEXT);
DROP FUNCTION IF EXISTS public.abandon_challenge(TEXT);
DROP FUNCTION IF EXISTS public.complete_challenge(TEXT);

CREATE OR REPLACE FUNCTION public.join_challenge(p_slug TEXT)
RETURNS public.user_challenges
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.user_challenges;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.challenges_catalog c WHERE c.slug = p_slug AND c.active) THEN
    RAISE EXCEPTION 'challenge_not_found';
  END IF;

  INSERT INTO public.user_challenges (user_id, challenge_slug, status, progress, current_progress, started_at)
  VALUES (v_uid, p_slug, 'joined', 0, 0, now())
  ON CONFLICT (user_id, challenge_slug) WHERE challenge_slug IS NOT NULL
  DO UPDATE SET status = 'joined', progress = 0, current_progress = 0,
                started_at = now(), finished_at = NULL, updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.abandon_challenge(p_slug TEXT)
RETURNS public.user_challenges
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.user_challenges;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  UPDATE public.user_challenges
     SET status = 'abandoned', finished_at = now(), updated_at = now()
   WHERE user_id = v_uid AND challenge_slug = p_slug
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'challenge_not_joined'; END IF;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_challenge(p_slug TEXT)
RETURNS public.user_challenges
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.user_challenges;
  v_xp INTEGER;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT COALESCE(xp_reward, 0) INTO v_xp FROM public.challenges_catalog WHERE slug = p_slug;
  IF v_xp IS NULL THEN RAISE EXCEPTION 'challenge_not_found'; END IF;

  UPDATE public.user_challenges
     SET status = 'completed', progress = 100, finished_at = now(), updated_at = now()
   WHERE user_id = v_uid AND challenge_slug = p_slug
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'challenge_not_joined'; END IF;

  INSERT INTO public.xp_events (user_id, source_type, source_id, xp_delta, reason)
  VALUES (v_uid, 'challenge', v_row.id, v_xp, 'Desafio concluído: ' || p_slug)
  ON CONFLICT (user_id, source_type, source_id) DO NOTHING;

  INSERT INTO public.user_gamification (user_id, total_xp)
  VALUES (v_uid, v_xp)
  ON CONFLICT (user_id) DO UPDATE
    SET total_xp = public.user_gamification.total_xp + v_xp, updated_at = now();

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_challenge(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abandon_challenge(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_challenge(TEXT) TO authenticated;