ALTER TABLE public.financial_current_snapshots
  ADD COLUMN IF NOT EXISTS period_status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS contract_version text NOT NULL DEFAULT 'financial_snapshot_contract.v5',
  ADD COLUMN IF NOT EXISTS completeness text NOT NULL DEFAULT 'partial',
  ADD COLUMN IF NOT EXISTS missing_sources text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS source_freshness jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS payload jsonb,
  ADD COLUMN IF NOT EXISTS generated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.financial_current_snapshots
  DROP CONSTRAINT IF EXISTS financial_current_snapshots_period_status_check;
ALTER TABLE public.financial_current_snapshots
  ADD CONSTRAINT financial_current_snapshots_period_status_check
  CHECK (period_status IN ('open','closed'));

ALTER TABLE public.financial_current_snapshots
  DROP CONSTRAINT IF EXISTS financial_current_snapshots_completeness_check;
ALTER TABLE public.financial_current_snapshots
  ADD CONSTRAINT financial_current_snapshots_completeness_check
  CHECK (completeness IN ('complete','partial','unavailable'));

ALTER TABLE public.financial_metric_diffs
  ADD COLUMN IF NOT EXISTS comparison_contract text,
  ADD COLUMN IF NOT EXISTS within_tolerance boolean,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS financial_current_snapshots_period_idx
  ON public.financial_current_snapshots(user_id, period_start, as_of_date DESC);

GRANT SELECT ON public.financial_current_snapshots TO authenticated;
GRANT ALL ON public.financial_current_snapshots TO service_role;
GRANT ALL ON public.financial_metric_diffs TO service_role;

CREATE OR REPLACE FUNCTION public.my_financial_snapshot_v6(
  _period_start date DEFAULT NULL,
  _period_end date DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE
    WHEN s.payload IS NULL THEN NULL
    ELSE s.payload || jsonb_build_object(
      'contract_version', s.contract_version,
      'generated_at', s.generated_at,
      'as_of', s.as_of_date,
      'period', jsonb_build_object(
        'start', s.period_start,
        'end', coalesce(_period_end, s.as_of_date),
        'status', s.period_status
      ),
      'completeness', s.completeness,
      'missing_sources', to_jsonb(s.missing_sources),
      'source_freshness', s.source_freshness,
      'confidence', s.confidence,
      'formula_versions', s.formula_versions
    )
  END
  FROM public.financial_current_snapshots s
  WHERE s.user_id = auth.uid()
    AND (_period_start IS NULL OR s.period_start = _period_start)
    AND (_period_end IS NULL OR s.as_of_date <= _period_end)
  ORDER BY s.as_of_date DESC, s.generated_at DESC
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.my_financial_snapshot_v6(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_financial_snapshot_v6(date,date) TO authenticated, service_role;