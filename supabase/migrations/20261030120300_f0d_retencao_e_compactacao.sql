-- F0 (custo e escala) — parte D (pendente). Aditivo e reversível. Veja docs/NINO_CAUSAS_E_ALERTAS_REFINAMENTO_TECNICO.md.
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
