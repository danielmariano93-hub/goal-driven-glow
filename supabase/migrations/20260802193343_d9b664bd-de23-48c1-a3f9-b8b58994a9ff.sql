-- ============ Relatórios Financeiros Inteligentes ============
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'financial_report';

CREATE TABLE IF NOT EXISTS public.financial_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  report_type text NOT NULL CHECK (report_type IN ('weekly','monthly')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  status text NOT NULL DEFAULT 'generating' CHECK (status IN ('generating','published','partial','failed')),
  generated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  viewed_at timestamptz,
  finance_contract_version text NOT NULL DEFAULT 'finance_contract.v2',
  insight_catalog_version text NOT NULL DEFAULT 'reports_catalog.v1',
  template_version text NOT NULL DEFAULT 'report_template.v1',
  health_score numeric(4,2),
  health_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  executive_summary text,
  closing_text text,
  text_source text NOT NULL DEFAULT 'deterministic' CHECK (text_source IN ('ai','deterministic')),
  text_fallback_reason text,
  data_quality_status text NOT NULL DEFAULT 'ok' CHECK (data_quality_status IN ('ok','attention','insufficient')),
  data_quality_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_reports_period_order CHECK (period_end >= period_start)
);
CREATE UNIQUE INDEX IF NOT EXISTS financial_reports_unique_period
  ON public.financial_reports (user_id, report_type, period_start);
CREATE INDEX IF NOT EXISTS financial_reports_user_recent
  ON public.financial_reports (user_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS public.financial_report_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.financial_reports(id) ON DELETE CASCADE,
  metric_key text NOT NULL,
  metric_label text NOT NULL DEFAULT '',
  metric_value numeric,
  metric_text text,
  comparison_value numeric,
  comparison_percentage numeric,
  unit text NOT NULL DEFAULT 'BRL' CHECK (unit IN ('BRL','pct','count','days','score','text')),
  source text NOT NULL DEFAULT 'finance_contract.v2',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS financial_report_metrics_unique
  ON public.financial_report_metrics (report_id, metric_key);

CREATE TABLE IF NOT EXISTS public.financial_report_highlights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.financial_reports(id) ON DELETE CASCADE,
  detector_key text NOT NULL,
  detector_version text NOT NULL DEFAULT 'v1',
  type text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  body text NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  confidence text NOT NULL DEFAULT 'medium' CHECK (confidence IN ('low','medium','high')),
  category text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  cta_label text,
  cta_route text,
  dedup_key text NOT NULL,
  selection_reason text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS financial_report_highlights_unique
  ON public.financial_report_highlights (report_id, dedup_key);

CREATE TABLE IF NOT EXISTS public.financial_report_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.financial_reports(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp','app')),
  recipient text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','failed','skipped')),
  provider_message_id text,
  attempt_count integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  error_code text,
  error_details text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS financial_report_deliveries_unique
  ON public.financial_report_deliveries (report_id, channel);

GRANT SELECT ON public.financial_reports TO authenticated;
GRANT ALL ON public.financial_reports TO service_role;
GRANT SELECT ON public.financial_report_metrics TO authenticated;
GRANT ALL ON public.financial_report_metrics TO service_role;
GRANT SELECT ON public.financial_report_highlights TO authenticated;
GRANT ALL ON public.financial_report_highlights TO service_role;
GRANT SELECT ON public.financial_report_deliveries TO authenticated;
GRANT ALL ON public.financial_report_deliveries TO service_role;

ALTER TABLE public.financial_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_report_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_report_highlights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_report_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own reports" ON public.financial_reports;
CREATE POLICY "own reports" ON public.financial_reports
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "own report metrics" ON public.financial_report_metrics;
CREATE POLICY "own report metrics" ON public.financial_report_metrics
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.financial_reports r
     WHERE r.id = financial_report_metrics.report_id AND r.user_id = auth.uid()));

