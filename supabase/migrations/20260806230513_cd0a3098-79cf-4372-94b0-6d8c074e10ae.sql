ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS donation_income_scope TEXT NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS donation_income_category_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS donation_due_day INTEGER NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS donation_end_date DATE;

DELETE FROM public.user_challenges uc
USING public.challenges legacy
WHERE uc.challenge_id = legacy.id
  AND uc.challenge_slug IS NULL
  AND EXISTS (
    SELECT 1 FROM public.user_challenges current
    WHERE current.user_id = uc.user_id AND current.challenge_slug = legacy.slug
  );

UPDATE public.user_challenges uc
SET challenge_slug = legacy.slug,
    updated_at = now()
FROM public.challenges legacy
JOIN public.challenges_catalog catalog ON catalog.slug = legacy.slug
WHERE uc.challenge_id = legacy.id
  AND uc.challenge_slug IS NULL;

CREATE OR REPLACE FUNCTION public.challenge_progress_add(
  p_slug TEXT, p_delta INTEGER, p_source_type TEXT, p_source_id TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_challenge RECORD;
  v_before NUMERIC;
  v_after NUMERIC;
  v_row_id UUID;
BEGIN
  IF v_uid IS NULL OR p_delta <= 0 THEN RETURN; END IF;
  SELECT * INTO v_challenge FROM public.challenges_catalog WHERE slug = p_slug AND active;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT id, current_progress INTO v_row_id, v_before
  FROM public.user_challenges
  WHERE user_id = v_uid AND challenge_slug = p_slug AND status = 'joined'
  FOR UPDATE;
  IF v_row_id IS NULL THEN RETURN; END IF;

  INSERT INTO public.xp_events(user_id, source_type, source_id, xp_delta, reason)
  VALUES (v_uid, p_source_type, p_source_id, 0, 'challenge_progress')
  ON CONFLICT (user_id, source_type, source_id) DO NOTHING;
  IF NOT FOUND THEN RETURN; END IF;

  v_after := LEAST(v_before + p_delta, v_challenge.goal_value);
  UPDATE public.user_challenges SET
    current_progress = v_after,
    progress = LEAST(100, ROUND(v_after * 100.0 / GREATEST(1, v_challenge.goal_value))),
    status = CASE WHEN v_after >= v_challenge.goal_value THEN 'completed'::public.user_challenge_status ELSE status END,
    finished_at = CASE WHEN v_after >= v_challenge.goal_value THEN now() ELSE finished_at END,
    updated_at = now()
  WHERE id = v_row_id;

  IF v_before < v_challenge.goal_value AND v_after >= v_challenge.goal_value THEN
    UPDATE public.xp_events SET xp_delta = v_challenge.xp_reward, reason = 'challenge_completed'
    WHERE user_id = v_uid AND source_type = p_source_type AND source_id = p_source_id;
    INSERT INTO public.user_gamification(user_id, total_xp)
    VALUES (v_uid, v_challenge.xp_reward)
    ON CONFLICT (user_id) DO UPDATE SET
      total_xp = public.user_gamification.total_xp + v_challenge.xp_reward,
      updated_at = now();
    INSERT INTO public.notifications(user_id,type,title,body,action_url,dedup_key)
    VALUES (v_uid,'achievement','Desafio concluído!',v_challenge.title,'/app/desafios','challenge:' || p_slug)
    ON CONFLICT (user_id,dedup_key) DO NOTHING;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.challenge_progress_add(TEXT, INTEGER, TEXT, TEXT) TO authenticated;

DO $$ BEGIN
  ALTER TABLE public.goals ADD CONSTRAINT goals_donation_income_scope_check
    CHECK (donation_income_scope IN ('all','selected_categories'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.goals ADD CONSTRAINT goals_donation_due_day_check
    CHECK (donation_due_day BETWEEN 1 AND 28);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO public.communication_catalog
  (kind, label, family, description, base_priority, allowed_channels, cooldown_hours, content_mode, active)
VALUES
  ('emotional_checkin_due', 'Lembrete de check-in emocional', 'behavior',
   'Convite leve quando o usuário acessou o Nino e ainda não registrou o emocional do dia.',
   35, ARRAY['app','whatsapp']::text[], 20, 'template', true)
ON CONFLICT (kind) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  allowed_channels = EXCLUDED.allowed_channels,
  cooldown_hours = EXCLUDED.cooldown_hours,
  active = true;

INSERT INTO public.communication_templates
  (kind, channel, title_template, body_template, active, version)
VALUES
  ('emotional_checkin_due', 'app', 'Como você está hoje?',
   'Um check-in de poucos segundos ajuda o Nino a entender o contexto das suas decisões, sem julgamento.', true, 1),
  ('emotional_checkin_due', 'whatsapp', 'Um minuto para você',
   'Como você está se sentindo hoje? Registrar esse contexto ajuda o Nino a reconhecer padrões com mais cuidado.', true, 1)
ON CONFLICT (kind, channel, version) DO UPDATE SET
  title_template = EXCLUDED.title_template,
  body_template = EXCLUDED.body_template,
  active = true;