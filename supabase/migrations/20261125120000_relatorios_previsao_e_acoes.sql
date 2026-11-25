-- Relatórios: memória da previsão (para comparar previsto x realizado) e das ações aceitas/dispensadas
-- (para medir a economia realizada contra o ponto de partida). Só cria tabelas novas; nada existente muda.

CREATE TABLE IF NOT EXISTS public.report_projection_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  as_of date NOT NULL,
  projected_consumption numeric(14,2),
  projected_end_balance numeric(14,2),
  conservative_end_balance numeric(14,2),
  formula_version text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, month, as_of)
);
ALTER TABLE public.report_projection_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "report_projection_snapshots_select_own" ON public.report_projection_snapshots;
CREATE POLICY "report_projection_snapshots_select_own" ON public.report_projection_snapshots
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS report_projection_snapshots_user_month_idx ON public.report_projection_snapshots (user_id, month, as_of DESC);

CREATE TABLE IF NOT EXISTS public.report_recommendation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  rec_key text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL DEFAULT '',
  action text NOT NULL CHECK (action IN ('dismissed', 'accepted')),
  merchant_key text,
  category text,
  baseline_amount numeric(14,2),
  monthly_impact numeric(14,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, month, rec_key)
);
ALTER TABLE public.report_recommendation_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "report_recommendation_actions_own" ON public.report_recommendation_actions;
CREATE POLICY "report_recommendation_actions_own" ON public.report_recommendation_actions
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS report_recommendation_actions_user_idx ON public.report_recommendation_actions (user_id, created_at DESC);
