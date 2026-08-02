-- ============================================================
-- finance_contract.v4 — pontes financeiras persistidas + exclusão de relatórios
-- ============================================================

-- 1) PONTE DE CAIXA POR PERÍODO
CREATE TABLE IF NOT EXISTS public.financial_cash_bridges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  account_id uuid NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  opening_cash numeric(14,2) NOT NULL DEFAULT 0,
  operational_income numeric(14,2) NOT NULL DEFAULT 0,
  operational_account_expense numeric(14,2) NOT NULL DEFAULT 0,
  investment_redemptions numeric(14,2) NOT NULL DEFAULT 0,
  investment_applications numeric(14,2) NOT NULL DEFAULT 0,
  external_transfers_in numeric(14,2) NOT NULL DEFAULT 0,
  external_transfers_out numeric(14,2) NOT NULL DEFAULT 0,
  internal_transfers_net numeric(14,2) NOT NULL DEFAULT 0,
  loan_proceeds numeric(14,2) NOT NULL DEFAULT 0,
  debt_principal_payments numeric(14,2) NOT NULL DEFAULT 0,
  debt_interest_and_fees numeric(14,2) NOT NULL DEFAULT 0,
  card_payments numeric(14,2) NOT NULL DEFAULT 0,
  refunds_and_reimbursements numeric(14,2) NOT NULL DEFAULT 0,
  adjustments numeric(14,2) NOT NULL DEFAULT 0,
  calculated_closing_cash numeric(14,2) NOT NULL DEFAULT 0,
  confirmed_closing_cash numeric(14,2) NOT NULL DEFAULT 0,
  reconciliation_difference numeric(14,2) NOT NULL DEFAULT 0,
  confidence text NOT NULL DEFAULT 'medium',
  formula_version text NOT NULL DEFAULT 'cash_bridge.v1',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS financial_cash_bridges_uniq
  ON public.financial_cash_bridges (user_id, COALESCE(account_id, '00000000-0000-0000-0000-000000000000'::uuid), period_start, period_end, formula_version);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_cash_bridges TO authenticated;
GRANT ALL ON public.financial_cash_bridges TO service_role;
ALTER TABLE public.financial_cash_bridges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cash_bridges_owner" ON public.financial_cash_bridges;
CREATE POLICY "cash_bridges_owner" ON public.financial_cash_bridges
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP TRIGGER IF EXISTS trg_cash_bridges_touch ON public.financial_cash_bridges;
CREATE TRIGGER trg_cash_bridges_touch BEFORE UPDATE ON public.financial_cash_bridges
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

-- 2) PONTE PATRIMONIAL POR PERÍODO
CREATE TABLE IF NOT EXISTS public.financial_net_worth_bridges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  opening_cash numeric(14,2) NOT NULL DEFAULT 0,
  opening_investments numeric(14,2) NOT NULL DEFAULT 0,
  opening_debts numeric(14,2) NOT NULL DEFAULT 0,
  opening_net_worth numeric(14,2) NOT NULL DEFAULT 0,
  operational_result numeric(14,2) NOT NULL DEFAULT 0,
  investment_return numeric(14,2) NOT NULL DEFAULT 0,
  investment_applications numeric(14,2) NOT NULL DEFAULT 0,
  investment_redemptions numeric(14,2) NOT NULL DEFAULT 0,
  debt_principal_change numeric(14,2) NOT NULL DEFAULT 0,
  interest_and_fees numeric(14,2) NOT NULL DEFAULT 0,
  valuation_adjustments numeric(14,2) NOT NULL DEFAULT 0,
  closing_cash numeric(14,2) NOT NULL DEFAULT 0,
  closing_investments numeric(14,2) NOT NULL DEFAULT 0,
  closing_debts numeric(14,2) NOT NULL DEFAULT 0,
  closing_net_worth numeric(14,2) NOT NULL DEFAULT 0,
  confidence text NOT NULL DEFAULT 'medium',
  formula_version text NOT NULL DEFAULT 'net_worth_bridge.v1',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS financial_net_worth_bridges_uniq
  ON public.financial_net_worth_bridges (user_id, period_start, period_end, formula_version);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_net_worth_bridges TO authenticated;
GRANT ALL ON public.financial_net_worth_bridges TO service_role;
ALTER TABLE public.financial_net_worth_bridges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "net_worth_bridges_owner" ON public.financial_net_worth_bridges;
CREATE POLICY "net_worth_bridges_owner" ON public.financial_net_worth_bridges
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP TRIGGER IF EXISTS trg_nw_bridges_touch ON public.financial_net_worth_bridges;
CREATE TRIGGER trg_nw_bridges_touch BEFORE UPDATE ON public.financial_net_worth_bridges
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

-- 3) AUDITORIA DE EXCLUSÃO DE RELATÓRIOS
CREATE TABLE IF NOT EXISTS public.financial_report_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  report_id uuid NOT NULL,
  report_type text,
  period_start date,
  period_end date,
  metrics_deleted integer NOT NULL DEFAULT 0,
  highlights_deleted integer NOT NULL DEFAULT 0,
  deliveries_deleted integer NOT NULL DEFAULT 0,
  deleted_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.financial_report_deletions TO authenticated;
