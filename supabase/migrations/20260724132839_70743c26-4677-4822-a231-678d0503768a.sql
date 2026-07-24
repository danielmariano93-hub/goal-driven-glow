-- =========================================================================
-- FASE 1 — PRIVACIDADE + RBAC GRANULAR + BREAK-GLASS + REAUTH
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1) platform_permissions: matriz oficial server-side
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_permissions (
  role     public.platform_role NOT NULL,
  action   TEXT NOT NULL,
  allowed  BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role, action)
);

GRANT SELECT ON public.platform_permissions TO authenticated;
GRANT ALL ON public.platform_permissions TO service_role;
ALTER TABLE public.platform_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_permissions_read_admin"
  ON public.platform_permissions FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

-- Seed 22 ações canônicas × 4 papéis (plano §5)
INSERT INTO public.platform_permissions (role, action, allowed) VALUES
  -- overview
  ('platform_owner','overview.read',TRUE),('platform_admin','overview.read',TRUE),('support','overview.read',TRUE),('analyst','overview.read',TRUE),
  -- growth
  ('platform_owner','growth.read',TRUE),('platform_admin','growth.read',TRUE),('support','growth.read',FALSE),('analyst','growth.read',TRUE),
  -- product intelligence
  ('platform_owner','product.read',TRUE),('platform_admin','product.read',TRUE),('support','product.read',FALSE),('analyst','product.read',TRUE),
  -- operations
  ('platform_owner','operations.read',TRUE),('platform_admin','operations.read',TRUE),('support','operations.read',TRUE),('analyst','operations.read',TRUE),
  ('platform_owner','operations.write',TRUE),('platform_admin','operations.write',TRUE),('support','operations.write',FALSE),('analyst','operations.write',FALSE),
  -- messaging (sem PII)
  ('platform_owner','messaging.read',TRUE),('platform_admin','messaging.read',TRUE),('support','messaging.read',TRUE),('analyst','messaging.read',TRUE),
  ('platform_owner','messaging.reprocess',TRUE),('platform_admin','messaging.reprocess',TRUE),('support','messaging.reprocess',FALSE),('analyst','messaging.reprocess',FALSE),
  -- whatsapp critical (config WAHA, restart session)
  ('platform_owner','whatsapp.critical',TRUE),('platform_admin','whatsapp.critical',TRUE),('support','whatsapp.critical',FALSE),('analyst','whatsapp.critical',FALSE),
  -- agent/assistant
  ('platform_owner','agent.read',TRUE),('platform_admin','agent.read',TRUE),('support','agent.read',TRUE),('analyst','agent.read',TRUE),
  ('platform_owner','agent.write',TRUE),('platform_admin','agent.write',TRUE),('support','agent.write',FALSE),('analyst','agent.write',FALSE),
  -- clients (pseudonymized list)
  ('platform_owner','clients.read',TRUE),('platform_admin','clients.read',TRUE),('support','clients.read',TRUE),('analyst','clients.read',FALSE),
  ('platform_owner','users.read',TRUE),('platform_admin','users.read',TRUE),('support','users.read',TRUE),('analyst','users.read',FALSE),
  ('platform_owner','users.suspend',TRUE),('platform_admin','users.suspend',TRUE),('support','users.suspend',TRUE),('analyst','users.suspend',FALSE),
  ('platform_owner','users.process_deletion',TRUE),('platform_admin','users.process_deletion',TRUE),('support','users.process_deletion',FALSE),('analyst','users.process_deletion',FALSE),
  -- revenue
  ('platform_owner','revenue.read',TRUE),('platform_admin','revenue.read',FALSE),('support','revenue.read',FALSE),('analyst','revenue.read',FALSE),
  -- company finance (contabilidade interna)
  ('platform_owner','company_finance.read',TRUE),('platform_admin','company_finance.read',TRUE),('support','company_finance.read',FALSE),('analyst','company_finance.read',TRUE),
  ('platform_owner','company_finance.write',TRUE),('platform_admin','company_finance.write',TRUE),('support','company_finance.write',FALSE),('analyst','company_finance.write',FALSE),
  -- governance / settings
  ('platform_owner','settings.read',TRUE),('platform_admin','settings.read',TRUE),('support','settings.read',FALSE),('analyst','settings.read',FALSE),
  ('platform_owner','settings.critical',TRUE),('platform_admin','settings.critical',FALSE),('support','settings.critical',FALSE),('analyst','settings.critical',FALSE),
  -- security
  ('platform_owner','security.read',TRUE),('platform_admin','security.read',TRUE),('support','security.read',FALSE),('analyst','security.read',FALSE),
  ('platform_owner','security.manage_admins',TRUE),('platform_admin','security.manage_admins',FALSE),('support','security.manage_admins',FALSE),('analyst','security.manage_admins',FALSE),
  -- audit
  ('platform_owner','audit.read',TRUE),('platform_admin','audit.read',TRUE),('support','audit.read',FALSE),('analyst','audit.read',TRUE),
  -- break-glass (só owner)
  ('platform_owner','break_glass.open',TRUE),('platform_admin','break_glass.open',FALSE),('support','break_glass.open',FALSE),('analyst','break_glass.open',FALSE),
  ('platform_owner','break_glass.read',TRUE),('platform_admin','break_glass.read',TRUE),('support','break_glass.read',FALSE),('analyst','break_glass.read',TRUE)
