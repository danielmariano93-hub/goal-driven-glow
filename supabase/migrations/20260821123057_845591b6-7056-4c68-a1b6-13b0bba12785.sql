-- ============================================================
-- perf_derived.v1 — infraestrutura de leitura derivada
-- Nada aqui altera o ledger: apenas versionamento, marcação de
-- períodos sujos e cache de resultados derivados.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.financial_ledger_versions (
  user_id uuid PRIMARY KEY,
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.financial_ledger_versions TO authenticated;
GRANT ALL ON public.financial_ledger_versions TO service_role;
ALTER TABLE public.financial_ledger_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own ledger version" ON public.financial_ledger_versions;
CREATE POLICY "own ledger version" ON public.financial_ledger_versions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.financial_dirty_periods (
  user_id uuid NOT NULL,
  competence_month date NOT NULL,
  marked_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  PRIMARY KEY (user_id, competence_month)
);
CREATE INDEX IF NOT EXISTS financial_dirty_periods_pending_idx
  ON public.financial_dirty_periods (marked_at) WHERE processed_at IS NULL;
GRANT SELECT ON public.financial_dirty_periods TO authenticated;
GRANT ALL ON public.financial_dirty_periods TO service_role;
ALTER TABLE public.financial_dirty_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own dirty periods" ON public.financial_dirty_periods;
CREATE POLICY "own dirty periods" ON public.financial_dirty_periods
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.financial_derived_cache (
  user_id uuid NOT NULL,
  cache_key text NOT NULL,
  ledger_version bigint NOT NULL,
  contract_version text NOT NULL DEFAULT 'perf_derived.v1',
  payload jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  compute_ms integer,
  PRIMARY KEY (user_id, cache_key)
);
CREATE INDEX IF NOT EXISTS financial_derived_cache_computed_idx
  ON public.financial_derived_cache (user_id, computed_at DESC);
GRANT SELECT ON public.financial_derived_cache TO authenticated;
GRANT ALL ON public.financial_derived_cache TO service_role;
ALTER TABLE public.financial_derived_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own derived cache" ON public.financial_derived_cache;
CREATE POLICY "own derived cache" ON public.financial_derived_cache
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ------------------------------------------------------------
-- Gatilho barato: só marca. Nunca recalcula, nunca escreve ledger.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_financial_ledger_dirty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  ref date;
BEGIN
  uid := COALESCE(
    (CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END ->> 'user_id')::uuid,
    NULL
  );
  IF uid IS NULL THEN
    RETURN NULL;
  END IF;

  ref := COALESCE(
    NULLIF(CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END ->> 'competence_date', '')::date,
    NULLIF(CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END ->> 'competence_month', '')::date,
    NULLIF(CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END ->> 'occurred_at', '')::date,
    NULLIF(CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END ->> 'as_of', '')::date,
    CURRENT_DATE
  );

  INSERT INTO public.financial_ledger_versions AS v (user_id, version, updated_at)
  VALUES (uid, 1, now())
  ON CONFLICT (user_id) DO UPDATE
    SET version = v.version + 1, updated_at = now();

  INSERT INTO public.financial_dirty_periods (user_id, competence_month, marked_at, processed_at)
  VALUES (uid, date_trunc('month', ref)::date, now(), NULL)
  ON CONFLICT (user_id, competence_month) DO UPDATE
    SET marked_at = now(), processed_at = NULL;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_dirty_transactions ON public.transactions;
CREATE TRIGGER trg_mark_dirty_transactions
  AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.mark_financial_ledger_dirty();

DROP TRIGGER IF EXISTS trg_mark_dirty_card_statements ON public.credit_card_statements;
CREATE TRIGGER trg_mark_dirty_card_statements
  AFTER INSERT OR UPDATE OR DELETE ON public.credit_card_statements
  FOR EACH ROW EXECUTE FUNCTION public.mark_financial_ledger_dirty();

DROP TRIGGER IF EXISTS trg_mark_dirty_card_installments ON public.credit_card_installments;
CREATE TRIGGER trg_mark_dirty_card_installments
  AFTER INSERT OR UPDATE OR DELETE ON public.credit_card_installments
  FOR EACH ROW EXECUTE FUNCTION public.mark_financial_ledger_dirty();

DROP TRIGGER IF EXISTS trg_mark_dirty_card_purchases ON public.credit_card_purchases;
CREATE TRIGGER trg_mark_dirty_card_purchases
  AFTER INSERT OR UPDATE OR DELETE ON public.credit_card_purchases
  FOR EACH ROW EXECUTE FUNCTION public.mark_financial_ledger_dirty();

DROP TRIGGER IF EXISTS trg_mark_dirty_card_payments ON public.credit_card_payments;
CREATE TRIGGER trg_mark_dirty_card_payments
  AFTER INSERT OR UPDATE OR DELETE ON public.credit_card_payments
  FOR EACH ROW EXECUTE FUNCTION public.mark_financial_ledger_dirty();

DROP TRIGGER IF EXISTS trg_mark_dirty_balance_snapshots ON public.account_balance_snapshots;
CREATE TRIGGER trg_mark_dirty_balance_snapshots
  AFTER INSERT OR UPDATE OR DELETE ON public.account_balance_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.mark_financial_ledger_dirty();

DROP TRIGGER IF EXISTS trg_mark_dirty_goal_contributions ON public.goal_contributions;
CREATE TRIGGER trg_mark_dirty_goal_contributions
  AFTER INSERT OR UPDATE OR DELETE ON public.goal_contributions
  FOR EACH ROW EXECUTE FUNCTION public.mark_financial_ledger_dirty();

-- ------------------------------------------------------------
-- Leitura da versão pelo app: chave de cache do React Query.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finance_ledger_version()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT version FROM public.financial_ledger_versions WHERE user_id = auth.uid()),
    0
  );
$$;

REVOKE ALL ON FUNCTION public.finance_ledger_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finance_ledger_version() TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_ledger_version() TO service_role;