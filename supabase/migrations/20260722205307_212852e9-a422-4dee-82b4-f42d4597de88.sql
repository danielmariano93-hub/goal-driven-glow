-- Metas de categoria: período correto, timezone e ciclos
ALTER TABLE public.category_spending_goals
  ADD COLUMN IF NOT EXISTS period_type text NOT NULL DEFAULT 'this_month',
  ADD COLUMN IF NOT EXISTS recurrence_end_date date NULL,
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  ADD COLUMN IF NOT EXISTS paused_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'category_spending_goals_period_type_check') THEN
    ALTER TABLE public.category_spending_goals
      ADD CONSTRAINT category_spending_goals_period_type_check
      CHECK (period_type IN ('this_month','next_month','next_30_days','custom','monthly_recurring'));
  END IF;
END $$;

-- Backfill: metas existentes com start_date != 1º do mês OU end_date nulo → normalizar para mês corrente da criação
UPDATE public.category_spending_goals
SET
  start_date = date_trunc('month', start_date)::date,
  end_date = (date_trunc('month', start_date) + interval '1 month - 1 day')::date,
  period_type = CASE WHEN frequency = 'monthly' AND end_date IS NULL THEN 'monthly_recurring' ELSE 'this_month' END
WHERE end_date IS NULL OR start_date <> date_trunc('month', start_date)::date;

-- Índice para performance
CREATE INDEX IF NOT EXISTS idx_csg_period ON public.category_spending_goals(user_id, category_id, start_date, end_date);

-- Histórico de ciclos (metas recorrentes)
CREATE TABLE IF NOT EXISTS public.category_spending_goal_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES public.category_spending_goals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  baseline_snapshot numeric(14,2),
  target_snapshot numeric(14,2) NOT NULL,
  actual_spend numeric(14,2) NOT NULL DEFAULT 0,
  projected_spend numeric(14,2),
  final_status text,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (goal_id, start_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.category_spending_goal_cycles TO authenticated;
GRANT ALL ON public.category_spending_goal_cycles TO service_role;

ALTER TABLE public.category_spending_goal_cycles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS csgc_owner_all ON public.category_spending_goal_cycles;
CREATE POLICY csgc_owner_all ON public.category_spending_goal_cycles
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_csgc_goal_period ON public.category_spending_goal_cycles(goal_id, start_date, end_date);