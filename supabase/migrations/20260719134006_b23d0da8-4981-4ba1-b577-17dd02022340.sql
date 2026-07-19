
-- 1) Restrict pulse_snapshots read policy to authenticated role
DROP POLICY IF EXISTS "own pulse snapshots read" ON public.pulse_snapshots;
CREATE POLICY "own pulse snapshots read"
  ON public.pulse_snapshots
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 2) Set immutable search_path on remaining functions
ALTER FUNCTION public._touch_updated_at() SET search_path = public;
ALTER FUNCTION public.credit_card_competence(integer, date) SET search_path = public;

-- 3) Revoke EXECUTE from PUBLIC/anon on all SECURITY DEFINER functions in public schema,
--    then re-grant EXECUTE to authenticated + service_role. Internal role checks inside
--    the function bodies continue to enforce admin-only access where required.
DO $$
DECLARE
  r record;
  sig text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    sig := format('public.%I(%s)', r.proname, r.args);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
  END LOOP;
END $$;
