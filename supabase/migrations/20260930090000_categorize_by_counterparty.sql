-- nino_counterparty_categorize.v1 — "os 11 Pix para a Pamela são de quê?"
-- Agrupa os lançamentos sem categoria por favorecido/estabelecimento e aplica
-- a categoria escolhida a todos de uma vez. A escolha é da pessoa (source
-- 'user'), fica auditada em category_decisions e vira apelido confirmado para
-- os próximos lançamentos do mesmo nome.

-- Chave do favorecido. Espelha `normalizedPattern` do motor (TS): datas
-- coladas saem, prefixos de extrato (pix, transf, qrs, pay...) saem, números
-- soltos saem, ficam os 3 primeiros termos.
CREATE OR REPLACE FUNCTION public.nino_counterparty_key(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH base AS (
    SELECT regexp_replace(
      translate(lower(coalesce(p_text, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
      '\d{2}/\d{2}(/\d{2,4})?', ' ', 'g') AS t
  ), tokens AS (
    SELECT tok, ord
    FROM base, regexp_split_to_table(regexp_replace(t, '[^a-z0-9]+', ' ', 'g'), '\s+') WITH ORDINALITY AS s(tok, ord)
    WHERE length(tok) >= 2
      AND (tok !~ '^\d+$' OR tok = '99')
      AND tok NOT IN ('pay','pix','ted','doc','compra','pagamento','pgto','debito','credito','cred','deb','cartao',
                      'boleto','transf','transferencia','recebimento','redecard','stone','cielo','getnet','rede',
                      'pagseguro','pagbank','mercpago','mercadopago','picpay','de','do','da','em','no','na','atm',
                      'tmob','qrs','qrcode','whats','int','ltda','me','sa','eireli','mei','epp','pag')
  )
  SELECT coalesce(string_agg(tok, ' ' ORDER BY ord), '')
  FROM (SELECT tok, ord FROM tokens ORDER BY ord LIMIT 3) first3;
$$;

-- Grupos do próprio usuário (RLS por auth.uid()).
CREATE OR REPLACE FUNCTION public.my_uncategorized_counterparties(_limit integer DEFAULT 20)
RETURNS TABLE(
  counterparty_key text, label text, transaction_type text, direction text,
  transactions integer, total numeric, last_date date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    k.key,
    (array_agg(coalesce(nullif(t.friendly_description, ''), t.description) ORDER BY t.occurred_at DESC))[1],
    t.type::text,
    CASE WHEN t.type::text = 'income' THEN 'recebido' ELSE 'pago' END,
    count(*)::integer,
    round(sum(t.amount), 2),
    max(t.occurred_at)::date
  FROM public.transactions t
  CROSS JOIN LATERAL (SELECT public.nino_counterparty_key(coalesce(t.normalized_description, t.friendly_description, t.description)) AS key) k
  WHERE t.user_id = auth.uid()
    AND t.status = 'confirmed'
    AND t.category_id IS NULL
    AND t.type::text IN ('income', 'expense')
    AND coalesce(t.movement_kind, 'transaction') IN ('transaction', 'external_transfer_in', 'external_transfer_out')
    AND t.transfer_group_id IS NULL
    AND t.settles_card_id IS NULL
    AND length(k.key) >= 3
  GROUP BY k.key, t.type
  ORDER BY count(*) DESC, sum(t.amount) DESC
  LIMIT greatest(1, least(coalesce(_limit, 20), 50));
$$;

-- Aplica a categoria a todos os lançamentos sem categoria daquele favorecido.
CREATE OR REPLACE FUNCTION public.categorize_counterparty(_key text, _type text, _category_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cat_type text;
  v_updated integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF coalesce(length(_key), 0) < 3 OR _type NOT IN ('income', 'expense') THEN RAISE EXCEPTION 'invalid_counterparty'; END IF;
  SELECT type::text INTO v_cat_type FROM public.categories
   WHERE id = _category_id AND archived_at IS NULL AND (user_id = v_uid OR user_id IS NULL);
  IF v_cat_type IS NULL THEN RAISE EXCEPTION 'category_not_found'; END IF;
  IF v_cat_type <> _type THEN RAISE EXCEPTION 'category_type_mismatch'; END IF;

  WITH targets AS (
    SELECT t.id, t.category_id AS previous, coalesce(nullif(t.friendly_description, ''), t.description) AS name
    FROM public.transactions t
    WHERE t.user_id = v_uid
      AND t.status = 'confirmed'
      AND t.category_id IS NULL
      AND t.type::text = _type
      AND coalesce(t.movement_kind, 'transaction') IN ('transaction', 'external_transfer_in', 'external_transfer_out')
      AND t.transfer_group_id IS NULL
      AND t.settles_card_id IS NULL
      AND public.nino_counterparty_key(coalesce(t.normalized_description, t.friendly_description, t.description)) = _key
    FOR UPDATE
  ), decided AS (
    INSERT INTO public.category_decisions(
      user_id, transaction_id, previous_category_id, decided_category_id, source, confidence,
      reason_code, reason, engine_version, action, mode, actor, alternatives, applied_at
    )
    SELECT v_uid, id, previous, _category_id, 'user', 1,
      'counterparty_bulk', 'categorizado pelo favorecido: ' || _key, 'categorization_truth.v2',
      'auto_apply', 'live', 'user', '[]'::jsonb, now()
    FROM targets
    RETURNING transaction_id, id
  ), updated AS (
    UPDATE public.transactions t
       SET category_id = _category_id,
           category_source = 'user',
           category_confidence = 1,
           category_reason = 'escolha explícita em lote',
           category_decision_id = d.id,
           category_classified_at = now()
      FROM decided d
     WHERE t.id = d.transaction_id
    RETURNING t.id
  )
  SELECT count(*) INTO v_updated FROM updated;

  -- Os próximos lançamentos do mesmo nome já chegam categorizados.
  INSERT INTO public.merchant_aliases(user_id, alias_key, normalized_pattern, friendly_name, category_id, learned_from, hits, last_used_at, confirmed_by_user_at, confidence)
  VALUES (v_uid, _key, _key, _key, _category_id, 'manual', greatest(v_updated, 1), now(), now(), 0.99)
  ON CONFLICT (user_id, alias_key) DO UPDATE SET
    category_id = EXCLUDED.category_id, normalized_pattern = EXCLUDED.normalized_pattern,
    learned_from = 'manual', hits = public.merchant_aliases.hits + EXCLUDED.hits,
    last_used_at = now(), confirmed_by_user_at = now(), updated_at = now();

  RETURN v_updated;
END $$;

REVOKE ALL ON FUNCTION public.my_uncategorized_counterparties(integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.categorize_counterparty(text, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_uncategorized_counterparties(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.categorize_counterparty(text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nino_counterparty_key(text) TO authenticated, service_role;
