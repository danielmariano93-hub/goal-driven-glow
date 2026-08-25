CREATE OR REPLACE FUNCTION public.my_financial_home_snapshot(
  _start date,
  _end date,
  _today date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_snapshot public.financial_current_snapshots;
  v_cache public.financial_derived_cache;
  v_current_version bigint := 0;
  v_snapshot_version bigint := -1;
  v_local_today date := COALESCE(_today, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_period_start date;
  v_cache_key text;
  v_stale_response jsonb := NULL;
  v_contract text := 'home_snapshot.v3';
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;
  IF _start IS NULL OR _end IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_period');
  END IF;

  SELECT COALESCE(version, 0)
  INTO v_current_version
  FROM public.financial_ledger_versions
  WHERE user_id = v_uid;
  v_current_version := COALESCE(v_current_version, 0);
  v_period_start := date_trunc('month', v_local_today)::date;

  -- MTD atual: só serve read model do contrato vigente. Snapshots antigos
  -- (v2) não podem sobreviver ao hot path, porque não carregam nomes de
  -- categorias globais nas metas por categoria.
  IF _start = v_period_start AND _end = v_local_today THEN
    SELECT * INTO v_snapshot
    FROM public.financial_current_snapshots
    WHERE user_id = v_uid
      AND contract_version = v_contract
    LIMIT 1;

    IF v_snapshot.user_id IS NOT NULL
       AND v_snapshot.period_start = v_period_start
       AND v_snapshot.as_of_date = v_local_today
       AND v_snapshot.payload->'snapshot' IS NOT NULL THEN
      BEGIN
        v_snapshot_version := COALESCE((v_snapshot.payload->>'ledger_version')::bigint, -1);
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        v_snapshot_version := -1;
      END;

      IF v_snapshot_version = v_current_version THEN
        RETURN jsonb_build_object(
          'ok', true,
          'snapshot', v_snapshot.payload->'snapshot',
          'missing_sources', COALESCE(v_snapshot.payload->'missing_sources', '[]'::jsonb),
          'computed_at', v_snapshot.computed_at,
          'cache_hit', true,
          'freshness', 'fresh',
          'ledger_version', v_current_version,
          'read_path', 'materialized_current',
          'contract_version', v_contract
        );
      END IF;

      v_stale_response := jsonb_build_object(
        'ok', true,
        'snapshot', v_snapshot.payload->'snapshot',
        'missing_sources', COALESCE(v_snapshot.payload->'missing_sources', '[]'::jsonb),
        'computed_at', v_snapshot.computed_at,
        'cache_hit', true,
        'freshness', 'stale_recomputing',
        'ledger_version', v_current_version,
        'read_path', 'materialized_current_stale',
        'contract_version', v_contract
      );
    END IF;
  END IF;

  v_cache_key := format(
    'home_snapshot_v3|%s|%s|%s',
    _start::text,
    _end::text,
    v_local_today::text
  );

  SELECT * INTO v_cache
  FROM public.financial_derived_cache
  WHERE user_id = v_uid
    AND cache_key = v_cache_key
  LIMIT 1;

  IF v_cache.user_id IS NOT NULL
     AND v_cache.ledger_version = v_current_version
     AND v_cache.payload->'snapshot' IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'snapshot', v_cache.payload->'snapshot',
      'missing_sources', COALESCE(v_cache.payload->'missing_sources', '[]'::jsonb),
      'computed_at', v_cache.computed_at,
      'cache_hit', true,
      'freshness', 'fresh',
      'ledger_version', v_current_version,
      'read_path', 'derived_cache',
      'contract_version', v_contract
    );
  END IF;

  IF v_stale_response IS NOT NULL THEN
    RETURN v_stale_response;
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'snapshot_cache_miss');
END
$function$;

