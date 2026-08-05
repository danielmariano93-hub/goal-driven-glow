UPDATE public.nino_diagnosis_snapshots
SET contract_version = 'nino_diagnosis_contract.v1.1'
WHERE is_current
  AND run_mode = 'live'
  AND contract_version = 'nino_diagnosis_contract.v1';