GRANT ALL ON public.financial_report_deletions TO service_role;
ALTER TABLE public.financial_report_deletions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "report_deletions_owner_read" ON public.financial_report_deletions;
CREATE POLICY "report_deletions_owner_read" ON public.financial_report_deletions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 4) RPC TRANSACIONAL DE EXCLUSÃO (RLS respeitada explicitamente pelo owner check)
CREATE OR REPLACE FUNCTION public.delete_financial_report(p_report_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_report record;
  v_metrics integer := 0;
  v_highlights integer := 0;
  v_deliveries integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT id, user_id, report_type, period_start, period_end
    INTO v_report
    FROM public.financial_reports
   WHERE id = p_report_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'report_not_found';
  END IF;

  IF v_report.user_id <> v_uid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  DELETE FROM public.financial_report_metrics WHERE report_id = p_report_id;
  GET DIAGNOSTICS v_metrics = ROW_COUNT;

  DELETE FROM public.financial_report_highlights WHERE report_id = p_report_id;
  GET DIAGNOSTICS v_highlights = ROW_COUNT;

  DELETE FROM public.financial_report_deliveries WHERE report_id = p_report_id;
  GET DIAGNOSTICS v_deliveries = ROW_COUNT;

  DELETE FROM public.financial_reports WHERE id = p_report_id AND user_id = v_uid;

  INSERT INTO public.financial_report_deletions
    (user_id, report_id, report_type, period_start, period_end,
     metrics_deleted, highlights_deleted, deliveries_deleted)
  VALUES
    (v_uid, p_report_id, v_report.report_type, v_report.period_start, v_report.period_end,
     v_metrics, v_highlights, v_deliveries);

  RETURN jsonb_build_object(
    'deleted', true,
    'report_id', p_report_id,
    'metrics_deleted', v_metrics,
    'highlights_deleted', v_highlights,
    'deliveries_deleted', v_deliveries
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_financial_report(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_financial_report(uuid) TO authenticated;

-- 5) UPSERT DAS PONTES (idempotente, usado pelo app e pelas Edge Functions)
CREATE OR REPLACE FUNCTION public.upsert_cash_bridge(p_bridge jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_account uuid := NULLIF(p_bridge->>'account_id', '')::uuid;
BEGIN
  IF v_uid IS NULL THEN
    v_uid := NULLIF(p_bridge->>'user_id', '')::uuid;
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  DELETE FROM public.financial_cash_bridges
   WHERE user_id = v_uid
     AND COALESCE(account_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = COALESCE(v_account, '00000000-0000-0000-0000-000000000000'::uuid)
     AND period_start = (p_bridge->>'period_start')::date
     AND period_end = (p_bridge->>'period_end')::date
     AND formula_version = COALESCE(p_bridge->>'formula_version', 'cash_bridge.v1');

  INSERT INTO public.financial_cash_bridges (
    user_id, account_id, period_start, period_end,
    opening_cash, operational_income, operational_account_expense,
    investment_redemptions, investment_applications,
    external_transfers_in, external_transfers_out, internal_transfers_net,
    loan_proceeds, debt_principal_payments, debt_interest_and_fees,
    card_payments, refunds_and_reimbursements, adjustments,
    calculated_closing_cash, confirmed_closing_cash, reconciliation_difference,
    confidence, formula_version, evidence, computed_at
  ) VALUES (
    v_uid, v_account,
    (p_bridge->>'period_start')::date, (p_bridge->>'period_end')::date,
    COALESCE((p_bridge->>'opening_cash')::numeric, 0),
    COALESCE((p_bridge->>'operational_income')::numeric, 0),
    COALESCE((p_bridge->>'operational_account_expense')::numeric, 0),
    COALESCE((p_bridge->>'investment_redemptions')::numeric, 0),
    COALESCE((p_bridge->>'investment_applications')::numeric, 0),
    COALESCE((p_bridge->>'external_transfers_in')::numeric, 0),
    COALESCE((p_bridge->>'external_transfers_out')::numeric, 0),
    COALESCE((p_bridge->>'internal_transfers_net')::numeric, 0),
    COALESCE((p_bridge->>'loan_proceeds')::numeric, 0),
    COALESCE((p_bridge->>'debt_principal_payments')::numeric, 0),
    COALESCE((p_bridge->>'debt_interest_and_fees')::numeric, 0),
    COALESCE((p_bridge->>'card_payments')::numeric, 0),
    COALESCE((p_bridge->>'refunds_and_reimbursements')::numeric, 0),
    COALESCE((p_bridge->>'adjustments')::numeric, 0),
    COALESCE((p_bridge->>'calculated_closing_cash')::numeric, 0),
    COALESCE((p_bridge->>'confirmed_closing_cash')::numeric, 0),
    COALESCE((p_bridge->>'reconciliation_difference')::numeric, 0),
    COALESCE(p_bridge->>'confidence', 'medium'),
    COALESCE(p_bridge->>'formula_version', 'cash_bridge.v1'),
    COALESCE(p_bridge->'evidence', '{}'::jsonb),
    now()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_cash_bridge(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_cash_bridge(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.upsert_net_worth_bridge(p_bridge jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    v_uid := NULLIF(p_bridge->>'user_id', '')::uuid;
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  DELETE FROM public.financial_net_worth_bridges
   WHERE user_id = v_uid
     AND period_start = (p_bridge->>'period_start')::date
     AND period_end = (p_bridge->>'period_end')::date
     AND formula_version = COALESCE(p_bridge->>'formula_version', 'net_worth_bridge.v1');

  INSERT INTO public.financial_net_worth_bridges (
    user_id, period_start, period_end,
    opening_cash, opening_investments, opening_debts, opening_net_worth,
    operational_result, investment_return, investment_applications, investment_redemptions,
    debt_principal_change, interest_and_fees, valuation_adjustments,
    closing_cash, closing_investments, closing_debts, closing_net_worth,
    confidence, formula_version, evidence, computed_at
  ) VALUES (
    v_uid, (p_bridge->>'period_start')::date, (p_bridge->>'period_end')::date,
    COALESCE((p_bridge->>'opening_cash')::numeric, 0),
    COALESCE((p_bridge->>'opening_investments')::numeric, 0),
    COALESCE((p_bridge->>'opening_debts')::numeric, 0),
    COALESCE((p_bridge->>'opening_net_worth')::numeric, 0),
    COALESCE((p_bridge->>'operational_result')::numeric, 0),
    COALESCE((p_bridge->>'investment_return')::numeric, 0),
    COALESCE((p_bridge->>'investment_applications')::numeric, 0),
    COALESCE((p_bridge->>'investment_redemptions')::numeric, 0),
    COALESCE((p_bridge->>'debt_principal_change')::numeric, 0),
    COALESCE((p_bridge->>'interest_and_fees')::numeric, 0),
    COALESCE((p_bridge->>'valuation_adjustments')::numeric, 0),
    COALESCE((p_bridge->>'closing_cash')::numeric, 0),
    COALESCE((p_bridge->>'closing_investments')::numeric, 0),
    COALESCE((p_bridge->>'closing_debts')::numeric, 0),
    COALESCE((p_bridge->>'closing_net_worth')::numeric, 0),
    COALESCE(p_bridge->>'confidence', 'medium'),
    COALESCE(p_bridge->>'formula_version', 'net_worth_bridge.v1'),
    COALESCE(p_bridge->'evidence', '{}'::jsonb),
    now()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_net_worth_bridge(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_net_worth_bridge(jsonb) TO authenticated, service_role;

-- 6) REGISTRO DAS MÉTRICAS CANÔNICAS DA v4
INSERT INTO public.intelligence_metric_registry
  (metric_key, label, formula, formula_version, description,
   default_window_days, minimum_sample, include_zero_days, outlier_policy, active)
SELECT m.key, m.label, m.unit, 'finance_contract.v4', m.description,
       30, 1, true, 'none', true
FROM (VALUES
  ('opening_cash','Saldo inicial em conta','BRL','Saldo em conta no primeiro dia do período'),
  ('closing_cash','Saldo final em conta','BRL','Saldo em conta no último dia do período'),
  ('cash_change','Variação do saldo','BRL','Saldo final menos saldo inicial'),
  ('opening_investments','Investido no início','BRL','Carteira no início do período'),
  ('closing_investments','Investido no fim','BRL','Carteira no fim do período'),
  ('opening_net_worth','Patrimônio inicial','BRL','Recursos menos obrigações no início'),
  ('closing_net_worth','Patrimônio final','BRL','Recursos menos obrigações no fim'),
  ('net_worth_change','Variação patrimonial','BRL','Patrimônio final menos inicial'),
  ('operational_income','Receitas reais','BRL','Receitas da rotina, sem movimentação patrimonial'),
  ('operational_expense','Gastos reais','BRL','Gastos da rotina líquidos de estorno'),
  ('operational_gap','Gastos acima das receitas','BRL','Quanto o consumo passou das receitas'),
  ('investment_redemptions','Resgates','BRL','Saídas de investimento que entraram na conta'),
  ('investment_applications','Aplicações','BRL','Saídas da conta que foram para investimento'),
  ('external_transfers_in','Transferências recebidas','BRL','Entradas de terceiros'),
  ('external_transfers_out','Transferências enviadas','BRL','Saídas para terceiros'),
  ('card_payments','Pagamentos de fatura','BRL','Débitos em conta que quitaram cartão'),
  ('loan_proceeds','Empréstimos creditados','BRL','Crédito recebido — dívida, não receita'),
  ('debt_payments','Pagamentos de dívidas','BRL','Amortização de principal'),
  ('refunds_and_reimbursements','Estornos e reembolsos','BRL','Créditos que abatem gastos'),
  ('reconciliation_adjustment','Ajuste de conciliação','BRL','Diferença para o extrato do banco'),
  ('cash_bridge_confidence','Confiança da ponte de caixa','text','Qualidade da reconciliação do período')
) AS m(key, label, unit, description)
WHERE NOT EXISTS (
  SELECT 1 FROM public.intelligence_metric_registry r WHERE r.metric_key = m.key
);