REVOKE ALL ON FUNCTION public.my_financial_home_snapshot(date, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_financial_home_snapshot(date, date, date) TO authenticated, service_role;
COMMENT ON FUNCTION public.my_financial_home_snapshot(date, date, date) IS
  'Hot path O(1) da Home: read model MTD ou cache derivado versionado; contrato atual obrigatório.';

CREATE OR REPLACE FUNCTION public.record_debt_payment(
  p_debt_id uuid,
  p_account_id uuid,
  p_paid_at date,
  p_amount numeric,
  p_interest_amount numeric DEFAULT 0,
  p_fee_amount numeric DEFAULT 0,
  p_installments_covered integer DEFAULT 0,
  p_notes text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_debt public.debts;
  v_applied numeric;
  v_payment_id uuid;
  v_transaction_id uuid;
  v_installments_covered integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_debt FROM public.debts
   WHERE id = p_debt_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'debt_not_found'; END IF;
  IF p_amount <= 0 OR p_interest_amount < 0 OR p_fee_amount < 0
     OR p_interest_amount + p_fee_amount > p_amount THEN
    RAISE EXCEPTION 'invalid_payment_composition';
  END IF;
  IF p_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.accounts WHERE id = p_account_id AND user_id = v_user AND active
  ) THEN RAISE EXCEPTION 'account_not_found'; END IF;

  v_applied := p_amount - p_interest_amount - p_fee_amount;
  IF v_applied > v_debt.outstanding_balance THEN
    RAISE EXCEPTION 'payment_exceeds_outstanding_balance';
  END IF;

  v_installments_covered := greatest(0, coalesce(p_installments_covered, 0));
  IF v_installments_covered = 0
     AND coalesce(v_debt.installment_amount, 0) > 0
     AND v_applied >= coalesce(v_debt.installment_amount, 0) * 0.95 THEN
    v_installments_covered := least(
      coalesce(v_debt.installments_total, 2147483647) - coalesce(v_debt.installments_paid, 0),
      greatest(1, floor(v_applied / greatest(v_debt.installment_amount, 0.01))::integer)
    );
    v_installments_covered := greatest(1, v_installments_covered);
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_payment_id FROM public.debt_payments
     WHERE user_id = v_user AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'idempotent', true, 'payment_id', v_payment_id);
    END IF;
  END IF;

  INSERT INTO public.transactions(
    user_id, account_id, type, status, amount, occurred_at, description,
    payment_method, movement_kind
  ) VALUES (
    v_user, p_account_id, 'expense', 'confirmed', v_applied,
    coalesce(p_paid_at, current_date), 'Pagamento de dívida: ' || v_debt.name,
    'account', 'debt_payment'
  ) RETURNING id INTO v_transaction_id;

  IF p_interest_amount > 0 THEN
    INSERT INTO public.transactions(
      user_id, account_id, type, status, amount, occurred_at, description,
      payment_method, movement_kind
    ) VALUES (
      v_user, p_account_id, 'expense', 'confirmed', p_interest_amount,
      coalesce(p_paid_at, current_date), 'Juros da dívida: ' || v_debt.name,
      'account', 'transaction'
    );
  END IF;
  IF p_fee_amount > 0 THEN
    INSERT INTO public.transactions(
      user_id, account_id, type, status, amount, occurred_at, description,
      payment_method, movement_kind
    ) VALUES (
      v_user, p_account_id, 'expense', 'confirmed', p_fee_amount,
      coalesce(p_paid_at, current_date), 'Tarifas da dívida: ' || v_debt.name,
      'account', 'transaction'
    );
  END IF;

  INSERT INTO public.debt_payments(
    user_id, debt_id, account_id, paid_at, amount, amount_applied,
    interest_amount, fee_amount, installments_covered, notes,
    transaction_id, idempotency_key
  ) VALUES (
    v_user, p_debt_id, p_account_id, coalesce(p_paid_at, current_date),
    p_amount, v_applied, p_interest_amount, p_fee_amount,
    v_installments_covered, nullif(p_notes, ''),
    v_transaction_id, p_idempotency_key
  ) RETURNING id INTO v_payment_id;

  UPDATE public.debts
     SET outstanding_balance = greatest(0, outstanding_balance - v_applied),
         installments_paid = least(
           coalesce(installments_total, 2147483647),
           coalesce(installments_paid, 0) + v_installments_covered
         ),
         status = CASE WHEN greatest(0, outstanding_balance - v_applied) = 0
                       THEN 'settled'::public.debt_status ELSE status END,
         updated_at = now()
   WHERE id = p_debt_id;

  RETURN jsonb_build_object(
    'ok', true, 'idempotent', false, 'payment_id', v_payment_id,
    'transaction_id', v_transaction_id, 'amount_applied', v_applied,
    'installments_covered', v_installments_covered
  );
