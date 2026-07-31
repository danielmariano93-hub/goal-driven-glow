-- 1) Fix mutable search_path on remaining helper functions
ALTER FUNCTION public._break_glass_allowed_fields() SET search_path = public;
ALTER FUNCTION public._envelope(numeric, numeric, integer, text, text, jsonb) SET search_path = public;
ALTER FUNCTION public._mask_email(text) SET search_path = public;
ALTER FUNCTION public._mask_name(text) SET search_path = public;
ALTER FUNCTION public.amount_to_bucket(numeric) SET search_path = public;
ALTER FUNCTION public.category_alias_key(text) SET search_path = public;
ALTER FUNCTION public.set_updated_at_investment_movements() SET search_path = public;
ALTER FUNCTION public.split_due_timestamp(date, integer) SET search_path = public;

-- 2) Remove EXECUTE for anonymous (and implicit PUBLIC) callers on every public function,
--    and keep service_role fully able to call them.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- 3) Signed-in users must not be able to invoke trigger functions or internal test harnesses.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND (
        pg_get_function_result(p.oid) = 'trigger'
        OR p.proname LIKE '\_test\_%'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
  END LOOP;
END $$;
