
CREATE TABLE public.category_spending_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('percent_reduction','fixed_limit')),
  reduction_pct numeric(5,2),
  fixed_limit numeric(14,2),
  baseline_kind text NOT NULL DEFAULT 'avg_3m' CHECK (baseline_kind IN ('prev_month','avg_3m','custom')),
  baseline_value numeric(14,2),
  computed_limit numeric(14,2) NOT NULL,
  frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('once','monthly','custom')),
  start_date date NOT NULL DEFAULT (date_trunc('month', now())::date),
  end_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','cancelled')),
  alerts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.category_spending_goals TO authenticated;
GRANT ALL ON public.category_spending_goals TO service_role;

ALTER TABLE public.category_spending_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "csg_owner_all" ON public.category_spending_goals
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_csg_user_status ON public.category_spending_goals(user_id, status);
CREATE INDEX idx_csg_user_category ON public.category_spending_goals(user_id, category_id);

CREATE OR REPLACE FUNCTION public.csg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_csg_updated_at
  BEFORE UPDATE ON public.category_spending_goals
  FOR EACH ROW EXECUTE FUNCTION public.csg_set_updated_at();
