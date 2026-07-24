-- Corrige o ponto cego do fluxo da Divisão do Rolê sem alterar secrets.
-- Expõe diagnóstico mascarado ao dono e registra ausência do segredo do cron.

CREATE OR REPLACE FUNCTION public.split_delivery_diagnosis(p_expense_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, vault AS $$
DECLARE
  uid uuid := auth.uid();
  result jsonb;
  cron_configured boolean;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.shared_expenses
     WHERE id=p_expense_id AND owner_user_id=uid
  ) THEN RAISE EXCEPTION 'split_not_found'; END IF;

  SELECT EXISTS(
    SELECT 1 FROM vault.decrypted_secrets
     WHERE name IN ('meunino_cron_secret','nocontrole_cron_secret')
       AND nullif(decrypted_secret,'') IS NOT NULL
  ) INTO cron_configured;

  SELECT jsonb_build_object(
    'cron_configured',cron_configured,
    'queued',count(*) FILTER (WHERE j.status='queued'),
    'processing',count(*) FILTER (WHERE j.status='processing'),
    'enqueued',count(*) FILTER (WHERE j.status='enqueued'),
    'sent',count(*) FILTER (WHERE o.status='sent'),
    'failed',count(*) FILTER (WHERE j.status = 'failed' OR o.status IN ('failed','dead')),
    'last_error',max(coalesce(o.last_error,j.last_error)),
    'last_update',max(greatest(j.updated_at,coalesce(o.updated_at,j.updated_at)))
  ) INTO result
  FROM public.reminder_jobs j
  LEFT JOIN public.outbound_messages o ON o.id=j.outbound_message_id
  WHERE j.shared_expense_id=p_expense_id AND j.owner_user_id=uid;

  RETURN coalesce(result,'{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.split_delivery_diagnosis(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.split_delivery_diagnosis(uuid) TO authenticated;

-- Compatibilidade de rebranding: novo nome primeiro, segredo legado preservado.
CREATE OR REPLACE FUNCTION public.split_message_pipeline_tick()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, vault AS $$
DECLARE secret_value text; request_id bigint;
BEGIN
  SELECT decrypted_secret INTO secret_value
    FROM vault.decrypted_secrets
   WHERE name IN ('meunino_cron_secret','nocontrole_cron_secret')
   ORDER BY CASE name WHEN 'meunino_cron_secret' THEN 0 ELSE 1 END, created_at DESC
   LIMIT 1;
  IF nullif(secret_value,'') IS NULL THEN
    INSERT INTO public.job_heartbeats(job_key,last_run_at,last_ok,last_error_code,processed,failed)
    VALUES('split-reminders-dispatch',now(),false,'cron_secret_missing',0,1)
    ON CONFLICT (job_key) DO UPDATE SET
      last_run_at=excluded.last_run_at,last_ok=false,last_error_code=excluded.last_error_code,
      failed=public.job_heartbeats.failed+1,updated_at=now();
    RETURN NULL;
  END IF;
  SELECT net.http_post(
    url := 'https://wesjjdjmlnfjihkkgzfp.supabase.co/functions/v1/split-reminders-dispatch',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',secret_value),
    body := jsonb_build_object('source','pg_cron')
  ) INTO request_id;
  RETURN request_id;
END $$;
REVOKE ALL ON FUNCTION public.split_message_pipeline_tick() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.split_message_pipeline_tick() TO service_role;

NOTIFY pgrst, 'reload schema';