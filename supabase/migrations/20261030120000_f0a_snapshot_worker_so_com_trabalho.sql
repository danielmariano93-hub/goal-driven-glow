-- F0 (custo e escala) — parte A (APLICADA em produção). Aditivo e reversível. Veja docs/NINO_CAUSAS_E_ALERTAS_REFINAMENTO_TECNICO.md.
-- 1a) Snapshot da Home: worker só roda quando há usuário claimável (mesma condição de finance_snapshot_refresh_claim)
CREATE OR REPLACE FUNCTION public.finance_snapshot_worker_tick()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault'
AS $function$
DECLARE
  secret_value text;
  request_id bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.financial_snapshot_refresh_queue q
     WHERE (q.locked_until IS NULL OR q.locked_until < now())
       AND NOT EXISTS (
         SELECT 1 FROM public.financial_dirty_periods d
          WHERE d.user_id = q.user_id AND d.processed_at IS NULL
       )
     LIMIT 1
  ) THEN
    RETURN NULL;
  END IF;

  secret_value := public._cron_secret();
  IF nullif(secret_value, '') IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := 'https://amjanjlvsatubxdreyep.supabase.co/functions/v1/finance-current-snapshot-worker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret_value),
    body := jsonb_build_object('limit', 12)
  ) INTO request_id;
  RETURN request_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.finance_snapshot_worker_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_snapshot_worker_tick() TO service_role;

SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'finance-current-snapshot-worker-1m'),
  command := 'SELECT public.finance_snapshot_worker_tick();'
);

-- ---------------------------------------------------------------------------------------------------------
