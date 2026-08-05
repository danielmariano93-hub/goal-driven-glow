UPDATE public.nino_diagnosis_config
SET contract_version = 'nino_diagnosis_contract.v1.1', updated_at = now()
WHERE singleton AND contract_version IS DISTINCT FROM 'nino_diagnosis_contract.v1.1';