
DELETE FROM public.user_insights
WHERE title IS NULL OR btrim(title) = '' OR body IS NULL OR btrim(body) = '';

ALTER TABLE public.user_insights
  ADD CONSTRAINT user_insights_title_nonempty CHECK (title IS NOT NULL AND btrim(title) <> ''),
  ADD CONSTRAINT user_insights_body_nonempty  CHECK (body  IS NOT NULL AND btrim(body)  <> '');
