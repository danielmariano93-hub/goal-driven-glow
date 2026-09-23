-- Timezone-aware schedules for proactive financial reports.
-- Keeps pg_cron as the single scheduler and delegates report generation to the
-- existing financial-reports-generate Edge Function, so chart/accounting logic
-- is not duplicated.

CREATE TABLE IF NOT EXISTS public.financial_report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  schedule_key text NOT NULL,
  report_type text NOT NULL CHECK (report_type IN ('weekly', 'monthly', 'monthly_partial')),
  local_weekday smallint NOT NULL CHECK (local_weekday BETWEEN 0 AND 6),
  local_hour smallint NOT NULL CHECK (local_hour BETWEEN 0 AND 23),
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  enabled boolean NOT NULL DEFAULT true,
  last_dispatched_local_date date,
  last_dispatched_at timestamptz,
  last_request_id bigint,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_report_schedules_user_key_uniq UNIQUE (user_id, schedule_key)
);

CREATE INDEX IF NOT EXISTS financial_report_schedules_due_idx
  ON public.financial_report_schedules (enabled, local_weekday, local_hour)
  WHERE enabled = true;

ALTER TABLE public.financial_report_schedules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.financial_report_schedules FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.financial_reports_targeted_tick(
  p_report_type text,
  p_user_id uuid
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault'
AS $function$
DECLARE
  secret_value text;
  request_id bigint;
BEGIN
  IF p_report_type NOT IN ('weekly', 'monthly', 'monthly_partial') THEN
    RAISE EXCEPTION 'unsupported scheduled report type: %', p_report_type
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'scheduled report user not found'
      USING ERRCODE = '23503';
  END IF;

  SELECT decrypted_secret INTO secret_value
    FROM vault.decrypted_secrets
   WHERE name IN ('INTERNAL_CRON_SECRET','meunino_cron_secret','nocontrole_cron_secret')
   ORDER BY CASE name WHEN 'INTERNAL_CRON_SECRET' THEN 0 WHEN 'meunino_cron_secret' THEN 1 ELSE 2 END,
            created_at DESC
   LIMIT 1;

  IF nullif(secret_value, '') IS NULL THEN
    RAISE EXCEPTION 'cron_secret_missing';
  END IF;

  SELECT net.http_post(
    url := 'https://amjanjlvsatubxdreyep.supabase.co/functions/v1/financial-reports-generate',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret', secret_value,
      'x-internal-secret', secret_value
    ),
    body := jsonb_build_object(
      'source','scheduled_report',
      'mode','cron',
      'report_type',p_report_type,
      'user_id',p_user_id
    )
  ) INTO request_id;

  RETURN request_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.financial_reports_targeted_tick(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.financial_reports_targeted_tick(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.financial_report_schedules_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault'
AS $function$
DECLARE
  s public.financial_report_schedules%ROWTYPE;
  local_now timestamp without time zone;
  local_date date;
  request_id bigint;
  dispatched integer := 0;
  failed integer := 0;
BEGIN
  FOR s IN
    SELECT *
      FROM public.financial_report_schedules
     WHERE enabled = true
     ORDER BY id
  LOOP
    BEGIN
      local_now := now() AT TIME ZONE s.timezone;
      local_date := local_now::date;

      IF extract(dow FROM local_now)::smallint <> s.local_weekday
         OR extract(hour FROM local_now)::smallint <> s.local_hour
         OR s.last_dispatched_local_date = local_date THEN
        CONTINUE;
      END IF;

      request_id := public.financial_reports_targeted_tick(s.report_type, s.user_id);

      UPDATE public.financial_report_schedules
         SET last_dispatched_local_date = local_date,
             last_dispatched_at = now(),
             last_request_id = request_id,
             last_error_code = NULL,
             updated_at = now()
       WHERE id = s.id;

      dispatched := dispatched + 1;
    EXCEPTION WHEN OTHERS THEN
      failed := failed + 1;
      UPDATE public.financial_report_schedules
         SET last_error_code = left(SQLSTATE || ':' || SQLERRM, 160),
             updated_at = now()
       WHERE id = s.id;
    END;
  END LOOP;

  INSERT INTO public.job_heartbeats(
    job_key,last_run_at,last_ok,last_error_code,processed,failed,updated_at
  ) VALUES (
    'financial-report-schedules',now(),failed = 0,
    CASE WHEN failed > 0 THEN 'scheduled_dispatch_failures' ELSE NULL END,
    dispatched,failed,now()
  )
  ON CONFLICT (job_key) DO UPDATE SET
    last_run_at = excluded.last_run_at,
    last_ok = excluded.last_ok,
    last_error_code = excluded.last_error_code,
    processed = excluded.processed,
    failed = excluded.failed,
    updated_at = now();

  RETURN jsonb_build_object('dispatched', dispatched, 'failed', failed);
END;
$function$;

REVOKE ALL ON FUNCTION public.financial_report_schedules_tick() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.financial_report_schedules_tick() TO service_role;

DO $do$
DECLARE
  existing_job_id bigint;
BEGIN
  SELECT jobid INTO existing_job_id
    FROM cron.job
   WHERE jobname = 'financial-report-schedules-hourly'
   LIMIT 1;

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  PERFORM cron.schedule(
    'financial-report-schedules-hourly',
    '0 * * * *',
    'select public.financial_report_schedules_tick();'
  );
END;
$do$;