ON CONFLICT (role, action) DO UPDATE SET allowed = EXCLUDED.allowed, updated_at = now();

-- has_platform_permission(action) — server-side gate
CREATE OR REPLACE FUNCTION public.has_platform_permission(_action TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_admins pa
    JOIN public.platform_permissions pp
      ON pp.role = pa.role
     AND pp.action = _action
     AND pp.allowed = TRUE
    WHERE pa.user_id = auth.uid()
      AND pa.active = TRUE
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_platform_permission(TEXT) TO authenticated;

-- current_platform_permissions() — para o FE saber quais ações mostrar
CREATE OR REPLACE FUNCTION public.current_platform_permissions()
RETURNS TABLE(action TEXT, allowed BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT pp.action, pp.allowed
  FROM public.platform_admins pa
  JOIN public.platform_permissions pp ON pp.role = pa.role
  WHERE pa.user_id = auth.uid()
    AND pa.active = TRUE
    AND pp.allowed = TRUE;
$$;

GRANT EXECUTE ON FUNCTION public.current_platform_permissions() TO authenticated;

-- -------------------------------------------------------------------------
-- 2) user_pseudonyms: surrogate UUID por usuário
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_pseudonyms (
  user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE SET NULL,
  pseudo_id   UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  detached_at TIMESTAMPTZ
);

GRANT SELECT ON public.user_pseudonyms TO authenticated;
GRANT ALL ON public.user_pseudonyms TO service_role;
ALTER TABLE public.user_pseudonyms ENABLE ROW LEVEL SECURITY;

-- Só platform admins podem ler o mapeamento; e mesmo assim, o padrão é
-- consultar via funções SECURITY DEFINER que retornam somente pseudo_id.
CREATE POLICY "user_pseudonyms_read_admin"
  ON public.user_pseudonyms FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

-- Backfill inicial: cria pseudônimo para todo usuário existente
INSERT INTO public.user_pseudonyms (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- ensure_pseudonym: cria on-demand
CREATE OR REPLACE FUNCTION public.ensure_pseudonym(_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pseudo UUID;
BEGIN
  IF _user_id IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.user_pseudonyms (user_id)
    VALUES (_user_id)
    ON CONFLICT (user_id) DO NOTHING;
  SELECT pseudo_id INTO v_pseudo FROM public.user_pseudonyms WHERE user_id = _user_id;
  RETURN v_pseudo;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_pseudonym(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_pseudonym(UUID) TO service_role;

-- Trigger: cria pseudônimo automaticamente quando novo usuário nasce
CREATE OR REPLACE FUNCTION public.trg_new_user_pseudonym()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_pseudonyms (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_pseudonym ON auth.users;
CREATE TRIGGER on_auth_user_created_pseudonym
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.trg_new_user_pseudonym();

-- -------------------------------------------------------------------------
-- 3) admin_reauth_events: janela de reautenticação recente
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_reauth_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  method      TEXT NOT NULL CHECK (method IN ('password','otp','magic_link')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_reauth_events_admin_time
  ON public.admin_reauth_events (admin_id, created_at DESC);

GRANT SELECT, INSERT ON public.admin_reauth_events TO authenticated;
GRANT ALL ON public.admin_reauth_events TO service_role;
ALTER TABLE public.admin_reauth_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_reauth_self_insert"
  ON public.admin_reauth_events FOR INSERT
  TO authenticated
  WITH CHECK (admin_id = auth.uid() AND public.is_platform_admin());

CREATE POLICY "admin_reauth_self_read"
  ON public.admin_reauth_events FOR SELECT
  TO authenticated
  USING (admin_id = auth.uid() AND public.is_platform_admin());

CREATE OR REPLACE FUNCTION public.require_recent_reauth(_max_age_seconds INT DEFAULT 300)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_reauth_events
    WHERE admin_id = auth.uid()
      AND created_at > now() - make_interval(secs => _max_age_seconds)
  );
$$;

GRANT EXECUTE ON FUNCTION public.require_recent_reauth(INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_admin_reauth(_method TEXT DEFAULT 'password')
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.admin_reauth_events (admin_id, method)
    VALUES (auth.uid(), _method)
    RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_admin_reauth(TEXT) TO authenticated;

-- -------------------------------------------------------------------------
-- 4) break_glass_sessions: acesso excepcional a PII
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.break_glass_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  pseudo_id      UUID NOT NULL REFERENCES public.user_pseudonyms(pseudo_id) ON DELETE RESTRICT,
  fields         TEXT[] NOT NULL,
  reason         TEXT NOT NULL,
  ticket_ref     TEXT NOT NULL,
  opened_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  closed_at      TIMESTAMPTZ,
  closed_reason  TEXT,
  reads_count    INT NOT NULL DEFAULT 0,
  CONSTRAINT bg_reason_len CHECK (char_length(reason) >= 20),
  CONSTRAINT bg_ticket_len CHECK (char_length(ticket_ref) >= 3)
);

CREATE INDEX IF NOT EXISTS idx_break_glass_active
  ON public.break_glass_sessions (admin_id, expires_at)
  WHERE closed_at IS NULL;

GRANT SELECT ON public.break_glass_sessions TO authenticated;
GRANT ALL ON public.break_glass_sessions TO service_role;
ALTER TABLE public.break_glass_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "break_glass_read_admin"
  ON public.break_glass_sessions FOR SELECT
  TO authenticated
  USING (public.has_platform_permission('break_glass.read'));

-- Allowlist de campos que podem ser abertos
CREATE OR REPLACE FUNCTION public._break_glass_allowed_fields()
RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['email','display_name','phone','whatsapp','last_message_preview','last_message_body']::TEXT[]
$$;

CREATE OR REPLACE FUNCTION public.admin_open_break_glass(
  _pseudo_id UUID, _fields TEXT[], _reason TEXT, _ticket_ref TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_bad TEXT;
BEGIN
  IF NOT public.has_platform_permission('break_glass.open') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT public.require_recent_reauth(300) THEN
    RAISE EXCEPTION 'reauth_required' USING ERRCODE = '42501';
  END IF;
  IF _fields IS NULL OR array_length(_fields, 1) IS NULL THEN
    RAISE EXCEPTION 'fields_required';
  END IF;
  SELECT f INTO v_bad
    FROM unnest(_fields) f
   WHERE f <> ALL (public._break_glass_allowed_fields())
   LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'field_not_allowed: %', v_bad;
  END IF;

  INSERT INTO public.break_glass_sessions
    (admin_id, pseudo_id, fields, reason, ticket_ref, expires_at)
  VALUES
    (auth.uid(), _pseudo_id, _fields, _reason, _ticket_ref, now() + INTERVAL '15 minutes')
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_open_break_glass(UUID, TEXT[], TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_close_break_glass(_id UUID, _reason TEXT DEFAULT 'manual')
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.break_glass_sessions
     SET closed_at = now(), closed_reason = _reason
   WHERE id = _id AND (admin_id = auth.uid() OR public.has_platform_permission('security.manage_admins'))
     AND closed_at IS NULL;
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_close_break_glass(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_active_break_glass()
RETURNS SETOF public.break_glass_sessions
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM public.break_glass_sessions
   WHERE closed_at IS NULL
     AND expires_at > now()
     AND (public.has_platform_permission('break_glass.read'))
   ORDER BY opened_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.admin_active_break_glass() TO authenticated;
