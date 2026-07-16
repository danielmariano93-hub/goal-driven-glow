
CREATE OR REPLACE FUNCTION public.admin_waha_config_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'vault'
AS $function$
DECLARE
  has_url boolean; has_key boolean; has_secret boolean; sname text; last_updated timestamptz;
  v_role public.platform_role;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'waha.api_url') INTO has_url;
  SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'waha.api_key') INTO has_key;
  SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'waha.webhook_secret') INTO has_secret;
  SELECT decrypted_secret INTO sname FROM vault.decrypted_secrets WHERE name = 'waha.session_name';
  SELECT max(updated_at) INTO last_updated FROM vault.secrets WHERE name LIKE 'waha.%';
  v_role := public.current_platform_admin_role();

  RETURN jsonb_build_object(
    'configured', has_url AND has_key AND has_secret,
    'has_url', has_url,
    'has_api_key', has_key,
    'has_webhook_secret', has_secret,
    'session_name', coalesce(sname, 'default'),
    'updated_at', last_updated,
    'admin_role', v_role,
    'can_manage_config', v_role = 'platform_owner'
  );
END $function$;
