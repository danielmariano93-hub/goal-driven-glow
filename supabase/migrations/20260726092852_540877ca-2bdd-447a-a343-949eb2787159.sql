
CREATE OR REPLACE FUNCTION public.notifications_mark_interacted(
  _notification_id uuid,
  _action text DEFAULT 'open'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_notif public.notifications%ROWTYPE;
  v_new_status text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF _action NOT IN ('open','click','dismiss') THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_notif FROM public.notifications
   WHERE id = _notification_id AND user_id = v_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'notification_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Marca leitura no app (idempotente).
  UPDATE public.notifications
     SET read_at = COALESCE(read_at, now())
   WHERE id = v_notif.id;

  v_new_status := CASE WHEN _action = 'dismiss' THEN 'dismissed' ELSE 'acted' END;

  -- Espelha no communication_deliveries mais recente com o mesmo dedup_key.
  -- Não sobrescreve status terminais como 'failed'.
  UPDATE public.communication_deliveries cd
     SET status   = v_new_status,
         acted_at = COALESCE(cd.acted_at, now()),
         evidence = COALESCE(cd.evidence, '{}'::jsonb)
                    || jsonb_build_object('feedback', jsonb_build_object(
                         'action', _action, 'at', now(), 'notification_id', v_notif.id))
   WHERE cd.user_id = v_user
     AND cd.dedup_key = v_notif.dedup_key
     AND cd.status NOT IN ('failed');

  RETURN jsonb_build_object(
    'ok', true,
    'notification_id', v_notif.id,
    'action', _action,
    'reflected', v_new_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.notifications_mark_interacted(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.notifications_mark_interacted(uuid, text) TO authenticated;
