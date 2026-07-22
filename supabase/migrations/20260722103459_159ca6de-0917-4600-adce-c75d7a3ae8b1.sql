ALTER TABLE public.user_insights DROP CONSTRAINT IF EXISTS user_insights_type_check;
ALTER TABLE public.user_insights ADD CONSTRAINT user_insights_type_check
  CHECK (type IN ('habit','alert','celebration','onboarding','opportunity','categorize_transaction'));
UPDATE public.user_insights SET status='expired' WHERE status='active' AND expires_at < now();