-- Internal audit archive created by the Supabase Free readiness cleanup.
-- It is not part of the client-facing product surface, so client roles must not
-- read or mutate it through PostgREST. Service-role/database maintenance keeps
-- bypass access as expected.
ALTER TABLE public.category_decision_legacy_compaction ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny client access to legacy category compaction"
  ON public.category_decision_legacy_compaction;

CREATE POLICY "deny client access to legacy category compaction"
  ON public.category_decision_legacy_compaction
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
