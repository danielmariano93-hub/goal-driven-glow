-- Limite sugerido na tela de hábitos: o compromisso só nasce após o aceite explícito da pessoa.
-- Reaproveita weekend_commitments (mesmo fechamento de segunda do WhatsApp). 'declined' = a pessoa recusou.
ALTER TABLE public.weekend_commitments DROP CONSTRAINT IF EXISTS weekend_commitments_status_check;
ALTER TABLE public.weekend_commitments ADD CONSTRAINT weekend_commitments_status_check
  CHECK (status IN ('offered', 'accepted', 'info', 'kept', 'missed', 'expired', 'declined'));

CREATE OR REPLACE FUNCTION public.habit_limit_accept(
  p_category text, p_friday date, p_target numeric,
  p_expected numeric DEFAULT NULL, p_projected_before numeric DEFAULT NULL, p_projected_if_met numeric DEFAULT NULL,
  p_anchor_kind text DEFAULT NULL, p_anchor_amount numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF NOT public.habits_v2_enabled() THEN RAISE EXCEPTION 'habits_v2_not_enabled' USING ERRCODE = '42501'; END IF;
  IF p_category IS NULL OR btrim(p_category) = '' OR char_length(p_category) > 80 THEN RAISE EXCEPTION 'invalid_category' USING ERRCODE = '22023'; END IF;
  IF p_target IS NULL OR p_target <= 0 OR p_target > 1000000 THEN RAISE EXCEPTION 'invalid_target' USING ERRCODE = '22023'; END IF;
  -- Só vale para o fim de semana corrente ou o próximo (sexta de hoje −2 dias a +7 dias).
  IF p_friday < (current_date - 2) OR p_friday > (current_date + 7) THEN RAISE EXCEPTION 'invalid_weekend' USING ERRCODE = '22023'; END IF;
  IF p_anchor_kind IS NOT NULL AND p_anchor_kind NOT IN ('goal', 'average') THEN RAISE EXCEPTION 'invalid_anchor' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.weekend_commitments(user_id, friday, category, status, target_amount, expected_amount, projected_before, projected_if_met, anchor_kind, anchor_amount, accepted_at, detail)
  VALUES (v_uid, p_friday, btrim(p_category), 'accepted', p_target, p_expected, p_projected_before, p_projected_if_met, p_anchor_kind, p_anchor_amount, now(), 'aceito na tela de hábitos')
  ON CONFLICT (user_id, friday, category) DO UPDATE
    SET status = 'accepted', target_amount = EXCLUDED.target_amount, expected_amount = COALESCE(EXCLUDED.expected_amount, public.weekend_commitments.expected_amount),
        projected_before = COALESCE(EXCLUDED.projected_before, public.weekend_commitments.projected_before),
        projected_if_met = COALESCE(EXCLUDED.projected_if_met, public.weekend_commitments.projected_if_met),
        anchor_kind = COALESCE(EXCLUDED.anchor_kind, public.weekend_commitments.anchor_kind),
        anchor_amount = COALESCE(EXCLUDED.anchor_amount, public.weekend_commitments.anchor_amount),
        accepted_at = now()
    WHERE public.weekend_commitments.status IN ('offered', 'info', 'declined', 'accepted', 'expired');
END;
$$;

CREATE OR REPLACE FUNCTION public.habit_limit_decline(p_category text, p_friday date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF NOT public.habits_v2_enabled() THEN RAISE EXCEPTION 'habits_v2_not_enabled' USING ERRCODE = '42501'; END IF;
  IF p_category IS NULL OR btrim(p_category) = '' OR char_length(p_category) > 80 THEN RAISE EXCEPTION 'invalid_category' USING ERRCODE = '22023'; END IF;
  IF p_friday < (current_date - 2) OR p_friday > (current_date + 7) THEN RAISE EXCEPTION 'invalid_weekend' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.weekend_commitments(user_id, friday, category, status, detail)
  VALUES (v_uid, p_friday, btrim(p_category), 'declined', 'recusado na tela de hábitos')
  ON CONFLICT (user_id, friday, category) DO UPDATE SET status = 'declined', target_amount = NULL
    WHERE public.weekend_commitments.status IN ('offered', 'info', 'accepted', 'expired', 'declined');
END;
$$;

REVOKE ALL ON FUNCTION public.habit_limit_accept(text, date, numeric, numeric, numeric, numeric, text, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.habit_limit_decline(text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.habit_limit_accept(text, date, numeric, numeric, numeric, numeric, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.habit_limit_decline(text, date) TO authenticated;