DROP POLICY IF EXISTS "own report highlights" ON public.financial_report_highlights;
CREATE POLICY "own report highlights" ON public.financial_report_highlights
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.financial_reports r
     WHERE r.id = financial_report_highlights.report_id AND r.user_id = auth.uid()));

DROP POLICY IF EXISTS "own report deliveries" ON public.financial_report_deliveries;
CREATE POLICY "own report deliveries" ON public.financial_report_deliveries
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS trg_financial_reports_touch ON public.financial_reports;
CREATE TRIGGER trg_financial_reports_touch BEFORE UPDATE ON public.financial_reports
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();
DROP TRIGGER IF EXISTS trg_financial_report_deliveries_touch ON public.financial_report_deliveries;
CREATE TRIGGER trg_financial_report_deliveries_touch BEFORE UPDATE ON public.financial_report_deliveries
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

-- Preferências de relatório
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS weekly_report_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS monthly_report_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS report_weekday smallint NOT NULL DEFAULT 1 CHECK (report_weekday BETWEEN 0 AND 6),
  ADD COLUMN IF NOT EXISTS report_hour smallint NOT NULL DEFAULT 7 CHECK (report_hour BETWEEN 0 AND 23),
  ADD COLUMN IF NOT EXISTS report_timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  ADD COLUMN IF NOT EXISTS report_channel text NOT NULL DEFAULT 'both' CHECK (report_channel IN ('app','whatsapp','both')),
  ADD COLUMN IF NOT EXISTS report_detail_level text NOT NULL DEFAULT 'standard' CHECK (report_detail_level IN ('short','standard','deep')),
  ADD COLUMN IF NOT EXISTS report_tone text NOT NULL DEFAULT 'amigavel';

-- Marca leitura do relatório (somente o dono)
CREATE OR REPLACE FUNCTION public.mark_financial_report_viewed(p_report_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_at timestamptz;
BEGIN
  UPDATE public.financial_reports
     SET viewed_at = COALESCE(viewed_at, now())
   WHERE id = p_report_id AND user_id = auth.uid()
   RETURNING viewed_at INTO v_at;
  IF v_at IS NULL THEN
    RAISE EXCEPTION 'report_not_found';
  END IF;
  RETURN v_at;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mark_financial_report_viewed(uuid) TO authenticated;

-- Ticks de cron (chamam a Edge Function com o segredo do vault)
CREATE OR REPLACE FUNCTION public.financial_reports_tick(p_report_type text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  secret_value text;
  request_id bigint;
  job_key text := 'financial-reports-' || p_report_type;
BEGIN
  SELECT decrypted_secret INTO secret_value
    FROM vault.decrypted_secrets
   WHERE name IN ('INTERNAL_CRON_SECRET','meunino_cron_secret','nocontrole_cron_secret')
   ORDER BY CASE name WHEN 'INTERNAL_CRON_SECRET' THEN 0 WHEN 'meunino_cron_secret' THEN 1 ELSE 2 END,
            created_at DESC
   LIMIT 1;

  IF nullif(secret_value,'') IS NULL THEN
    INSERT INTO public.job_heartbeats(job_key,last_run_at,last_ok,last_error_code,processed,failed)
    VALUES(job_key,now(),false,'cron_secret_missing',0,1)
    ON CONFLICT (job_key) DO UPDATE SET
      last_run_at=excluded.last_run_at,last_ok=false,last_error_code=excluded.last_error_code,
      failed=public.job_heartbeats.failed+1,updated_at=now();
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := 'https://wesjjdjmlnfjihkkgzfp.supabase.co/functions/v1/financial-reports-generate',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret', secret_value,
      'x-internal-secret', secret_value
    ),
    body := jsonb_build_object('source','pg_cron','mode','cron','report_type',p_report_type)
  ) INTO request_id;
  RETURN request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.financial_reports_weekly_tick()
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ SELECT public.financial_reports_tick('weekly') $$;

CREATE OR REPLACE FUNCTION public.financial_reports_monthly_tick()
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ SELECT public.financial_reports_tick('monthly') $$;