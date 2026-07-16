REVOKE ALL ON FUNCTION public.recurring_generate_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recurring_generate_due(integer) TO service_role;