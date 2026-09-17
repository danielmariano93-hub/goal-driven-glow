-- Hardening after live validation of the Free readiness guards.
-- Keeps 30-minute diagnosis freshness while making unchanged cycles storage-idempotent.

CREATE OR REPLACE FUNCTION public.nino_snapshot_material_payload(_payload jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT jsonb_build_object(
    'primary_situation', CASE
      WHEN jsonb_typeof(_payload->'primary_situation')='object'
        THEN (_payload->'primary_situation') - ARRAY['updated_at','last_evaluation_run_id','valid_from']
      ELSE _payload->'primary_situation'
    END,
    'primary_action', CASE
      WHEN jsonb_typeof(_payload->'primary_action')='object'
        THEN (_payload->'primary_action') - ARRAY['updated_at']
      ELSE _payload->'primary_action'
    END,
    'supporting_situations', coalesce((
      SELECT jsonb_agg(
        CASE WHEN jsonb_typeof(x.elem)='object'
          THEN x.elem - ARRAY['updated_at','last_evaluation_run_id','valid_from']
          ELSE x.elem END
        ORDER BY x.ord
      )
      FROM jsonb_array_elements(coalesce(_payload->'supporting_situations','[]'::jsonb))
           WITH ORDINALITY AS x(elem,ord)
    ), '[]'::jsonb)
  );
$function$;

DO $block$
BEGIN
  IF to_regprocedure('public.nino_assemble_diagnosis_raw(uuid,date,text)') IS NULL THEN
    ALTER FUNCTION public.nino_assemble_diagnosis(uuid,date,text)
      RENAME TO nino_assemble_diagnosis_raw;
  END IF;
END;
$block$;

CREATE OR REPLACE FUNCTION public.nino_assemble_diagnosis(
  _user_id uuid,
  _as_of date DEFAULT CURRENT_DATE,
  _run_mode text DEFAULT 'live'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_previous public.nino_diagnosis_snapshots;
  v_new public.nino_diagnosis_snapshots;
  v_new_id uuid;
BEGIN
  IF _run_mode='live' THEN
    SELECT * INTO v_previous
    FROM public.nino_diagnosis_snapshots
    WHERE user_id=_user_id AND run_mode='live' AND is_current
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  v_new_id := public.nino_assemble_diagnosis_raw(_user_id,_as_of,_run_mode);

  IF _run_mode<>'live' OR v_previous.id IS NULL OR v_new_id IS NULL OR v_new_id=v_previous.id THEN
    RETURN v_new_id;
  END IF;

  SELECT * INTO v_new FROM public.nino_diagnosis_snapshots WHERE id=v_new_id;

  IF v_new.id IS NOT NULL
     AND v_previous.as_of IS NOT DISTINCT FROM v_new.as_of
     AND v_previous.overall_state IS NOT DISTINCT FROM v_new.overall_state
     AND v_previous.primary_situation_id IS NOT DISTINCT FROM v_new.primary_situation_id
     AND v_previous.supporting_situation_ids IS NOT DISTINCT FROM v_new.supporting_situation_ids
     AND v_previous.primary_action_id IS NOT DISTINCT FROM v_new.primary_action_id
     AND v_previous.forecast IS NOT DISTINCT FROM v_new.forecast
     AND v_previous.data_quality IS NOT DISTINCT FROM v_new.data_quality
     AND v_previous.confidence IS NOT DISTINCT FROM v_new.confidence
     AND v_previous.rationale IS NOT DISTINCT FROM v_new.rationale
     AND public.nino_snapshot_material_payload(v_previous.payload)
         IS NOT DISTINCT FROM public.nino_snapshot_material_payload(v_new.payload)
     AND v_previous.contract_version IS NOT DISTINCT FROM v_new.contract_version
  THEN
    DELETE FROM public.nino_diagnosis_snapshots WHERE id=v_new_id;
    UPDATE public.nino_diagnosis_snapshots SET is_current=true WHERE id=v_previous.id;
    RETURN v_previous.id;
  END IF;

  RETURN v_new_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.nino_assemble_diagnosis(uuid,date,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nino_assemble_diagnosis(uuid,date,text) TO service_role;

CREATE OR REPLACE FUNCTION public.nino_diag_event_dedupe_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.event_type IN ('improved','worsened','resolved','expired','confirmed','superseded')
     AND EXISTS (
       SELECT 1
       FROM public.financial_situation_events e
       WHERE e.situation_id=NEW.situation_id
         AND e.event_type=NEW.event_type
         AND e.from_status IS NOT DISTINCT FROM NEW.from_status
         AND e.to_status IS NOT DISTINCT FROM NEW.to_status
         AND e.delta_amount IS NOT DISTINCT FROM NEW.delta_amount
         AND e.metadata IS NOT DISTINCT FROM NEW.metadata
         AND e.occurred_at>=date_trunc('day',now())
     )
  THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS nino_diag_event_dedupe_guard ON public.financial_situation_events;
CREATE TRIGGER nino_diag_event_dedupe_guard
BEFORE INSERT ON public.financial_situation_events
FOR EACH ROW EXECUTE FUNCTION public.nino_diag_event_dedupe_guard();

-- Supporting indexes make the one-time source compaction bounded and keep FK lookups cheap.
CREATE INDEX IF NOT EXISTS transactions_category_decision_id_idx
  ON public.transactions(category_decision_id)
  WHERE category_decision_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS category_attempts_decision_id_idx
  ON public.category_classification_attempts(decision_id)
  WHERE decision_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS category_decisions_legacy_cleanup_idx
  ON public.category_decisions(created_at,transaction_id)
  WHERE action='leave_unresolved' AND source='none';
