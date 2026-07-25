-- =========================================================================
-- Onda A: Lockdown do universo de clientes + disambiguação do cockpit
-- ROLLBACK:
--   GRANT SELECT ON public.v_client_users, public.v_client_pseudonyms TO authenticated;
--   GRANT EXECUTE ON FUNCTION public.is_client_user(uuid) TO authenticated;
--   -- Recriar admin_v2_cockpit() legada a partir do dump histórico se necessário.
-- =========================================================================

-- M1: Lockdown das views internas e da função de universo
REVOKE ALL ON public.v_client_users FROM PUBLIC;
REVOKE ALL ON public.v_client_users FROM anon;
REVOKE ALL ON public.v_client_users FROM authenticated;

REVOKE ALL ON public.v_client_pseudonyms FROM PUBLIC;
REVOKE ALL ON public.v_client_pseudonyms FROM anon;
REVOKE ALL ON public.v_client_pseudonyms FROM authenticated;

GRANT SELECT ON public.v_client_users TO service_role;
GRANT SELECT ON public.v_client_pseudonyms TO service_role;

REVOKE ALL ON FUNCTION public.is_client_user(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_client_user(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.is_client_user(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.is_client_user(uuid) TO service_role;

-- M2: Remover overload sem argumentos de admin_v2_cockpit
DROP FUNCTION IF EXISTS public.admin_v2_cockpit();