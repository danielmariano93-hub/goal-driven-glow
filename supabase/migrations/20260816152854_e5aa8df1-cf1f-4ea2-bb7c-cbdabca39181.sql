CREATE OR REPLACE FUNCTION public.agent_learn_merchant_category(
  p_user_id uuid,
  p_transaction_id uuid,
  p_category_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tx public.transactions%ROWTYPE;
  v_cat public.categories%ROWTYPE;
  v_key text;
  v_name text;
BEGIN
  IF p_user_id IS NULL OR p_transaction_id IS NULL OR p_category_id IS NULL THEN
    RETURN jsonb_build_object('learned', false, 'reason', 'missing_args');
  END IF;

  SELECT * INTO v_tx FROM public.transactions
   WHERE id = p_transaction_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('learned', false, 'reason', 'transaction_not_found');
  END IF;

  IF v_tx.type NOT IN ('income','expense')
     OR coalesce(v_tx.movement_kind,'transaction') <> 'transaction' THEN
    RETURN jsonb_build_object('learned', false, 'reason', 'not_consumption');
  END IF;

  SELECT * INTO v_cat FROM public.categories
   WHERE id = p_category_id AND (user_id = p_user_id OR user_id IS NULL);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('learned', false, 'reason', 'category_not_found');
  END IF;

  v_name := coalesce(nullif(v_tx.friendly_description,''), nullif(v_tx.description,''), nullif(v_tx.raw_description,''));
  v_key := public.category_alias_key(coalesce(v_tx.normalized_description, v_name));
  IF v_key IS NULL OR length(v_key) < 3 THEN
    RETURN jsonb_build_object('learned', false, 'reason', 'weak_merchant_key');
  END IF;

  INSERT INTO public.merchant_aliases(user_id, alias_key, friendly_name, category_id, learned_from, hits, last_used_at, confirmed_by_user_at)
  VALUES (p_user_id, v_key, coalesce(v_name, v_key), p_category_id, 'manual', 1, now(), now())
  ON CONFLICT (user_id, alias_key) DO UPDATE SET
    friendly_name = excluded.friendly_name,
    category_id = excluded.category_id,
    learned_from = 'manual',
    hits = public.merchant_aliases.hits + 1,
    confirmed_by_user_at = now(),
    last_used_at = now(),
    updated_at = now();

  INSERT INTO public.user_merchant_preferences(user_id, merchant_key, transaction_type, category_id, category_slug, evidence_count, confirmed_at, updated_at)
  VALUES (p_user_id, v_key, v_tx.type::text, p_category_id, coalesce(v_cat.slug, v_key), 1, now(), now())
  ON CONFLICT (user_id, merchant_key, transaction_type) DO UPDATE SET
    category_id = excluded.category_id,
    category_slug = excluded.category_slug,
    evidence_count = public.user_merchant_preferences.evidence_count + 1,
    confirmed_at = now(),
    updated_at = now();

  RETURN jsonb_build_object('learned', true, 'merchant_key', v_key);
END $$;

REVOKE ALL ON FUNCTION public.agent_learn_merchant_category(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_learn_merchant_category(uuid, uuid, uuid) TO service_role;