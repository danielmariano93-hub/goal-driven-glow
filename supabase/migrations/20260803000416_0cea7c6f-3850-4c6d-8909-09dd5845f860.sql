CREATE OR REPLACE FUNCTION public.finance_bridges_backfill_tick(p_months integer DEFAULT 13)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  secret_value text;
  request_id bigint;
BEGIN
  SELECT decrypted_secret INTO secret_value
    FROM vault.decrypted_secrets
   WHERE name IN ('INTERNAL_CRON_SECRET','CRON_SECRET','meunino_cron_secret','nocontrole_cron_secret')
   ORDER BY CASE name
     WHEN 'INTERNAL_CRON_SECRET' THEN 0
     WHEN 'CRON_SECRET' THEN 1
     WHEN 'meunino_cron_secret' THEN 2
     ELSE 3
   END, created_at DESC
   LIMIT 1;

  IF nullif(secret_value,'') IS NULL THEN
    INSERT INTO public.job_heartbeats(job_key,last_run_at,last_ok,last_error_code,processed,failed)
    VALUES('finance-bridges-backfill',now(),false,'cron_secret_missing',0,1)
    ON CONFLICT (job_key) DO UPDATE SET
      last_run_at=excluded.last_run_at,last_ok=false,last_error_code=excluded.last_error_code,
      failed=public.job_heartbeats.failed+1,updated_at=now();
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := 'https://wesjjdjmlnfjihkkgzfp.supabase.co/functions/v1/finance-bridges-backfill',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || coalesce(current_setting('app.settings.anon_key', true), ''),
      'x-internal-secret',secret_value
    ),
    body := jsonb_build_object('months', greatest(1, least(36, coalesce(p_months,13))), 'source','pg_cron'),
    timeout_milliseconds := 120000
  ) INTO request_id;

  INSERT INTO public.job_heartbeats(job_key,last_run_at,last_ok,last_error_code,processed,failed)
  VALUES('finance-bridges-backfill',now(),true,NULL,0,0)
  ON CONFLICT (job_key) DO UPDATE SET
    last_run_at=excluded.last_run_at,last_ok=true,last_error_code=NULL,updated_at=now();

  RETURN request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.finance_bridges_backfill_tick(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_bridges_backfill_tick(integer) TO service_role;

SELECT cron.unschedule('finance-bridges-backfill-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'finance-bridges-backfill-daily');

SELECT cron.schedule('finance-bridges-backfill-daily', '18 4 * * *', 'SELECT public.finance_bridges_backfill_tick(13)');

-- Primeira carga imediata (idempotente).
SELECT public.finance_bridges_backfill_tick(13);