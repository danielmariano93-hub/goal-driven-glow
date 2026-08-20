GRANT INSERT, UPDATE ON public.financial_performance_snapshots TO authenticated;

CREATE POLICY "fps_own_insert" ON public.financial_performance_snapshots
FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "fps_own_update" ON public.financial_performance_snapshots
FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.admin_v2_advisor_observability(_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _snapshot JSONB;
  _affinity JSONB;
BEGIN
  PERFORM public._require_perm('admin.read');

  SELECT to_jsonb(s) INTO _snapshot
  FROM public.financial_performance_snapshots s
  WHERE s.user_id = _user_id AND s.invalidated_at IS NULL
  ORDER BY s.as_of DESC, s.created_at DESC
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.score DESC), '[]'::jsonb) INTO _affinity
  FROM public.user_advisor_topic_affinity a
  WHERE a.user_id = _user_id;

  RETURN jsonb_build_object(
    'user_id', _user_id,
    'snapshot', _snapshot,
    'affinity', _affinity,
    'generated_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_v2_advisor_observability(UUID) TO authenticated;