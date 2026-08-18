-- financial_truth_single_source.v1
-- A detecção financeira de meta passa a ser responsabilidade exclusiva do
-- snapshot canônico no runtime. A função SQL permanece como ponte compatível,
-- mas deixa de calcular ou persistir números paralelos.
CREATE OR REPLACE FUNCTION public.nino_diag_detect_category_goal_alerts(
  _user_id uuid,
  _as_of date DEFAULT current_date,
  _run_mode text DEFAULT 'live',
  _run_id uuid DEFAULT null
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN 0;
END;
$$;

REVOKE ALL ON FUNCTION public.nino_diag_detect_category_goal_alerts(uuid,date,text,uuid)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nino_diag_detect_category_goal_alerts(uuid,date,text,uuid)
  TO service_role;