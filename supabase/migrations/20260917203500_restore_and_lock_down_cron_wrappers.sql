-- Restore the two pg_cron wrapper functions that existed in the legacy backend,
-- point them at the owned Supabase project, and keep them database-internal.
CREATE OR REPLACE FUNCTION public.documents_cleanup_tick()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions','vault'
AS $$
DECLARE secret_value text; request_id bigint;
BEGIN
  SELECT decrypted_secret INTO secret_value
  FROM vault.decrypted_secrets
  WHERE name IN ('INTERNAL_CRON_SECRET','meunino_cron_secret','nocontrole_cron_secret')
  ORDER BY CASE name WHEN 'INTERNAL_CRON_SECRET' THEN 0 WHEN 'meunino_cron_secret' THEN 1 ELSE 2 END, created_at DESC
  LIMIT 1;
  IF nullif(secret_value,'') IS NULL THEN
    INSERT INTO public.job_heartbeats(job_key,last_run_at,last_ok,last_error_code,processed,failed)
    VALUES('documents-cleanup',now(),false,'cron_secret_missing',0,1)
    ON CONFLICT (job_key) DO UPDATE SET last_run_at=excluded.last_run_at,last_ok=false,last_error_code=excluded.last_error_code,failed=public.job_heartbeats.failed+1,updated_at=now();
    RETURN NULL;
  END IF;
  SELECT net.http_post(
    url := 'https://amjanjlvsatubxdreyep.supabase.co/functions/v1/documents-cleanup',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',secret_value,'x-internal-secret',secret_value),
    body := jsonb_build_object('source','pg_cron')
  ) INTO request_id;
  RETURN request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_ack_watchdog_tick()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions','vault'
AS $$
DECLARE secret_value text; request_id bigint;
BEGIN
  SELECT decrypted_secret INTO secret_value
  FROM vault.decrypted_secrets
  WHERE name IN ('INTERNAL_CRON_SECRET','meunino_cron_secret','nocontrole_cron_secret')
  ORDER BY CASE name WHEN 'INTERNAL_CRON_SECRET' THEN 0 WHEN 'meunino_cron_secret' THEN 1 ELSE 2 END, created_at DESC
  LIMIT 1;
  IF nullif(secret_value,'') IS NULL THEN
    INSERT INTO public.job_heartbeats(job_key,last_run_at,last_ok,last_error_code,processed,failed)
    VALUES('whatsapp-ack-watchdog',now(),false,'cron_secret_missing',0,1)
    ON CONFLICT (job_key) DO UPDATE SET last_run_at=excluded.last_run_at,last_ok=false,last_error_code=excluded.last_error_code,failed=public.job_heartbeats.failed+1,updated_at=now();
    RETURN NULL;
  END IF;
  SELECT net.http_post(
    url := 'https://amjanjlvsatubxdreyep.supabase.co/functions/v1/whatsapp-ack-watchdog',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',secret_value,'x-internal-secret',secret_value),
    body := jsonb_build_object('source','pg_cron')
  ) INTO request_id;
  RETURN request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.documents_cleanup_tick() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_ack_watchdog_tick() FROM PUBLIC, anon, authenticated;
