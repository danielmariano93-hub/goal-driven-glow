-- Meu Nino: camada financeira canônica, aditiva e reversível.
-- `transactions` continua sendo a fonte de verdade. Nenhum histórico é removido.

CREATE TABLE IF NOT EXISTS public.financial_daily_facts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fact_date date NOT NULL,
  income numeric(14,2) NOT NULL DEFAULT 0,
  cash_outflow numeric(14,2) NOT NULL DEFAULT 0,
  behavioral_consumption numeric(14,2) NOT NULL DEFAULT 0,
  account_consumption numeric(14,2) NOT NULL DEFAULT 0,
  card_consumption numeric(14,2) NOT NULL DEFAULT 0,
  transaction_count integer NOT NULL DEFAULT 0,
  formula_version text NOT NULL DEFAULT 'financial_daily.v1',
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, fact_date)
);

CREATE TABLE IF NOT EXISTS public.financial_daily_category_facts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fact_date date NOT NULL,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  consumption numeric(14,2) NOT NULL DEFAULT 0,
  transaction_count integer NOT NULL DEFAULT 0,
  formula_version text NOT NULL DEFAULT 'financial_daily_category.v1',
  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.financial_current_snapshots (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  as_of_date date NOT NULL,
  period_start date NOT NULL,
  income numeric(14,2) NOT NULL DEFAULT 0,
  cash_outflow numeric(14,2) NOT NULL DEFAULT 0,
  behavioral_consumption numeric(14,2) NOT NULL DEFAULT 0,
  account_consumption numeric(14,2) NOT NULL DEFAULT 0,
  card_consumption numeric(14,2) NOT NULL DEFAULT 0,
  available_balance numeric(14,2) NOT NULL DEFAULT 0,
  confidence text NOT NULL DEFAULT 'computed',
  formula_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.financial_backfill_checkpoints (
  job_key text PRIMARY KEY,
  cursor_user_id uuid,
  cursor_date date,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','failed')),
  attempts integer NOT NULL DEFAULT 0,
  rows_processed bigint NOT NULL DEFAULT 0,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.financial_metric_diffs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  metric_key text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  legacy_value numeric,
  canonical_value numeric,
  absolute_diff numeric GENERATED ALWAYS AS
    (abs(coalesce(canonical_value,0)-coalesce(legacy_value,0))) STORED,
  legacy_formula text,
  canonical_formula text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.financial_feature_flags (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  use_canonical_financial_snapshot boolean NOT NULL DEFAULT false,
  use_daily_financial_facts boolean NOT NULL DEFAULT false,
  use_chart_templates boolean NOT NULL DEFAULT false,
  use_report_templates boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.financial_report_templates (
  template_key text PRIMARY KEY,
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  definition jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS financial_daily_facts_user_date_idx
  ON public.financial_daily_facts(user_id, fact_date DESC);
CREATE INDEX IF NOT EXISTS financial_daily_category_user_date_idx
  ON public.financial_daily_category_facts(user_id, fact_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS financial_daily_category_natural_uniq
  ON public.financial_daily_category_facts(user_id,fact_date,category_id) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS financial_metric_diffs_user_created_idx
  ON public.financial_metric_diffs(user_id, created_at DESC);

ALTER TABLE public.financial_daily_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_daily_category_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_current_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_report_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own financial daily facts" ON public.financial_daily_facts;
CREATE POLICY "own financial daily facts" ON public.financial_daily_facts
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "own financial daily category facts" ON public.financial_daily_category_facts;
CREATE POLICY "own financial daily category facts" ON public.financial_daily_category_facts
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "own financial current snapshot" ON public.financial_current_snapshots;
CREATE POLICY "own financial current snapshot" ON public.financial_current_snapshots
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "own financial feature flags" ON public.financial_feature_flags;
CREATE POLICY "own financial feature flags" ON public.financial_feature_flags
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "active financial report templates" ON public.financial_report_templates;
CREATE POLICY "active financial report templates" ON public.financial_report_templates
  FOR SELECT TO authenticated USING (active);

GRANT SELECT ON public.financial_daily_facts,
  public.financial_daily_category_facts,
  public.financial_current_snapshots,
  public.financial_feature_flags,
  public.financial_report_templates TO authenticated;
GRANT ALL ON public.financial_daily_facts,
  public.financial_daily_category_facts,
  public.financial_current_snapshots,
  public.financial_backfill_checkpoints,
  public.financial_metric_diffs,
  public.financial_feature_flags,
  public.financial_report_templates TO service_role;

-- Fórmula canônica v1. Mantida em SQL para Home, Assessor, WhatsApp,
-- relatórios e gráficos consumirem exatamente a mesma classificação.
CREATE OR REPLACE FUNCTION public.is_behavioral_consumption(
  p_type text, p_status text, p_movement_kind text, p_transfer_group_id uuid,
  p_settles_card_id uuid
) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p_type = 'expense'
     AND coalesce(p_status, 'confirmed') = 'confirmed'
     AND p_transfer_group_id IS NULL
     AND p_settles_card_id IS NULL
     AND coalesce(p_movement_kind, 'transaction') NOT IN (
       'transfer','investment','investment_apply','investment_redeem',
       'card_payment','refund','informational'
     )
$$;

CREATE OR REPLACE FUNCTION public.refresh_financial_daily_facts(
  p_user_id uuid, p_from date, p_to date
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE affected integer;
BEGIN
  IF p_user_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'invalid_refresh_range';
  END IF;

  DELETE FROM public.financial_daily_facts
   WHERE user_id=p_user_id AND fact_date BETWEEN p_from AND p_to;
  DELETE FROM public.financial_daily_category_facts
   WHERE user_id=p_user_id AND fact_date BETWEEN p_from AND p_to;

  INSERT INTO public.financial_daily_facts(
    user_id,fact_date,income,cash_outflow,behavioral_consumption,
    account_consumption,card_consumption,transaction_count
  )
  SELECT t.user_id, t.occurred_at::date,
    coalesce(sum(t.amount) FILTER (
      WHERE t.type='income' AND coalesce(t.status,'confirmed')='confirmed'
        AND t.transfer_group_id IS NULL
        AND coalesce(t.movement_kind,'transaction') NOT IN
          ('transfer','investment','investment_apply','investment_redeem','informational')
    ),0),
    coalesce(sum(t.amount) FILTER (
      WHERE t.type='expense' AND coalesce(t.status,'confirmed')='confirmed'
        AND t.transfer_group_id IS NULL AND t.settles_card_id IS NULL
        AND coalesce(t.movement_kind,'transaction') NOT IN ('transfer','informational')
    ),0),
    coalesce(sum(t.amount) FILTER (WHERE public.is_behavioral_consumption(
      t.type::text,t.status::text,t.movement_kind,t.transfer_group_id,t.settles_card_id
    )),0),
    coalesce(sum(t.amount) FILTER (
      WHERE t.payment_method='account' AND public.is_behavioral_consumption(
        t.type::text,t.status::text,t.movement_kind,t.transfer_group_id,t.settles_card_id
      )
    ),0),
    coalesce(sum(t.amount) FILTER (
      WHERE t.payment_method='credit_card' AND public.is_behavioral_consumption(
        t.type::text,t.status::text,t.movement_kind,t.transfer_group_id,t.settles_card_id
      )
    ),0),
    count(*) FILTER (WHERE coalesce(t.status,'confirmed')='confirmed')
  FROM public.transactions t
  WHERE t.user_id=p_user_id AND t.occurred_at::date BETWEEN p_from AND p_to
  GROUP BY t.user_id,t.occurred_at::date;
  GET DIAGNOSTICS affected = ROW_COUNT;

  INSERT INTO public.financial_daily_category_facts(
    user_id,fact_date,category_id,consumption,transaction_count
  )
  SELECT t.user_id,t.occurred_at::date,t.category_id,sum(t.amount),count(*)
  FROM public.transactions t
  WHERE t.user_id=p_user_id AND t.occurred_at::date BETWEEN p_from AND p_to
    AND public.is_behavioral_consumption(
      t.type::text,t.status::text,t.movement_kind,t.transfer_group_id,t.settles_card_id
    )
  GROUP BY t.user_id,t.occurred_at::date,t.category_id;

  RETURN affected;
END $$;
REVOKE ALL ON FUNCTION public.refresh_financial_daily_facts(uuid,date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_financial_daily_facts(uuid,date,date) TO service_role;

INSERT INTO public.financial_report_templates(template_key,name,definition)
VALUES
  ('weekly_reflection_v1','Reflexão semanal', jsonb_build_object(
    'period','week','sections', jsonb_build_array('resumo','consumo','emocoes','proxima_semana')
  ))
ON CONFLICT (template_key) DO UPDATE
  SET name=excluded.name, definition=excluded.definition,
      version=public.financial_report_templates.version+1, updated_at=now();

NOTIFY pgrst, 'reload schema';