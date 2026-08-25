REVOKE EXECUTE ON FUNCTION public.admin_ai_usage_summary(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ai_usage_summary(integer) TO service_role;