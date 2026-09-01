-- Financial Truth v9 — competência de cartão pelo FECHAMENTO e read model v4.
--
-- CAUSA-RAIZ 1: `card_cycle_for` devolvia `competence_month` = mês do
-- VENCIMENTO. Com fechamento em um mês e vencimento no seguinte, a fatura
-- (e todo lançamento de cartão) caía no mês errado — o app já corrigiu isso em
-- `card_cycle.v3`; aqui o banco passa a concordar.
--
-- CAUSA-RAIZ 2: o hot path da Home servia `home_snapshot.v3`, calculado com a
-- lente antiga (`occurred_at`). Snapshot de contrato antigo não pode sobreviver
-- a uma mudança de verdade: sobe para `home_snapshot.v4` e o cache velho é
-- descartado, nunca reaproveitado.

-- 1) Ciclo do cartão: competência é o mês do fechamento.
CREATE OR REPLACE FUNCTION public.card_cycle_for(p_closing_day smallint, p_due_day smallint, p_date date)
RETURNS TABLE(competence_month date, period_start date, period_end date, closing_date date, due_date date, fallback boolean)
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_closing int := COALESCE(p_closing_day, 0);
  v_due int := COALESCE(p_due_day, 0);
  v_closing_month date;
  v_prev_closing date;
  v_due_month date;
BEGIN
  IF p_date IS NULL THEN
    RETURN;
  END IF;

  -- Fallback: sem fechamento válido, o ciclo é o mês calendário.
  IF v_closing < 1 OR v_closing > 31 THEN
    period_start := date_trunc('month', p_date)::date;
    period_end := (date_trunc('month', p_date) + interval '1 month - 1 day')::date;
    closing_date := period_end;
    competence_month := period_start;
    IF v_due BETWEEN 1 AND 31 THEN
      due_date := LEAST(period_start + (v_due - 1), period_end);
    ELSE
      due_date := period_end;
    END IF;
    fallback := true;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Mês de fechamento: o próprio mês se a compra ocorreu até o fechamento.
  v_closing_month := date_trunc('month', p_date)::date;
  IF EXTRACT(DAY FROM p_date)::int > LEAST(
       v_closing,
       EXTRACT(DAY FROM (v_closing_month + interval '1 month - 1 day'))::int
     ) THEN
    v_closing_month := (v_closing_month + interval '1 month')::date;
  END IF;

  closing_date := LEAST(
    v_closing_month + (v_closing - 1),
    (v_closing_month + interval '1 month - 1 day')::date
  );
  v_prev_closing := LEAST(
    (v_closing_month - interval '1 month')::date + (v_closing - 1),
    (v_closing_month - interval '1 day')::date
  );
  period_start := v_prev_closing + 1;
  period_end := closing_date;

  -- Vencimento: mesmo mês do fechamento se o dia é maior; senão, mês seguinte.
  IF v_due BETWEEN 1 AND 31 THEN
    v_due_month := CASE WHEN v_due > v_closing
      THEN v_closing_month
      ELSE (v_closing_month + interval '1 month')::date END;
  ELSE
    v_due := v_closing;
    v_due_month := (v_closing_month + interval '1 month')::date;
  END IF;
  due_date := LEAST(
    v_due_month + (v_due - 1),
    (v_due_month + interval '1 month - 1 day')::date
  );

  -- card_cycle.v3: a competência é o mês do FECHAMENTO, nunca o do vencimento.
  competence_month := date_trunc('month', closing_date)::date;
  fallback := false;
  RETURN NEXT;
END;
$function$;

COMMENT ON FUNCTION public.card_cycle_for(smallint, smallint, date) IS
  'card_cycle.v3 — competência = mês do fechamento; vencimento é apenas data de pagamento.';

-- 2) Fatura já gravada com competência divergente do fechamento é sinalizada
--    para conferência. Nada é reescrito às cegas: valor de documento é verdade
--    do usuário e só ele decide reclassificar.
UPDATE public.credit_card_statements s
SET requires_manual_review = true,
    updated_at = now()
WHERE s.closing_date IS NOT NULL
  AND date_trunc('month', s.competence_month)::date <> date_trunc('month', s.closing_date)::date
  AND s.requires_manual_review = false;

-- 3) Read model da Home sobe para `home_snapshot.v4`.
CREATE OR REPLACE FUNCTION public.my_financial_home_snapshot(_start date, _end date, _today date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
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
  v_contract text := 'home_snapshot.v4';
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

  -- Só serve read model do contrato vigente. Snapshot de contrato antigo é
  -- tratado como inexistente: foi calculado com outra lente de competência.
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
    'home_snapshot_v4|%s|%s|%s',
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
  'home_snapshot.v4 — hot path da Home com competência financeira (fatura) como lente canônica.';

-- 4) Descarte do read model calculado com a lente antiga.
DELETE FROM public.financial_current_snapshots WHERE contract_version <> 'home_snapshot.v4';
DELETE FROM public.financial_derived_cache WHERE cache_key NOT LIKE 'home_snapshot_v4|%';
