-- F0 (custo e escala): corta trabalho ocioso e escrita redundante sem mudar comportamento visível.
-- Aditivo e reversível: funções novas ao lado das antigas; o cron aponta para elas.
--  1) pollers de 1 min só invocam a Edge Function se houver trabalho (EXISTS idêntico à condição do claim);
--  2) evidência do diagnóstico deixa de ser regravada igual a cada avaliação (a trava existia só no repositório);
--  3) retenção declarada do histórico fino do diagnóstico (90 dias), em lote, 1x por dia;
--  4) compactação única (manual) de evidência duplicada já gravada.

-- ---------------------------------------------------------------------------------------------------------
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
-- 2) Evidência: não gravar a mesma evidência a cada avaliação (cresciam ~1,3 mil linhas/dia com 12 usuários)
CREATE INDEX IF NOT EXISTS financial_situation_evidence_recent_idx
  ON public.financial_situation_evidence (situation_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.nino_diag_evidence_dedupe_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_last public.financial_situation_evidence;
BEGIN
  SELECT * INTO v_last
    FROM public.financial_situation_evidence
   WHERE situation_id = NEW.situation_id
   ORDER BY created_at DESC, id DESC
   LIMIT 1;

  IF FOUND
     AND v_last.evidence_type IS NOT DISTINCT FROM NEW.evidence_type
     AND v_last.metric_key IS NOT DISTINCT FROM NEW.metric_key
     AND v_last.value IS NOT DISTINCT FROM NEW.value
     AND v_last.contribution_amount IS NOT DISTINCT FROM NEW.contribution_amount
     AND v_last.contribution_pct IS NOT DISTINCT FROM NEW.contribution_pct
     AND v_last.confidence IS NOT DISTINCT FROM NEW.confidence
     AND v_last.metadata IS NOT DISTINCT FROM NEW.metadata
  THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS nino_diag_evidence_dedupe_guard ON public.financial_situation_evidence;
CREATE TRIGGER nino_diag_evidence_dedupe_guard
BEFORE INSERT ON public.financial_situation_evidence
FOR EACH ROW EXECUTE FUNCTION public.nino_diag_evidence_dedupe_guard();

-- ---------------------------------------------------------------------------------------------------------
-- 3) Retenção do histórico fino do diagnóstico (90 dias), em lote. Só a leitura "atual" é usada pelo produto
--    (nino_home_context_for_user / nino_diagnosis_context_for_user); o histórico é auditoria.
CREATE INDEX IF NOT EXISTS nino_diagnosis_snapshots_retention_idx
  ON public.nino_diagnosis_snapshots (created_at) WHERE is_current IS NOT TRUE;
CREATE INDEX IF NOT EXISTS nino_diagnosis_runs_retention_idx
  ON public.nino_diagnosis_runs (started_at);

CREATE OR REPLACE FUNCTION public.nino_diagnosis_retention_tick(p_batch integer DEFAULT 5000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_batch integer := greatest(100, least(coalesce(p_batch, 5000), 20000));
  v_snapshots integer := 0;
  v_runs integer := 0;
  v_evidence integer := 0;
BEGIN
  WITH d AS (
    SELECT id FROM public.nino_diagnosis_snapshots
     WHERE is_current IS NOT TRUE AND created_at < now() - interval '90 days'
     ORDER BY created_at LIMIT v_batch
  )
  DELETE FROM public.nino_diagnosis_snapshots s USING d WHERE s.id = d.id;
  GET DIAGNOSTICS v_snapshots = ROW_COUNT;

  WITH d AS (
    SELECT id FROM public.nino_diagnosis_runs
     WHERE started_at < now() - interval '90 days'
     ORDER BY started_at LIMIT v_batch
  )
  DELETE FROM public.nino_diagnosis_runs r USING d WHERE r.id = d.id;
  GET DIAGNOSTICS v_runs = ROW_COUNT;

  WITH d AS (
    SELECT e.id FROM public.financial_situation_evidence e
      JOIN public.financial_situations s ON s.id = e.situation_id
     WHERE s.status IN ('resolved','expired','suppressed') AND s.updated_at < now() - interval '90 days'
     LIMIT v_batch
  )
  DELETE FROM public.financial_situation_evidence e USING d WHERE e.id = d.id;
  GET DIAGNOSTICS v_evidence = ROW_COUNT;

  RETURN jsonb_build_object('snapshots', v_snapshots, 'runs', v_runs, 'evidence', v_evidence, 'at', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.nino_diagnosis_retention_tick(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nino_diagnosis_retention_tick(integer) TO service_role;

SELECT cron.schedule('nino-diagnosis-retention-daily', '35 4 * * *', $$SELECT public.nino_diagnosis_retention_tick();$$);

-- ---------------------------------------------------------------------------------------------------------
-- 4) Compactação ÚNICA e manual da evidência já duplicada (mantém a primeira linha de cada sequência idêntica).
--    NÃO é agendada: varre a tabela inteira; a trava do item 2 impede novas duplicatas.
CREATE OR REPLACE FUNCTION public.nino_diagnosis_compact_evidence_once(p_batch integer DEFAULT 100000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted integer := 0;
BEGIN
  WITH ranked AS (
    SELECT id,
           evidence_type, metric_key, value, contribution_amount, contribution_pct, confidence, metadata,
           lag(id) OVER w AS prev_id,
           lag(evidence_type) OVER w AS p_type, lag(metric_key) OVER w AS p_metric, lag(value) OVER w AS p_value,
           lag(contribution_amount) OVER w AS p_amount, lag(contribution_pct) OVER w AS p_pct,
           lag(confidence) OVER w AS p_conf, lag(metadata) OVER w AS p_meta
      FROM public.financial_situation_evidence
    WINDOW w AS (PARTITION BY situation_id ORDER BY created_at, id)
  ), dup AS (
    SELECT id FROM ranked
     WHERE prev_id IS NOT NULL
       AND evidence_type IS NOT DISTINCT FROM p_type AND metric_key IS NOT DISTINCT FROM p_metric
       AND value IS NOT DISTINCT FROM p_value AND contribution_amount IS NOT DISTINCT FROM p_amount
       AND contribution_pct IS NOT DISTINCT FROM p_pct AND confidence IS NOT DISTINCT FROM p_conf
       AND metadata IS NOT DISTINCT FROM p_meta
     LIMIT greatest(1, coalesce(p_batch, 100000))
  )
  DELETE FROM public.financial_situation_evidence e USING dup WHERE e.id = dup.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

REVOKE ALL ON FUNCTION public.nino_diagnosis_compact_evidence_once(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nino_diagnosis_compact_evidence_once(integer) TO service_role;
