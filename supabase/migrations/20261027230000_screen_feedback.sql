-- Opinião rápida sobre uma tela ("Compartilhe sua opinião"): positiva/negativa + comentário opcional.
CREATE TABLE IF NOT EXISTS public.screen_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  screen text NOT NULL CHECK (char_length(screen) BETWEEN 1 AND 60),
  rating smallint NOT NULL CHECK (rating IN (-1, 1)),
  comment text CHECK (comment IS NULL OR char_length(comment) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.screen_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS screen_feedback_insert_own ON public.screen_feedback;
CREATE POLICY screen_feedback_insert_own ON public.screen_feedback
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS screen_feedback_select_own ON public.screen_feedback;
CREATE POLICY screen_feedback_select_own ON public.screen_feedback
  FOR SELECT TO authenticated USING (user_id = auth.uid());
GRANT SELECT, INSERT ON public.screen_feedback TO authenticated;
GRANT ALL ON public.screen_feedback TO service_role;
CREATE INDEX IF NOT EXISTS screen_feedback_screen_idx ON public.screen_feedback (screen, created_at DESC);
