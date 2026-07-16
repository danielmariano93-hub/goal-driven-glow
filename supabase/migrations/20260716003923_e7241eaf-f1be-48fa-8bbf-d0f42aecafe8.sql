
-- =========================================================================
-- 1. Platform admin role model
-- =========================================================================

DO $$ BEGIN
  CREATE TYPE public.platform_role AS ENUM ('platform_owner','platform_admin','support','analyst');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.platform_role NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.platform_admins TO authenticated;
GRANT ALL ON public.platform_admins TO service_role;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.platform_admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  target_user_id uuid,
  action text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.platform_admin_audit TO authenticated;
GRANT ALL ON public.platform_admin_audit TO service_role;
ALTER TABLE public.platform_admin_audit ENABLE ROW LEVEL SECURITY;

-- Function to check current user is a platform admin (any active role)
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = auth.uid() AND active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.current_platform_admin_role()
RETURNS public.platform_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM public.platform_admins
  WHERE user_id = auth.uid() AND active = true
  LIMIT 1;
$$;

-- Policies: only platform admins can read the table; writes only via RPC (service definer).
DROP POLICY IF EXISTS "platform_admins_read" ON public.platform_admins;
CREATE POLICY "platform_admins_read" ON public.platform_admins
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS "platform_admin_audit_read" ON public.platform_admin_audit;
CREATE POLICY "platform_admin_audit_read" ON public.platform_admin_audit
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_platform_admins_updated_at ON public.platform_admins;
CREATE TRIGGER trg_platform_admins_updated_at
  BEFORE UPDATE ON public.platform_admins
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Grant / revoke RPCs (owner only)
CREATE OR REPLACE FUNCTION public.grant_platform_admin(_target uuid, _role public.platform_role)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF public.current_platform_admin_role() <> 'platform_owner' THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF _target IS NULL THEN RAISE EXCEPTION 'invalid_target'; END IF;
  INSERT INTO public.platform_admins(user_id, role, active, created_by)
    VALUES (_target, _role, true, auth.uid())
    ON CONFLICT (user_id) DO UPDATE
      SET role = EXCLUDED.role, active = true, updated_at = now();
  INSERT INTO public.platform_admin_audit(actor_user_id, target_user_id, action, meta)
    VALUES (auth.uid(), _target, 'grant', jsonb_build_object('role', _role));
END $$;

