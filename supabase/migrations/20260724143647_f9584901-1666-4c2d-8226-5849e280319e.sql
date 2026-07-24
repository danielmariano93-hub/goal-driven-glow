-- =========================================================
-- M1 — Ações canônicas em platform_permissions
-- =========================================================

-- 1.1 Novas ações: whatsapp.read (monitoramento sem PII)
INSERT INTO public.platform_permissions (role, action, allowed) VALUES
  ('platform_owner', 'whatsapp.read', true),
  ('platform_admin', 'whatsapp.read', true),
  ('support',        'whatsapp.read', true),
  ('analyst',        'whatsapp.read', true)
ON CONFLICT (role, action) DO UPDATE SET allowed = EXCLUDED.allowed;

-- 1.2 Identidade de clientes (completa, auditada)
INSERT INTO public.platform_permissions (role, action, allowed) VALUES
  ('platform_owner', 'clients.identity.read', true),
  ('platform_admin', 'clients.identity.read', true),
  ('support',        'clients.identity.read', false),
  ('analyst',        'clients.identity.read', false)
ON CONFLICT (role, action) DO UPDATE SET allowed = EXCLUDED.allowed;

-- 1.3 Identidade mascarada (support default)
INSERT INTO public.platform_permissions (role, action, allowed) VALUES
  ('platform_owner', 'clients.identity.masked', true),
  ('platform_admin', 'clients.identity.masked', true),
  ('support',        'clients.identity.masked', true),
  ('analyst',        'clients.identity.masked', false)
ON CONFLICT (role, action) DO UPDATE SET allowed = EXCLUDED.allowed;

-- 1.4 Deprecar ações antigas (janela de compat)
UPDATE public.platform_permissions
   SET allowed = false
 WHERE action IN ('overview.read', 'product.read', 'users.read');

-- =========================================================
-- M2 — Renomear gates dos RPCs quebrados
-- =========================================================

CREATE OR REPLACE FUNCTION public.admin_v2_operations_health(_hours integer DEFAULT 24)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cutoff timestamptz := now() - make_interval(hours => _hours);
BEGIN
  PERFORM public._require_perm('operations.read');
  RETURN jsonb_build_object(
    'services', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'job_key', job_key,
        'last_ok', last_ok,
        'last_run_at', last_run_at,
        'next_run_at', next_run_at,
        'processed', processed,
        'failed', failed,
        'last_error_code', last_error_code
      ) ORDER BY job_key), '[]'::jsonb)
      FROM public.job_heartbeats
    ),
    'agent_runs', (
      SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      FROM (
        SELECT
          COUNT(*)::int AS runs,
          SUM(CASE WHEN status='done' THEN 1 ELSE 0 END)::int AS runs_ok,
          SUM(CASE WHEN status='error' THEN 1 ELSE 0 END)::int AS runs_error,
          COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (finished_at - started_at))*1000), 0)::int AS p50_ms,
          COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (finished_at - started_at))*1000), 0)::int AS p95_ms
        FROM public.agent_runs
        WHERE started_at >= cutoff
      ) x
    ),
    'formula_version', 'ops.v2',
    'timezone', 'America/Sao_Paulo',
    'measurement_started_at', cutoff
  );
END; $$;

CREATE OR REPLACE FUNCTION public.admin_v2_ia_ocr_metrics(_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
        cutoff date := today - _days;
BEGIN
  PERFORM public._require_perm('operations.read');
  RETURN jsonb_build_object(
    'totals', (
      SELECT jsonb_build_object(
        'uploaded', COUNT(*)::int,
        'confirmed', SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END)::int,
        'partially_confirmed', SUM(CASE WHEN status='partially_confirmed' THEN 1 ELSE 0 END)::int,
        'partial', SUM(CASE WHEN status='partial' THEN 1 ELSE 0 END)::int,
        'failed', SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END)::int,
        'canceled', SUM(CASE WHEN status='canceled' THEN 1 ELSE 0 END)::int
      )
      FROM public.document_imports
      WHERE created_at >= cutoff
    ),
    'daily', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'day', d,
        'confirmed', confirmed,
        'partial', partial,
        'failed', failed
      ) ORDER BY d), '[]'::jsonb)
      FROM (
        SELECT date_trunc('day', created_at AT TIME ZONE 'America/Sao_Paulo')::date AS d,
          SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END)::int AS confirmed,
          SUM(CASE WHEN status IN ('partial','partially_confirmed') THEN 1 ELSE 0 END)::int AS partial,
          SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END)::int AS failed
        FROM public.document_imports
        WHERE created_at >= cutoff
        GROUP BY 1
      ) y
    ),
    'formula_version', 'ocr.v2',
    'timezone', 'America/Sao_Paulo',
    'source_kind', 'realtime'
  );
END; $$;

