ALTER TABLE public.financial_reports DROP CONSTRAINT IF EXISTS financial_reports_report_type_check;
ALTER TABLE public.financial_reports
  ADD CONSTRAINT financial_reports_report_type_check
  CHECK (report_type IN ('weekly','monthly','monthly_partial','custom'));

DROP INDEX IF EXISTS public.financial_reports_unique_period;
CREATE UNIQUE INDEX IF NOT EXISTS financial_reports_unique_period
  ON public.financial_reports (user_id, report_type, period_start, period_end);