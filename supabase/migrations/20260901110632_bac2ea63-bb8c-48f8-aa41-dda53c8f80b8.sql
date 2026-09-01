REVOKE ALL ON FUNCTION public.admin_v3_ai_history(date, date, text, text, text, text, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.admin_nino_learning_overview(uuid, integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_v3_ai_history(date, date, text, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_nino_learning_overview(uuid, integer) TO authenticated, service_role;