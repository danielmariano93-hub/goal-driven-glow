
CREATE TABLE IF NOT EXISTS public.admin_grants_audit (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  granted_by text NOT NULL,
  notes text,
  granted_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.admin_grants_audit TO authenticated;
GRANT ALL ON public.admin_grants_audit TO service_role;

ALTER TABLE public.admin_grants_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read admin_grants_audit"
  ON public.admin_grants_audit
  FOR SELECT
  TO authenticated
  USING (public.is_current_user_admin());
