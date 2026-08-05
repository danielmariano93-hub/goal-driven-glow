REVOKE ALL ON FUNCTION public.nino_diagnosis_context_for_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nino_diagnosis_context_for_user(uuid) TO service_role;