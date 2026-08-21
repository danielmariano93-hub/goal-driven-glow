-- ============================================================
-- perf_facts.v1 — fatos mensais derivados + fila incremental
-- Nada aqui altera o ledger. Fatos são consequência, não verdade.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.financial_monthly_facts (
  user_id uuid NOT NULL,
  competence_month date NOT NULL,
  formula_version text NOT NULL DEFAULT 'perf_facts.v1',
  ledger_version bigint NOT NULL DEFAULT 0,
  income numeric NOT NULL DEFAULT 0,
  behavioral_expense numeric NOT NULL DEFAULT 0,
  refunds numeric NOT NULL DEFAULT 0,
  account_in numeric NOT NULL DEFAULT 0,
  account_out numeric NOT NULL DEFAULT 0,
  card_out numeric NOT NULL DEFAULT 0,
  internal_transfers numeric NOT NULL DEFAULT 0,
  external_transfers_in numeric NOT NULL DEFAULT 0,
  external_transfers_out numeric NOT NULL DEFAULT 0,
  investment_applications numeric NOT NULL DEFAULT 0,
  investment_redemptions numeric NOT NULL DEFAULT 0,
  loan_proceeds numeric NOT NULL DEFAULT 0,
  debt_payments numeric NOT NULL DEFAULT 0,
  card_payments numeric NOT NULL DEFAULT 0,
  transaction_count integer NOT NULL DEFAULT 0,
  days_with_expense integer NOT NULL DEFAULT 0,
  account_deltas jsonb NOT NULL DEFAULT '{}'::jsonb,
  account_balances jsonb NOT NULL DEFAULT '{}'::jsonb,
  card_deltas jsonb NOT NULL DEFAULT '{}'::jsonb,
  card_outstanding jsonb NOT NULL DEFAULT '{}'::jsonb,
  category_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  merchant_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  completeness text NOT NULL DEFAULT 'complete',
  computed_at timestamptz NOT NULL DEFAULT now(),
  compute_ms integer,
  transactions_read integer,
  PRIMARY KEY (user_id, competence_month)
);

CREATE INDEX IF NOT EXISTS financial_monthly_facts_user_month_idx
  ON public.financial_monthly_facts (user_id, competence_month DESC);

GRANT SELECT ON public.financial_monthly_facts TO authenticated;
GRANT ALL ON public.financial_monthly_facts TO service_role;
ALTER TABLE public.financial_monthly_facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own monthly facts" ON public.financial_monthly_facts;
CREATE POLICY "own monthly facts" ON public.financial_monthly_facts
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ------------------------------------------------------------
-- Fila incremental: domínio afetado + lease + retry + erro
-- ------------------------------------------------------------
ALTER TABLE public.financial_dirty_periods
  ADD COLUMN IF NOT EXISTS domains text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text;

CREATE OR REPLACE FUNCTION public.mark_financial_ledger_dirty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  ref date;
  row_json jsonb;
  domain text;
BEGIN
  row_json := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  uid := NULLIF(row_json ->> 'user_id', '')::uuid;
  IF uid IS NULL THEN
    RETURN NULL;
  END IF;

  ref := COALESCE(
    NULLIF(row_json ->> 'competence_date', '')::date,
    NULLIF(row_json ->> 'competence_month', '')::date,
    NULLIF(row_json ->> 'occurred_at', '')::date,
    NULLIF(row_json ->> 'as_of', '')::date,
    CURRENT_DATE
  );

  domain := CASE TG_TABLE_NAME
    WHEN 'transactions' THEN 'ledger'
    WHEN 'account_balance_snapshots' THEN 'cash'
    WHEN 'goal_contributions' THEN 'goals'
    ELSE 'card'
  END;

  INSERT INTO public.financial_ledger_versions AS v (user_id, version, updated_at)
  VALUES (uid, 1, now())
  ON CONFLICT (user_id) DO UPDATE
    SET version = v.version + 1, updated_at = now();

  INSERT INTO public.financial_dirty_periods AS d
    (user_id, competence_month, marked_at, processed_at, domains)
  VALUES (uid, date_trunc('month', ref)::date, now(), NULL, ARRAY[domain])
  ON CONFLICT (user_id, competence_month) DO UPDATE
    SET marked_at = now(),
        processed_at = NULL,
        locked_until = NULL,
        domains = (
          SELECT array_agg(DISTINCT x) FROM unnest(d.domains || ARRAY[domain]) AS t(x)
        );

  RETURN NULL;
END;
$$;

-- ------------------------------------------------------------
-- Lease do worker: reserva meses pendentes de forma idempotente
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finance_facts_claim(p_limit integer DEFAULT 25, p_lease_seconds integer DEFAULT 300)
RETURNS TABLE (user_id uuid, competence_month date, domains text[], attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT d.user_id, d.competence_month
      FROM public.financial_dirty_periods d
     WHERE d.processed_at IS NULL
       AND (d.locked_until IS NULL OR d.locked_until < now())
       AND d.attempts < 6
     ORDER BY d.marked_at
     LIMIT GREATEST(1, LEAST(p_limit, 200))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.financial_dirty_periods t
     SET locked_until = now() + make_interval(secs => GREATEST(30, p_lease_seconds)),
         attempts = t.attempts + 1
    FROM claimed c
   WHERE t.user_id = c.user_id AND t.competence_month = c.competence_month
  RETURNING t.user_id, t.competence_month, t.domains, t.attempts;
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_facts_mark_processed(p_user uuid, p_month date)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.financial_dirty_periods
     SET processed_at = now(), locked_until = NULL, last_error = NULL, attempts = 0
   WHERE user_id = p_user AND competence_month = p_month;
$$;

CREATE OR REPLACE FUNCTION public.finance_facts_mark_failed(p_user uuid, p_month date, p_error text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.financial_dirty_periods
     SET locked_until = NULL, last_error = left(COALESCE(p_error, 'unknown'), 500)
   WHERE user_id = p_user AND competence_month = p_month;
$$;

-- Carga inicial: enfileira todos os meses com histórico da pessoa.
CREATE OR REPLACE FUNCTION public.finance_facts_enqueue_history(p_user uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted integer := 0;
BEGIN
  WITH months AS (
    SELECT DISTINCT date_trunc('month', COALESCE(t.competence_date, t.occurred_at))::date AS m
      FROM public.transactions t
     WHERE t.user_id = p_user
  ), ins AS (
    INSERT INTO public.financial_dirty_periods (user_id, competence_month, marked_at, processed_at, domains)
    SELECT p_user, m, now(), NULL, ARRAY['bootstrap'] FROM months
    ON CONFLICT (user_id, competence_month) DO UPDATE
      SET processed_at = NULL, locked_until = NULL, attempts = 0, marked_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO inserted FROM ins;
  RETURN inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.finance_facts_claim(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finance_facts_mark_processed(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finance_facts_mark_failed(uuid, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finance_facts_enqueue_history(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finance_facts_claim(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_facts_mark_processed(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_facts_mark_failed(uuid, date, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_facts_enqueue_history(uuid) TO service_role;