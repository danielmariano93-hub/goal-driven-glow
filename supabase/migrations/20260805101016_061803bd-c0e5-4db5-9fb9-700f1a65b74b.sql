REVOKE ALL ON FUNCTION public.my_nino_diagnosis_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_nino_diagnosis_context() TO authenticated;