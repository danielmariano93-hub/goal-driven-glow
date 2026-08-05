DO $check$
DECLARE
  v_user_id uuid;
  v_payload jsonb;
BEGIN
  SELECT user_id INTO v_user_id
  FROM public.nino_diagnosis_snapshots
  WHERE run_mode = 'live' AND is_current
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_user_id IS NOT NULL THEN
    v_payload := public.nino_diagnosis_context_for_user(v_user_id);
    IF COALESCE((v_payload->>'ok')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'nino diagnosis healthcheck failed';
    END IF;
    IF v_payload->>'contract' <> 'nino_diagnosis_contract.v1.1' THEN
      RAISE EXCEPTION 'unexpected nino diagnosis contract: %', v_payload->>'contract';
    END IF;
  END IF;
END
$check$;