CREATE OR REPLACE FUNCTION public.admin_whatsapp_inbound_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last timestamptz;
  v_count_24h integer;
  v_status text;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT max(received_at) INTO v_last FROM public.inbound_messages;
  SELECT count(*)::int INTO v_count_24h
    FROM public.inbound_messages
   WHERE received_at > now() - interval '24 hours';
  IF v_last IS NULL OR v_last < now() - interval '24 hours' THEN
    v_status := 'needs_attention';
  ELSE
    v_status := 'healthy';
  END IF;
  RETURN jsonb_build_object(
    'status', v_status,
    'last_inbound_at', v_last,
    'count_24h', v_count_24h
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_whatsapp_inbound_health() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_whatsapp_inbound_health() TO authenticated;