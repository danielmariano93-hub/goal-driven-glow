ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS channel text,
  ADD COLUMN IF NOT EXISTS stage_ms jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS token_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS context_chars integer,
  ADD COLUMN IF NOT EXISTS tool_ms integer,
  ADD COLUMN IF NOT EXISTS llm_ms integer,
  ADD COLUMN IF NOT EXISTS routing_ms integer,
  ADD COLUMN IF NOT EXISTS history_ms integer,
  ADD COLUMN IF NOT EXISTS context_ms integer,
  ADD COLUMN IF NOT EXISTS persist_ms integer,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd numeric(12,6);

CREATE TABLE IF NOT EXISTS public.financial_profile_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  as_of date NOT NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  closed_months_analyzed integer NOT NULL DEFAULT 0,
  income_baseline numeric(14,2) NOT NULL DEFAULT 0,
  flexible_baseline numeric(14,2) NOT NULL DEFAULT 0,
  structural_baseline numeric(14,2) NOT NULL DEFAULT 0,
  savings_rate_median numeric(8,4),
  sustainable_monthly_saving numeric(14,2) NOT NULL DEFAULT 0,
  recoverable_monthly numeric(14,2) NOT NULL DEFAULT 0,
  net_worth numeric(14,2) NOT NULL DEFAULT 0,
  result_trend text,
  behavior_trend text,
  change_point jsonb,
  extraordinary_months jsonb NOT NULL DEFAULT '[]'::jsonb,
  flexible_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  months jsonb NOT NULL DEFAULT '[]'::jsonb,
  transactions_hash text,
  formula_version text NOT NULL DEFAULT 'financial_profile.v1',
  confidence text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, as_of, period_from, period_to)
);

GRANT SELECT ON public.financial_profile_snapshots TO authenticated;
GRANT ALL ON public.financial_profile_snapshots TO service_role;
ALTER TABLE public.financial_profile_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_financial_profile_snapshots" ON public.financial_profile_snapshots
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS financial_profile_snapshots_user_idx
  ON public.financial_profile_snapshots (user_id, as_of DESC);