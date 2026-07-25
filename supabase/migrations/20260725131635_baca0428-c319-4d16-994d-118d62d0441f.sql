
-- 1) Função canônica: usuário é cliente?
CREATE OR REPLACE FUNCTION public.is_client_user(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.platform_admins pa
      WHERE pa.user_id = _user_id AND pa.active = true
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = _user_id AND ur.role = 'admin'
    );
$$;

REVOKE ALL ON FUNCTION public.is_client_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_client_user(uuid) TO authenticated, service_role;

-- 2) View: clientes reais (exclui admins)
DROP VIEW IF EXISTS public.v_client_users CASCADE;
CREATE VIEW public.v_client_users
WITH (security_invoker = true)
AS
SELECT
  u.id           AS user_id,
  up.pseudo_id   AS pseudo_id,
  u.created_at   AS registered_at,
  p.onboarding_completed_at
FROM auth.users u
LEFT JOIN public.user_pseudonyms up ON up.user_id = u.id
LEFT JOIN public.profiles p         ON p.id = u.id
WHERE public.is_client_user(u.id);

GRANT SELECT ON public.v_client_users TO authenticated, service_role;

-- 3) View auxiliar: apenas pseudo_ids de clientes
DROP VIEW IF EXISTS public.v_client_pseudonyms CASCADE;
CREATE VIEW public.v_client_pseudonyms
WITH (security_invoker = true)
AS
SELECT up.pseudo_id, up.user_id
FROM public.user_pseudonyms up
WHERE public.is_client_user(up.user_id);

GRANT SELECT ON public.v_client_pseudonyms TO authenticated, service_role;

COMMENT ON FUNCTION public.is_client_user(uuid) IS
  'Universo canônico de clientes do produto: exclui platform_admins ativos e user_roles.role=admin. Usar em todas as métricas admin_v2_*.';
COMMENT ON VIEW public.v_client_users IS
  'Clientes reais do produto Meu Nino.IA. Fonte única para métricas de produto no Admin.';
COMMENT ON VIEW public.v_client_pseudonyms IS
  'Pseudo_ids de clientes reais. Usar para filtrar product_events e agregados pseudonimizados.';
