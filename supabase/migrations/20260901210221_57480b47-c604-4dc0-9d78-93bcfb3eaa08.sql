ALTER TABLE public.nino_change_recommendations
  ADD COLUMN IF NOT EXISTS required_amount numeric,
  ADD COLUMN IF NOT EXISTS required_amount_role text;

COMMENT ON COLUMN public.nino_change_recommendations.required_amount IS 'Valor mensal necessário para cumprir o prazo vigente (transporte do motor canônico; nunca recalculado na UI).';
COMMENT ON COLUMN public.nino_change_recommendations.required_amount_role IS 'Papel do valor necessário (ex.: monthly_required).';