END $$;
REVOKE ALL ON FUNCTION public.record_debt_payment(uuid,uuid,date,numeric,numeric,numeric,integer,text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_debt_payment(uuid,uuid,date,numeric,numeric,numeric,integer,text,text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_v2_ai_latency_drilldown(
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_day date DEFAULT NULL,
  p_channel text DEFAULT NULL,
  p_path text DEFAULT NULL,
  p_capability text DEFAULT NULL,
  p_model_tier text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_to date := coalesce(p_to, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_from date := coalesce(p_from, v_to - 29);
  v_limit integer := greatest(1, least(25, coalesce(p_limit, 10)));
  v_p50 numeric;
  v_p95 numeric;
  v_out jsonb;
BEGIN
  PERFORM public._require_perm('cockpit.read');

  IF p_day IS NOT NULL THEN
    v_from := p_day;
    v_to := p_day;
  END IF;
  IF v_from > v_to THEN
    RAISE EXCEPTION 'invalid_period';
  END IF;

  WITH filtered AS (
    SELECT
      id,
      started_at,
      (started_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
      status,
      channel,
      path,
      capability,
      model_tier,
      model,
      latency_ms,
      coalesce(tokens_in, 0) AS tokens_in,
      coalesce(tokens_out, 0) AS tokens_out,
      coalesce(llm_calls, 0) AS llm_calls,
      coalesce(estimated_cost_usd, 0) AS estimated_cost_usd,
      CASE
        WHEN error_message IS NULL THEN NULL
        ELSE left(regexp_replace(error_message, '(Bearer|token|key|secret|password|authorization)[^[:space:]]*', '[removido]', 'gi'), 180)
      END AS error_summary
    FROM public.agent_runs
    WHERE (started_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
      AND latency_ms IS NOT NULL
      AND (p_channel IS NULL OR channel = p_channel)
      AND (p_path IS NULL OR path = p_path)
      AND (p_capability IS NULL OR capability = p_capability)
      AND (p_model_tier IS NULL OR model_tier = p_model_tier)
      AND (p_model IS NULL OR model = p_model)
  )
  SELECT
    percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms),
    percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms)
  INTO v_p50, v_p95
  FROM filtered;

  WITH filtered AS (
    SELECT
      id,
      started_at,
      (started_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
      status,
      channel,
      path,
      capability,
      model_tier,
      model,
      latency_ms,
      coalesce(tokens_in, 0) AS tokens_in,
      coalesce(tokens_out, 0) AS tokens_out,
      coalesce(llm_calls, 0) AS llm_calls,
      coalesce(estimated_cost_usd, 0) AS estimated_cost_usd,
      CASE
        WHEN error_message IS NULL THEN NULL
        ELSE left(regexp_replace(error_message, '(Bearer|token|key|secret|password|authorization)[^[:space:]]*', '[removido]', 'gi'), 180)
      END AS error_summary
    FROM public.agent_runs
    WHERE (started_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
      AND latency_ms IS NOT NULL
      AND (p_channel IS NULL OR channel = p_channel)
      AND (p_path IS NULL OR path = p_path)
      AND (p_capability IS NULL OR capability = p_capability)
      AND (p_model_tier IS NULL OR model_tier = p_model_tier)
      AND (p_model IS NULL OR model = p_model)
  ), shaped AS (
    SELECT jsonb_build_object(
      'run_id', id,
      'started_at', started_at,
      'day', day,
      'status', status,
      'channel', channel,
      'path', path,
      'capability', capability,
      'model_tier', model_tier,
      'model', model,
      'latency_ms', latency_ms,
      'tokens_total', tokens_in + tokens_out,
      'tokens_in', tokens_in,
      'tokens_out', tokens_out,
      'llm_calls', llm_calls,
      'estimated_cost_usd', round(estimated_cost_usd::numeric, 6),
      'error_summary', error_summary
    ) AS row_json,
    latency_ms
    FROM filtered
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to, 'day', p_day),
    'filters', jsonb_build_object(
      'channel', p_channel, 'path', p_path, 'capability', p_capability,
      'model_tier', p_model_tier, 'model', p_model),
    'thresholds', jsonb_build_object('p50_latency_ms', v_p50, 'p95_latency_ms', v_p95),
    'p50_runs', coalesce((
      SELECT jsonb_agg(row_json ORDER BY abs(latency_ms - coalesce(v_p50, latency_ms)), latency_ms DESC)
      FROM (SELECT row_json, latency_ms FROM shaped ORDER BY abs(latency_ms - coalesce(v_p50, latency_ms)), latency_ms DESC LIMIT v_limit) s
    ), '[]'::jsonb),
    'p95_runs', coalesce((
      SELECT jsonb_agg(row_json ORDER BY latency_ms DESC)
      FROM (SELECT row_json, latency_ms FROM shaped WHERE v_p95 IS NULL OR latency_ms >= v_p95 ORDER BY latency_ms DESC LIMIT v_limit) s
    ), '[]'::jsonb),
    'outlier_runs', coalesce((
      SELECT jsonb_agg(row_json ORDER BY latency_ms DESC)
      FROM (SELECT row_json, latency_ms FROM shaped ORDER BY latency_ms DESC LIMIT v_limit) s
    ), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_v2_ai_latency_drilldown(date, date, date, text, text, text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_v2_ai_latency_drilldown(date, date, date, text, text, text, text, text, integer) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_agent_runs_admin_latency_filters
  ON public.agent_runs (((started_at AT TIME ZONE 'America/Sao_Paulo')::date), model_tier, model, capability, latency_ms DESC)
  WHERE latency_ms IS NOT NULL;

NOTIFY pgrst, 'reload schema';