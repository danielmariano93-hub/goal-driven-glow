CREATE OR REPLACE FUNCTION public.nino_diagnosis_contract_healthcheck()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_payload jsonb;
BEGIN
  SELECT user_id INTO v_user_id
  FROM public.nino_diagnosis_snapshots
  WHERE run_mode = 'live' AND is_current
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'checked', false, 'reason', 'no_current_snapshot');
  END IF;

  v_payload := public.nino_diagnosis_context_for_user(v_user_id);
  RETURN jsonb_build_object(
    'ok', COALESCE((v_payload->>'ok')::boolean, false),
    'checked', true,
    'contract', v_payload->>'contract',
    'has_snapshot', v_payload->'snapshot_id' IS NOT NULL
  );
END
$function$;

REVOKE ALL ON FUNCTION public.nino_diagnosis_contract_healthcheck() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nino_diagnosis_contract_healthcheck() TO service_role;