CREATE OR REPLACE FUNCTION public.admin_v2_whatsapp_monitor(_days integer DEFAULT 7)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cutoff timestamptz := now() - make_interval(days => _days);
        _receipts_available boolean;
BEGIN
  PERFORM public._require_perm('whatsapp.read');
  SELECT COUNT(*) > 0 INTO _receipts_available
  FROM public.outbound_messages
  WHERE created_at >= cutoff
    AND provider='waha'
    AND delivered_at IS NOT NULL;

  RETURN jsonb_build_object(
    'receipts_available', COALESCE(_receipts_available, false),
    'last_inbound_at', (SELECT MAX(created_at) FROM public.inbound_messages),
    'last_outbound_at', (SELECT MAX(created_at) FROM public.outbound_messages WHERE provider='waha'),
    'totals', (
      SELECT jsonb_build_object(
        'attempts', COUNT(*)::int,
        'sent', SUM(CASE WHEN status IN ('sent','delivered','read') THEN 1 ELSE 0 END)::int,
        'delivered', SUM(CASE WHEN delivered_at IS NOT NULL THEN 1 ELSE 0 END)::int,
        'read', SUM(CASE WHEN read_at IS NOT NULL THEN 1 ELSE 0 END)::int,
        'failed', SUM(CASE WHEN status IN ('failed','dead') THEN 1 ELSE 0 END)::int
      )
      FROM public.outbound_messages
      WHERE created_at >= cutoff AND provider='waha'
    ),
    'daily', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'day', d, 'attempts', attempts, 'sent', sent, 'failed', failed
      ) ORDER BY d), '[]'::jsonb)
      FROM (
        SELECT date_trunc('day', created_at AT TIME ZONE 'America/Sao_Paulo')::date AS d,
          COUNT(*)::int AS attempts,
          SUM(CASE WHEN status IN ('sent','delivered','read') THEN 1 ELSE 0 END)::int AS sent,
          SUM(CASE WHEN status IN ('failed','dead') THEN 1 ELSE 0 END)::int AS failed
        FROM public.outbound_messages
        WHERE created_at >= cutoff AND provider='waha'
        GROUP BY 1
      ) y
    ),
    'formula_version', 'whatsapp.v2',
    'timezone', 'America/Sao_Paulo'
  );
END; $$;

-- =========================================================
-- M3 — Hardening EXECUTE em todos os admin_v2_*
-- =========================================================

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'admin_v2_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    BEGIN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig); EXCEPTION WHEN OTHERS THEN NULL; END;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- =========================================================
-- M4 — Clientes: três RPCs separados
-- =========================================================

-- Utilitário: mascarar e-mail
CREATE OR REPLACE FUNCTION public._mask_email(_email text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _email IS NULL OR position('@' in _email) = 0 THEN NULL
    ELSE substr(split_part(_email,'@',1),1,2) || '***@' || split_part(_email,'@',2)
  END;
$$;

CREATE OR REPLACE FUNCTION public._mask_name(_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _name IS NULL OR length(_name) = 0 THEN NULL
    ELSE split_part(_name, ' ', 1) || ' ***'
  END;
$$;

CREATE OR REPLACE FUNCTION public.admin_v2_clients_identity(_pseudo_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid := auth.uid();
BEGIN
  PERFORM public._require_perm('clients.identity.read');
  -- Auditoria (best effort)
  INSERT INTO public.platform_admin_audit(action, actor_admin_id, target_kind, target_id, payload)
  SELECT 'clients.identity.read', _actor, 'profile', p::text,
         jsonb_build_object('count', COALESCE(array_length(_pseudo_ids,1),0))
  FROM unnest(_pseudo_ids) AS p
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'clients', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'pseudo_id', up.pseudo_id,
        'display_name', pr.display_name,
        'email', u.email
      )), '[]'::jsonb)
      FROM public.user_pseudonyms up
      JOIN public.profiles pr ON pr.id = up.user_id
      LEFT JOIN auth.users u ON u.id = up.user_id
      WHERE up.pseudo_id = ANY(_pseudo_ids)
    )
  );
END; $$;

CREATE OR REPLACE FUNCTION public.admin_v2_clients_identity_masked(_pseudo_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._require_perm('clients.identity.masked');
  RETURN jsonb_build_object(
    'clients', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'pseudo_id', up.pseudo_id,
        'display_name', public._mask_name(pr.display_name),
        'email', public._mask_email(u.email)
      )), '[]'::jsonb)
      FROM public.user_pseudonyms up
      JOIN public.profiles pr ON pr.id = up.user_id
      LEFT JOIN auth.users u ON u.id = up.user_id
      WHERE up.pseudo_id = ANY(_pseudo_ids)
    )
  );
END; $$;

REVOKE ALL ON FUNCTION public.admin_v2_clients_identity(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_v2_clients_identity_masked(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_v2_clients_identity(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_v2_clients_identity_masked(uuid[]) TO authenticated, service_role;