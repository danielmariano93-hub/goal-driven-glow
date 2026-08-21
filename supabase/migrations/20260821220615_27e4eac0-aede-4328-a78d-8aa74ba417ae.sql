CREATE OR REPLACE FUNCTION public.nino_situation_cooldown_ids(_user_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH last_fb AS (
    SELECT DISTINCT ON (f.situation_id)
      f.situation_id, f.feedback, f.created_at
    FROM public.financial_situation_feedback f
    WHERE f.user_id = _user_id
    ORDER BY f.situation_id, f.created_at DESC
  )
  SELECT COALESCE(array_agg(lf.situation_id), '{}'::uuid[])
  FROM last_fb lf
  JOIN public.financial_situations s ON s.id = lf.situation_id
  WHERE lf.created_at > now() - CASE
      -- Risco critico nunca desaparece por muito tempo: descansa poucos dias
      -- apenas quando o usuario disse explicitamente que a leitura nao ajudou.
      WHEN s.severity = 'critical' THEN
        CASE WHEN lf.feedback IN ('not_useful', 'dismiss') THEN interval '3 days' ELSE interval '0 days' END
      WHEN lf.feedback = 'not_useful' THEN interval '30 days'
      WHEN lf.feedback = 'useful' THEN interval '7 days'
      WHEN lf.feedback = 'acted' THEN interval '14 days'
      WHEN lf.feedback = 'dismiss' THEN interval '90 days'
      ELSE interval '7 days'
    END;
$function$;

REVOKE ALL ON FUNCTION public.nino_situation_cooldown_ids(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nino_situation_cooldown_ids(uuid) TO service_role;