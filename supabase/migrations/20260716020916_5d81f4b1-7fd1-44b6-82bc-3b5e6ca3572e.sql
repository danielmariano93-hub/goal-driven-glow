
-- Update RPC defaults from 'default' to 'nocontrole' for the NoControle channel.
CREATE OR REPLACE FUNCTION public.admin_waha_save_config(
  p_url text,
  p_api_key text,
  p_webhook_secret text DEFAULT NULL,
  p_session_name text DEFAULT 'nocontrole'
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
    'session_name',   COALESCE((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'waha.session_name'), 'nocontrole')
  ) INTO res;
  RETURN res;
END $$;

REVOKE ALL ON FUNCTION public.admin_waha_resolve_config() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_waha_resolve_config() TO service_role;

-- Migrate the stored session name in the Vault to the canonical value.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'waha.api_url') THEN
    PERFORM public._vault_upsert('waha.session_name', 'nocontrole', 'WAHA session name');
  END IF;
END $$;
