-- F0 (custo e escala) — parte B (APLICADA em produção). Aditivo e reversível. Veja docs/NINO_CAUSAS_E_ALERTAS_REFINAMENTO_TECNICO.md.
-- 1b) Lembretes da divisão: varredura de agendamento a cada 5 min (criar/editar divisão já agenda na hora, com
--     p_expense_id); Edge Function só quando há lembrete vencido (mesma condição de claim_reminder_jobs).
--     O painel de saúde marca o job "atrasado" após 30 min sem batimento: em repouso gravamos o batimento no
--     máximo a cada 10 min (uma leitura por PK por minuto; escrita só quando vencido).
CREATE OR REPLACE FUNCTION public.split_message_pipeline_tick()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault'
AS $function$
DECLARE
  secret_value text;
  request_id bigint;
BEGIN
  IF (extract(minute FROM now())::int % 5) = 0 THEN
    PERFORM public.schedule_split_due_reminders(NULL);
  END IF;

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
    VALUES('split-reminders-dispatch',now(),false,'cron_secret_missing',0,1)
    ON CONFLICT (job_key) DO UPDATE SET
      last_run_at=excluded.last_run_at,last_ok=false,last_error_code=excluded.last_error_code,
      failed=public.job_heartbeats.failed+1,updated_at=now();
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.reminder_jobs q
     WHERE (q.status = 'queued'::public.reminder_status
            OR (q.status = 'processing'::public.reminder_status AND q.lease_expires_at < now()))
       AND q.scheduled_for <= now()
       AND coalesce(q.attempts, 0) < 5
     LIMIT 1
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.job_heartbeats
       WHERE job_key = 'split-reminders-dispatch' AND last_run_at > now() - interval '10 minutes'
    ) THEN
      INSERT INTO public.job_heartbeats(job_key,last_run_at,last_ok,last_error_code,processed,failed)
      VALUES('split-reminders-dispatch',now(),true,NULL,0,0)
      ON CONFLICT (job_key) DO UPDATE SET
        last_run_at=excluded.last_run_at,last_ok=true,last_error_code=NULL,processed=0,failed=0,updated_at=now();
    END IF;
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := 'https://amjanjlvsatubxdreyep.supabase.co/functions/v1/split-reminders-dispatch-v2',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || coalesce(current_setting('app.settings.anon_key', true), ''),
      'x-cron-secret',secret_value
    ),
    body := jsonb_build_object('source','pg_cron')
  ) INTO request_id;
  RETURN request_id;
END;
$function$;

-- ---------------------------------------------------------------------------------------------------------
