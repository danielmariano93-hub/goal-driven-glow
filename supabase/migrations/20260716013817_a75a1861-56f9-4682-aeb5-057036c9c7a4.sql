
-- ============================================================
-- WAHA credentials stored in Supabase Vault (never in a public table).
-- Only platform_owner can save/replace; service_role can resolve.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.admin_action_rate (
  actor_id uuid NOT NULL,
  action text NOT NULL,
  window_start timestamptz NOT NULL DEFAULT date_trunc('minute', now()),
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (actor_id, action, window_start)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_action_rate TO authenticated;
GRANT ALL ON public.admin_action_rate TO service_role;
ALTER TABLE public.admin_action_rate ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_action_rate_admin_all"
  ON public.admin_action_rate FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- Helper: upsert a vault secret idempotently by name.
CREATE OR REPLACE FUNCTION public._vault_upsert(p_name text, p_value text, p_description text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault
AS $$
DECLARE existing_id uuid;
BEGIN
  SELECT id INTO existing_id FROM vault.secrets WHERE name = p_name;
  IF existing_id IS NULL THEN
    RETURN vault.create_secret(p_value, p_name, coalesce(p_description, ''));
  ELSE
    PERFORM vault.update_secret(existing_id, p_value, p_name, coalesce(p_description, ''));
    RETURN existing_id;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public._vault_upsert(text, text, text) FROM PUBLIC, anon, authenticated;

-- Status (safe for admins): boolean presence and last update, never the values.
CREATE OR REPLACE FUNCTION public.admin_waha_config_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, vault
AS $$
DECLARE
  has_url boolean; has_key boolean; has_secret boolean; sname text; last_updated timestamptz;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'waha.api_url') INTO has_url;
  SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'waha.api_key') INTO has_key;
  SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'waha.webhook_secret') INTO has_secret;
  SELECT decrypted_secret INTO sname FROM vault.decrypted_secrets WHERE name = 'waha.session_name';
  SELECT max(updated_at) INTO last_updated FROM vault.secrets WHERE name LIKE 'waha.%';

  RETURN jsonb_build_object(
    'configured', has_url AND has_key AND has_secret,
    'has_url', has_url,
    'has_api_key', has_key,
    'has_webhook_secret', has_secret,
    'session_name', coalesce(sname, 'default'),
    'updated_at', last_updated
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_waha_config_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_waha_config_status() TO authenticated;

-- Save/replace credentials. Owner only. Generates webhook secret if omitted.
-- Values are validated (length + shape) but never logged or returned.
CREATE OR REPLACE FUNCTION public.admin_waha_save_config(
  p_url text,
  p_api_key text,
  p_webhook_secret text DEFAULT NULL,
  p_session_name text DEFAULT 'default'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault
AS $$
DECLARE ws text;
BEGIN
  IF public.current_platform_admin_role() <> 'platform_owner' THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_url IS NULL OR p_url !~* '^https://' THEN RAISE EXCEPTION 'invalid_url'; END IF;
  IF length(p_url) > 500 THEN RAISE EXCEPTION 'invalid_url'; END IF;
  IF p_api_key IS NULL OR length(btrim(p_api_key)) < 4 OR length(p_api_key) > 500 THEN
    RAISE EXCEPTION 'invalid_api_key';
  END IF;
  IF p_session_name IS NULL OR p_session_name !~ '^[a-zA-Z0-9_-]{1,32}$' THEN
    RAISE EXCEPTION 'invalid_session_name';
  END IF;

  ws := coalesce(nullif(btrim(coalesce(p_webhook_secret, '')), ''),
                 encode(gen_random_bytes(32), 'hex'));

  PERFORM public._vault_upsert('waha.api_url',        btrim(p_url),      'WAHA manager base URL');
  PERFORM public._vault_upsert('waha.api_key',        btrim(p_api_key),  'WAHA API key (X-Api-Key)');
  PERFORM public._vault_upsert('waha.webhook_secret', ws,                'Shared secret used to verify inbound webhooks');
  PERFORM public._vault_upsert('waha.session_name',   p_session_name,    'WAHA session name');

  INSERT INTO public.platform_admin_audit(actor_user_id, action, meta)
    VALUES (auth.uid(), 'waha_config_saved',
      jsonb_build_object('session_name', p_session_name, 'has_webhook_secret', p_webhook_secret IS NULL));

  RETURN public.admin_waha_config_status();
END $$;

REVOKE ALL ON FUNCTION public.admin_waha_save_config(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_waha_save_config(text, text, text, text) TO authenticated;

-- Server-only resolver. Only service_role in edge functions may call this.
CREATE OR REPLACE FUNCTION public.admin_waha_resolve_config()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, vault
AS $$
DECLARE res jsonb;
BEGIN
  SELECT jsonb_build_object(
    'api_url',        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'waha.api_url'),
    'api_key',        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'waha.api_key'),
    'webhook_secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'waha.webhook_secret'),
    'session_name',   COALESCE((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'waha.session_name'), 'default')
  ) INTO res;
  RETURN res;
END $$;

REVOKE ALL ON FUNCTION public.admin_waha_resolve_config() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_waha_resolve_config() TO service_role;

-- Rate limit helper (10/min per admin per action).
CREATE OR REPLACE FUNCTION public.admin_rate_check(p_action text, p_limit integer DEFAULT 10)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE uid uuid := auth.uid(); c int;
BEGIN
  IF uid IS NULL OR NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  INSERT INTO public.admin_action_rate(actor_id, action, window_start, count)
    VALUES (uid, p_action, date_trunc('minute', now()), 1)
    ON CONFLICT (actor_id, action, window_start)
    DO UPDATE SET count = admin_action_rate.count + 1
    RETURNING count INTO c;
  DELETE FROM public.admin_action_rate WHERE window_start < now() - interval '1 hour';
  RETURN c <= p_limit;
END $$;
REVOKE ALL ON FUNCTION public.admin_rate_check(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_rate_check(text, integer) TO authenticated;
