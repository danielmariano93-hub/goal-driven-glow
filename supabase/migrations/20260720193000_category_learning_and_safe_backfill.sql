-- Categorização assistida: aprende apenas com edição explícita e aplica em lote
-- somente regras de alta confiança. Nunca categoriza transferências, aplicações,
-- resgates, pagamentos de fatura ou valores cuja natureza seja ambígua.

CREATE OR REPLACE FUNCTION public.category_alias_key(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT trim(regexp_replace(
    lower(translate(coalesce(p_text,''),
      'áàâãäéèêëíìîïóòôõöúùûüç',
      'aaaaaeeeeiiiiooooouuuuc')),
    '[^a-z0-9]+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.learn_transaction_category(
  p_transaction_id uuid,
  p_category_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tx public.transactions%ROWTYPE;
  v_key text;
  v_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT * INTO v_tx FROM public.transactions
   WHERE id=p_transaction_id AND user_id=v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction_not_found'; END IF;
  IF p_category_id IS NULL OR v_tx.type NOT IN ('income','expense')
     OR coalesce(v_tx.movement_kind,'transaction') <> 'transaction' THEN RETURN; END IF;

  v_name := coalesce(nullif(v_tx.friendly_description,''), nullif(v_tx.description,''), nullif(v_tx.raw_description,''));
  v_key := public.category_alias_key(coalesce(v_tx.normalized_description, v_name));
  IF length(v_key) < 3 THEN RETURN; END IF;

  INSERT INTO public.merchant_aliases(user_id,alias_key,friendly_name,category_id,learned_from,hits,last_used_at)
  VALUES(v_uid,v_key,coalesce(v_name,v_key),p_category_id,'manual',1,now())
  ON CONFLICT(user_id,alias_key) DO UPDATE SET
    friendly_name=excluded.friendly_name,
    category_id=excluded.category_id,
    learned_from='manual',
    hits=public.merchant_aliases.hits+1,
    last_used_at=now(), updated_at=now();
END $$;

CREATE OR REPLACE FUNCTION public.apply_safe_category_suggestions()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer := 0;
  v_alias_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  -- 1. Alias pessoal confirmado pelo próprio usuário: confiança máxima.
  WITH candidates AS (
    SELECT t.id, a.category_id
      FROM public.transactions t
      JOIN public.merchant_aliases a
        ON a.user_id=t.user_id
       AND a.alias_key=public.category_alias_key(coalesce(t.normalized_description,t.friendly_description,t.description,t.raw_description))
     WHERE t.user_id=v_uid AND t.category_id IS NULL
       AND t.type IN ('income','expense')
       AND coalesce(t.status,'confirmed')='confirmed'
       AND coalesce(t.movement_kind,'transaction')='transaction'
       AND a.category_id IS NOT NULL
  ), updated AS (
    UPDATE public.transactions t SET category_id=c.category_id, updated_at=now()
      FROM candidates c WHERE t.id=c.id RETURNING t.id
  ) SELECT count(*) INTO v_alias_count FROM updated;

  -- 2. Regras universais inequívocas. Operações patrimoniais ficam excluídas.
  WITH mapped AS (
    SELECT t.id, c.id category_id
      FROM public.transactions t
      JOIN public.categories c ON (c.user_id IS NULL OR c.user_id=v_uid)
     WHERE t.user_id=v_uid AND t.category_id IS NULL
       AND t.type IN ('income','expense') AND coalesce(t.status,'confirmed')='confirmed'
       AND coalesce(t.movement_kind,'transaction')='transaction'
       AND c.archived_at IS NULL
       AND c.name = CASE
         WHEN t.type='income' AND public.category_alias_key(coalesce(t.description,t.raw_description)) ~ '(folha|salario|provento)' THEN 'Salário'
         WHEN t.type='expense' AND public.category_alias_key(coalesce(t.description,t.raw_description)) ~ '(^| )(uber|99 ?app|99foo|pay dl ub)( |$)' THEN 'Transporte'
         WHEN t.type='expense' AND public.category_alias_key(coalesce(t.description,t.raw_description)) ~ '(claro|vivo|tim |internet)' THEN 'Serviços'
         WHEN t.type='expense' AND public.category_alias_key(coalesce(t.description,t.raw_description)) ~ '(raia|drogasil|drogaria|farmacia)' THEN 'Saúde'
         WHEN t.type='expense' AND public.category_alias_key(coalesce(t.description,t.raw_description)) ~ '(supermerc|mercado|ifood|restaurante|lanch|chiquinho|espet)' THEN 'Alimentação'
         WHEN t.type='expense' AND public.category_alias_key(coalesce(t.description,t.raw_description)) ~ '(emprestimo|crediario|renegoci)' THEN 'Dívidas e empréstimos'
         ELSE NULL END
  ), updated AS (
    UPDATE public.transactions t SET category_id=m.category_id, updated_at=now()
      FROM mapped m WHERE t.id=m.id RETURNING t.id
  ) SELECT count(*) INTO v_count FROM updated;

  RETURN jsonb_build_object('updated',v_alias_count+v_count,'from_personal_history',v_alias_count,'from_safe_rules',v_count);
END $$;

REVOKE ALL ON FUNCTION public.learn_transaction_category(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_safe_category_suggestions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learn_transaction_category(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_safe_category_suggestions() TO authenticated;
