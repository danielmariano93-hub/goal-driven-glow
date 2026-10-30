-- F0 (custo e escala) — parte C (pendente). Aditivo e reversível. Veja docs/NINO_CAUSAS_E_ALERTAS_REFINAMENTO_TECNICO.md.
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

-- A trava ainda não existe em produção (verificado); o corpo da função é substituído acima sem DROP.
DO $block$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'nino_diag_evidence_dedupe_guard'
                  AND tgrelid = 'public.financial_situation_evidence'::regclass) THEN
    CREATE TRIGGER nino_diag_evidence_dedupe_guard
    BEFORE INSERT ON public.financial_situation_evidence
    FOR EACH ROW EXECUTE FUNCTION public.nino_diag_evidence_dedupe_guard();
  END IF;
END
$block$;

-- ---------------------------------------------------------------------------------------------------------
