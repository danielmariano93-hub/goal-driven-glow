CREATE OR REPLACE FUNCTION public.insights_generate_tick()
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
   WHERE name IN ('INTERNAL_CRON_SECRET','meunino_cron_secret','nocontrole_cron_secret')
   ORDER BY CASE name
     WHEN 'INTERNAL_CRON_SECRET' THEN 0
     WHEN 'meunino_cron_secret' THEN 1
     ELSE 2
   END, created_at DESC
   LIMIT 1;

  IF nullif(secret_value,'') IS NULL THEN
    INSERT INTO public.job_heartbeats(job_key,last_run_at,last_ok,last_error_code,processed,failed)
    VALUES('insights-generate',now(),false,'cron_secret_missing',0,1)
    ON CONFLICT (job_key) DO UPDATE SET
      last_run_at=excluded.last_run_at,last_ok=false,last_error_code=excluded.last_error_code,
      failed=public.job_heartbeats.failed+1,updated_at=now();
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := 'https://wesjjdjmlnfjihkkgzfp.supabase.co/functions/v1/insights-generate',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || coalesce(current_setting('app.settings.anon_key', true), ''),
      'x-cron-secret',secret_value
    ),
    body := jsonb_build_object('source','pg_cron')
  ) INTO request_id;

  INSERT INTO public.job_heartbeats(job_key,last_run_at,last_ok,last_error_code,processed,failed)
  VALUES('insights-generate',now(),true,NULL,0,0)
  ON CONFLICT (job_key) DO UPDATE SET
    last_run_at=excluded.last_run_at,last_ok=true,last_error_code=NULL,updated_at=now();

  RETURN request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.insights_generate_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insights_generate_tick() TO service_role;

SELECT cron.unschedule('insights-generate-hourly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'insights-generate-hourly');

SELECT cron.schedule('insights-generate-hourly', '37 * * * *', 'SELECT public.insights_generate_tick()');