CREATE OR REPLACE FUNCTION public.revoke_platform_admin(_target uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE owner_count int;
BEGIN
  IF public.current_platform_admin_role() <> 'platform_owner' THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF _target = auth.uid() THEN RAISE EXCEPTION 'cannot_revoke_self'; END IF;
  -- prevent removing last owner
  SELECT count(*) INTO owner_count FROM public.platform_admins
    WHERE role = 'platform_owner' AND active = true AND user_id <> _target;
  IF owner_count = 0 AND EXISTS (
    SELECT 1 FROM public.platform_admins
      WHERE user_id = _target AND role = 'platform_owner' AND active = true
  ) THEN
    RAISE EXCEPTION 'cannot_remove_last_owner';
  END IF;
  UPDATE public.platform_admins SET active = false, updated_at = now()
    WHERE user_id = _target;
  INSERT INTO public.platform_admin_audit(actor_user_id, target_user_id, action)
    VALUES (auth.uid(), _target, 'revoke');
END $$;

REVOKE ALL ON FUNCTION public.grant_platform_admin(uuid, public.platform_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_platform_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_platform_admin(uuid, public.platform_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_platform_admin(uuid) TO authenticated;

-- Update legacy compatibility helper
CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = auth.uid() AND active = true
      AND role IN ('platform_owner','platform_admin')
  );
$$;

-- =========================================================================
-- 2. Migrate existing admins (from user_roles) to platform_admins as owner
--    and strip financial 'user' role from platform admins.
-- =========================================================================

INSERT INTO public.platform_admins (user_id, role, active, created_by)
SELECT ur.user_id, 'platform_owner'::public.platform_role, true, ur.user_id
FROM public.user_roles ur
WHERE ur.role = 'admin'
ON CONFLICT (user_id) DO NOTHING;

-- Founder by email (idempotent)
DO $$
DECLARE uid uuid;
BEGIN
  SELECT id INTO uid FROM auth.users WHERE lower(email) = 'daniel.assis@nocontrole.com.br' LIMIT 1;
  IF uid IS NOT NULL THEN
    INSERT INTO public.platform_admins(user_id, role, active, created_by)
      VALUES (uid, 'platform_owner', true, uid)
      ON CONFLICT (user_id) DO UPDATE
        SET role = 'platform_owner', active = true, updated_at = now();
    -- founder is not a financial user
    DELETE FROM public.user_roles WHERE user_id = uid AND role = 'user';
    INSERT INTO public.platform_admin_audit(actor_user_id, target_user_id, action, meta)
      VALUES (uid, uid, 'bootstrap', jsonb_build_object('reason','migration'));
  END IF;
END $$;

-- Drop the financial 'user' role from every platform admin (founder policy)
DELETE FROM public.user_roles ur
USING public.platform_admins pa
WHERE ur.user_id = pa.user_id AND ur.role = 'user' AND pa.active = true;

-- =========================================================================
-- 3. Admin RPCs for the platform experience
-- =========================================================================

CREATE OR REPLACE FUNCTION public.admin_users_list(p_search text DEFAULT NULL, p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS TABLE (
  user_id uuid,
  email text,
  display_name text,
  created_at timestamptz,
  onboarding_completed_at timestamptz,
  last_sign_in_at timestamptz,
  whatsapp_linked boolean,
  is_platform_admin boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    u.id,
    u.email::text,
    p.display_name,
    u.created_at,
    p.onboarding_completed_at,
    u.last_sign_in_at,
    EXISTS(SELECT 1 FROM public.whatsapp_links wl WHERE wl.user_id = u.id AND wl.status = 'active'),
    EXISTS(SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = u.id AND pa.active = true)
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE public.is_platform_admin()
    AND (p_search IS NULL OR p_search = ''
         OR u.email ILIKE '%' || p_search || '%'
         OR coalesce(p.display_name,'') ILIKE '%' || p_search || '%')
  ORDER BY u.created_at DESC
  LIMIT LEAST(coalesce(p_limit, 50), 200)
  OFFSET GREATEST(coalesce(p_offset, 0), 0);
$$;

REVOKE ALL ON FUNCTION public.admin_users_list(text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_users_list(text, int, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_engagement_stats()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE res jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT jsonb_build_object(
    'dau', (SELECT count(DISTINCT user_id) FROM public.transactions WHERE created_at > now() - interval '1 day'),
    'wau', (SELECT count(DISTINCT user_id) FROM public.transactions WHERE created_at > now() - interval '7 days'),
    'mau', (SELECT count(DISTINCT user_id) FROM public.transactions WHERE created_at > now() - interval '30 days'),
    'activation_first_transaction', (SELECT count(DISTINCT user_id) FROM public.transactions),
    'activation_first_goal', (SELECT count(DISTINCT user_id) FROM public.goals),
    'activation_whatsapp', (SELECT count(*) FROM public.whatsapp_links WHERE status = 'active'),
    'total_splits', (SELECT count(*) FROM public.shared_expenses),
    'total_recurring_rules', (SELECT count(*) FROM public.recurring_rules),
    'total_challenges_joined', (SELECT count(*) FROM public.user_challenges)
  ) INTO res;
  RETURN res;
END $$;

REVOKE ALL ON FUNCTION public.admin_engagement_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_engagement_stats() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_agent_stats()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE res jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT jsonb_build_object(
    'runs_total', (SELECT count(*) FROM public.agent_runs),
    'runs_7d', (SELECT count(*) FROM public.agent_runs WHERE created_at > now() - interval '7 days'),
    'runs_failed_7d', (SELECT count(*) FROM public.agent_runs WHERE created_at > now() - interval '7 days' AND status = 'error'),
    'tokens_7d', (SELECT coalesce(sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)),0) FROM public.agent_runs WHERE created_at > now() - interval '7 days'),
    'cost_usd_7d', (SELECT coalesce(sum(coalesce(cost_usd,0)),0) FROM public.agent_runs WHERE created_at > now() - interval '7 days')
  ) INTO res;
  RETURN res;
END $$;

REVOKE ALL ON FUNCTION public.admin_agent_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_agent_stats() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_ops_health()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE res jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT jsonb_build_object(
    'outbox_queued', (SELECT count(*) FROM public.outbound_messages WHERE status = 'queued'),
    'outbox_processing', (SELECT count(*) FROM public.outbound_messages WHERE status = 'processing'),
    'outbox_failed', (SELECT count(*) FROM public.outbound_messages WHERE status = 'failed'),
    'outbox_dead', (SELECT count(*) FROM public.outbound_messages WHERE status = 'dead'),
    'reminders_queued', (SELECT count(*) FROM public.reminder_jobs WHERE status = 'queued'),
    'reminders_failed', (SELECT count(*) FROM public.reminder_jobs WHERE status = 'failed'),
    'imports_recent', (SELECT count(*) FROM public.import_batches WHERE created_at > now() - interval '7 days'),
    'deletion_pending', (SELECT count(*) FROM public.account_deletion_requests WHERE status IN ('pending','approved'))
  ) INTO res;
  RETURN res;
END $$;

REVOKE ALL ON FUNCTION public.admin_ops_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ops_health() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_platform_admins()
RETURNS TABLE (
  user_id uuid,
  email text,
  display_name text,
  role public.platform_role,
  active boolean,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT pa.user_id, u.email::text, p.display_name, pa.role, pa.active, pa.created_at
  FROM public.platform_admins pa
  JOIN auth.users u ON u.id = pa.user_id
  LEFT JOIN public.profiles p ON p.id = pa.user_id
  WHERE public.is_platform_admin()
  ORDER BY pa.created_at ASC;
$$;

REVOKE ALL ON FUNCTION public.admin_list_platform_admins() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_platform_admins() TO authenticated;

-- =========================================================================
-- 4. Company (business) finances
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.company_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'operational',
  opening_balance numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'BRL',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_accounts TO authenticated;
GRANT ALL ON public.company_accounts TO service_role;
ALTER TABLE public.company_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_accounts_admin" ON public.company_accounts;
CREATE POLICY "company_accounts_admin" ON public.company_accounts
  FOR ALL TO authenticated
  USING (public.current_platform_admin_role() IN ('platform_owner','platform_admin'))
  WITH CHECK (public.current_platform_admin_role() IN ('platform_owner','platform_admin'));
DROP TRIGGER IF EXISTS trg_company_accounts_updated_at ON public.company_accounts;
CREATE TRIGGER trg_company_accounts_updated_at BEFORE UPDATE ON public.company_accounts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.company_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('revenue','expense','infrastructure','marketing','tax','other')),
  color text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_categories TO authenticated;
GRANT ALL ON public.company_categories TO service_role;
ALTER TABLE public.company_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_categories_admin" ON public.company_categories;
CREATE POLICY "company_categories_admin" ON public.company_categories
  FOR ALL TO authenticated
  USING (public.current_platform_admin_role() IN ('platform_owner','platform_admin'))
  WITH CHECK (public.current_platform_admin_role() IN ('platform_owner','platform_admin'));
DROP TRIGGER IF EXISTS trg_company_categories_updated_at ON public.company_categories;
CREATE TRIGGER trg_company_categories_updated_at BEFORE UPDATE ON public.company_categories
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.company_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  document text,
  contact text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_vendors TO authenticated;
GRANT ALL ON public.company_vendors TO service_role;
ALTER TABLE public.company_vendors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_vendors_admin" ON public.company_vendors;
CREATE POLICY "company_vendors_admin" ON public.company_vendors
  FOR ALL TO authenticated
  USING (public.current_platform_admin_role() IN ('platform_owner','platform_admin'))
  WITH CHECK (public.current_platform_admin_role() IN ('platform_owner','platform_admin'));
DROP TRIGGER IF EXISTS trg_company_vendors_updated_at ON public.company_vendors;
CREATE TRIGGER trg_company_vendors_updated_at BEFORE UPDATE ON public.company_vendors
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.company_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES public.company_accounts(id) ON DELETE SET NULL,
  category_id uuid REFERENCES public.company_categories(id) ON DELETE SET NULL,
  vendor_id uuid REFERENCES public.company_vendors(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('income','expense')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  occurred_at date NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_transactions TO authenticated;
GRANT ALL ON public.company_transactions TO service_role;
ALTER TABLE public.company_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_tx_admin" ON public.company_transactions;
CREATE POLICY "company_tx_admin" ON public.company_transactions
  FOR ALL TO authenticated
  USING (public.current_platform_admin_role() IN ('platform_owner','platform_admin'))
  WITH CHECK (public.current_platform_admin_role() IN ('platform_owner','platform_admin'));
DROP TRIGGER IF EXISTS trg_company_tx_updated_at ON public.company_transactions;
CREATE TRIGGER trg_company_tx_updated_at BEFORE UPDATE ON public.company_transactions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX IF NOT EXISTS idx_company_tx_occurred_at ON public.company_transactions(occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.company_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES public.company_categories(id) ON DELETE CASCADE,
  month date NOT NULL,
  planned_amount numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(category_id, month)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_budgets TO authenticated;
GRANT ALL ON public.company_budgets TO service_role;
ALTER TABLE public.company_budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_budgets_admin" ON public.company_budgets;
CREATE POLICY "company_budgets_admin" ON public.company_budgets
  FOR ALL TO authenticated
  USING (public.current_platform_admin_role() IN ('platform_owner','platform_admin'))
  WITH CHECK (public.current_platform_admin_role() IN ('platform_owner','platform_admin'));
DROP TRIGGER IF EXISTS trg_company_budgets_updated_at ON public.company_budgets;
CREATE TRIGGER trg_company_budgets_updated_at BEFORE UPDATE ON public.company_budgets
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
