
-- =========================================================================
-- 1) Extensão de outbound_messages: surface + feature
-- =========================================================================
ALTER TABLE public.outbound_messages
  ADD COLUMN IF NOT EXISTS surface text,
  ADD COLUMN IF NOT EXISTS feature text;

-- Backfill inicial (surface a partir de channel; feature a partir de kind)
UPDATE public.outbound_messages
   SET surface = CASE
                   WHEN channel = 'inapp' THEN 'app_notification'
                   WHEN channel = 'whatsapp' THEN 'whatsapp'
                   ELSE coalesce(surface, 'whatsapp')
                 END,
       feature = coalesce(feature, kind)
 WHERE surface IS NULL OR feature IS NULL;

CREATE INDEX IF NOT EXISTS outbound_messages_surface_idx
  ON public.outbound_messages (surface, created_at DESC);
CREATE INDEX IF NOT EXISTS outbound_messages_feature_idx
  ON public.outbound_messages (feature, created_at DESC);
CREATE INDEX IF NOT EXISTS outbound_messages_user_idx
  ON public.outbound_messages (user_id, created_at DESC);

-- Preencher automaticamente surface/feature quando o caller não define.
CREATE OR REPLACE FUNCTION public.fill_outbound_surface_feature()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.surface IS NULL THEN
    NEW.surface := CASE
      WHEN NEW.channel = 'inapp' AND NEW.kind IN ('agent','agent_reply') THEN 'app_assessor'
      WHEN NEW.channel = 'inapp' THEN 'app_notification'
      ELSE 'whatsapp'
    END;
  END IF;
  IF NEW.feature IS NULL THEN
    NEW.feature := NEW.kind;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS om_fill_surface_feature ON public.outbound_messages;
CREATE TRIGGER om_fill_surface_feature
  BEFORE INSERT ON public.outbound_messages
  FOR EACH ROW EXECUTE FUNCTION public.fill_outbound_surface_feature();

-- =========================================================================
-- 2) Espelho: conversation_messages (outbound) -> outbound_messages
-- =========================================================================
CREATE OR REPLACE FUNCTION public.mirror_conversation_message_to_outbound()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
BEGIN
  IF NEW.direction::text <> 'outbound' THEN
    RETURN NEW;
  END IF;
  SELECT c.phone_e164 INTO v_phone
    FROM public.conversations c WHERE c.id = NEW.conversation_id;

  INSERT INTO public.outbound_messages (
    channel, surface, feature, user_id, to_phone, body,
    status, kind, idempotency_key, context_type, context_id,
    metadata, sent_at
  ) VALUES (
    'inapp', 'app_assessor', 'agent_chat', NEW.user_id,
    coalesce(v_phone, ''), NEW.body_masked,
    'delivered'::msg_status, 'agent',
    'app_assessor:' || NEW.id::text,
    'conversation', NEW.conversation_id,
    jsonb_build_object('conversation_message_id', NEW.id, 'origin', 'app_assessor'),
    NEW.created_at
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca quebrar o fluxo do assessor por causa do espelho.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cm_mirror_outbound ON public.conversation_messages;
CREATE TRIGGER cm_mirror_outbound
  AFTER INSERT ON public.conversation_messages
  FOR EACH ROW EXECUTE FUNCTION public.mirror_conversation_message_to_outbound();

-- =========================================================================
-- 3) Espelho: notifications -> outbound_messages
-- =========================================================================
CREATE OR REPLACE FUNCTION public.mirror_notification_to_outbound()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.outbound_messages (
    channel, surface, feature, user_id, to_phone, body,
    status, kind, idempotency_key, context_type, context_id, metadata, sent_at
  ) VALUES (
    'inapp',
    CASE WHEN NEW.type::text ILIKE 'insight%' THEN 'app_insight' ELSE 'app_notification' END,
    'notification_' || NEW.type::text,
    NEW.user_id, '',
    coalesce(NEW.body, NEW.title),
    'delivered'::msg_status,
    'notification',
    'notification:' || NEW.id::text,
    'notification', NEW.id,
    jsonb_build_object('type', NEW.type::text, 'title', NEW.title, 'action_url', NEW.action_url),
    NEW.created_at
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notif_mirror_outbound ON public.notifications;
CREATE TRIGGER notif_mirror_outbound
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.mirror_notification_to_outbound();

-- =========================================================================
-- 4) admin_message_activity — filtros extendidos
-- =========================================================================
DROP FUNCTION IF EXISTS public.admin_message_activity(
  timestamptz, timestamptz, text, text, integer, integer
);

CREATE OR REPLACE FUNCTION public.admin_message_activity(
  p_from timestamptz DEFAULT now() - interval '7 days',
  p_to   timestamptz DEFAULT now(),
  p_status text DEFAULT NULL,
  p_kind   text DEFAULT NULL,
  p_surface text DEFAULT NULL,
  p_feature text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
    INTO result
    FROM (
      SELECT o.id, o.created_at, o.updated_at, o.sent_at, o.status::text,
             o.channel, o.surface, o.feature, o.kind, o.attempts, o.last_error,
             o.provider_message_id, o.context_type, o.context_id,
             o.participant_id, o.user_id,
             CASE WHEN length(coalesce(o.to_phone,'')) >= 4
                  THEN '***' || right(o.to_phone, 4)
                  WHEN o.channel = 'inapp' THEN 'App'
                  ELSE '***' END AS recipient,
             left(regexp_replace(coalesce(o.body,''), E'[\\n\\r]+', ' ', 'g'), 200) AS preview,
             o.metadata
        FROM public.outbound_messages o
       WHERE o.created_at >= coalesce(p_from, now() - interval '7 days')
         AND o.created_at <= coalesce(p_to, now())
         AND (p_status  IS NULL OR o.status::text = p_status)
         AND (p_kind    IS NULL OR o.kind = p_kind)
         AND (p_surface IS NULL OR o.surface = p_surface)
         AND (p_feature IS NULL OR o.feature = p_feature)
         AND (p_user_id IS NULL OR o.user_id = p_user_id)
         AND (
           p_search IS NULL OR p_search = '' OR
           o.body ILIKE '%'||p_search||'%' OR
           o.to_phone ILIKE '%'||p_search||'%' OR
           o.feature ILIKE '%'||p_search||'%'
         )
       ORDER BY o.created_at DESC
       LIMIT greatest(1, least(coalesce(p_limit,100), 500))
       OFFSET greatest(0, coalesce(p_offset,0))
    ) x;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.admin_message_activity(
  timestamptz, timestamptz, text, text, text, text, uuid, text, integer, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_message_activity(
  timestamptz, timestamptz, text, text, text, text, uuid, text, integer, integer
) TO authenticated;

-- =========================================================================
-- 5) admin_message_metrics — enriquecido
-- =========================================================================
CREATE OR REPLACE FUNCTION public.admin_message_metrics(
  p_from timestamptz DEFAULT now() - interval '7 days',
  p_to   timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  by_channel jsonb;
  by_feature jsonb;
  by_surface jsonb;
BEGIN
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_object_agg(channel, cnt), '{}'::jsonb) INTO by_channel FROM (
    SELECT coalesce(channel,'?') AS channel, count(*) AS cnt
      FROM public.outbound_messages
     WHERE created_at BETWEEN p_from AND p_to
     GROUP BY 1
  ) t;

  SELECT coalesce(jsonb_object_agg(feature, cnt), '{}'::jsonb) INTO by_feature FROM (
    SELECT coalesce(feature, kind, '?') AS feature, count(*) AS cnt
      FROM public.outbound_messages
     WHERE created_at BETWEEN p_from AND p_to
     GROUP BY 1
     ORDER BY cnt DESC
     LIMIT 20
  ) t;

  SELECT coalesce(jsonb_object_agg(surface, cnt), '{}'::jsonb) INTO by_surface FROM (
    SELECT coalesce(surface,'?') AS surface, count(*) AS cnt
      FROM public.outbound_messages
     WHERE created_at BETWEEN p_from AND p_to
     GROUP BY 1
  ) t;

  SELECT jsonb_build_object(
    'total',     count(*),
    'queued',    count(*) FILTER (WHERE status IN ('queued','processing')),
    'sent',      count(*) FILTER (WHERE status = 'sent'),
    'delivered', count(*) FILTER (WHERE status IN ('delivered','read')),
    'failed',    count(*) FILTER (WHERE status IN ('failed','dead')),
    'split',     count(*) FILTER (WHERE context_type = 'shared_expense' OR kind LIKE 'split_%'),
    'delivery_rate',
      CASE WHEN count(*) FILTER (WHERE channel <> 'inapp') = 0 THEN 0
           ELSE round(
             100.0 *
             count(*) FILTER (WHERE status IN ('delivered','read') AND channel <> 'inapp')
             / count(*) FILTER (WHERE channel <> 'inapp'), 1)
      END,
    'avg_queued_to_sent_ms',
      coalesce(round(avg(extract(epoch FROM (sent_at - created_at)) * 1000)
                     FILTER (WHERE sent_at IS NOT NULL)), 0),
    'by_channel', by_channel,
    'by_feature', by_feature,
    'by_surface', by_surface
  ) INTO result
  FROM public.outbound_messages
  WHERE created_at BETWEEN coalesce(p_from, now() - interval '7 days') AND coalesce(p_to, now());

  RETURN coalesce(result, '{}'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.admin_message_metrics(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_message_metrics(timestamptz, timestamptz) TO authenticated;

-- =========================================================================
-- 6) admin_message_timeline — linha do tempo de uma mensagem
-- =========================================================================
CREATE OR REPLACE FUNCTION public.admin_message_timeline(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  msg jsonb;
  events jsonb;
BEGIN
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT to_jsonb(o) - 'body' - 'to_phone'
         || jsonb_build_object(
           'preview', left(regexp_replace(coalesce(o.body,''), E'[\\n\\r]+',' ','g'), 400),
           'recipient', CASE WHEN length(coalesce(o.to_phone,''))>=4
                             THEN '***'||right(o.to_phone,4) ELSE 'App' END
         )
    INTO msg
    FROM public.outbound_messages o WHERE o.id = p_id;

  IF msg IS NULL THEN RETURN NULL; END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.occurred_at ASC), '[]'::jsonb)
    INTO events
    FROM public.message_delivery_events e
   WHERE e.outbound_id = p_id;

  RETURN jsonb_build_object('message', msg, 'events', events);
END $$;

REVOKE ALL ON FUNCTION public.admin_message_timeline(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_message_timeline(uuid) TO authenticated;

-- =========================================================================
-- 7) admin_message_reprocess — reenfileirar falhas (auditado)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.admin_message_reprocess(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  cur record;
BEGIN
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT id, status, attempts, metadata, channel INTO cur
    FROM public.outbound_messages WHERE id = p_id FOR UPDATE;
  IF cur.id IS NULL THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF cur.channel = 'inapp' THEN
    RAISE EXCEPTION 'inapp_not_reprocessable' USING ERRCODE = '22023';
  END IF;
  IF cur.status::text NOT IN ('failed','dead') THEN
    RAISE EXCEPTION 'not_reprocessable_state' USING ERRCODE = '22023';
  END IF;

  UPDATE public.outbound_messages
     SET status = 'queued'::msg_status,
         next_attempt_at = now(),
         last_error = NULL,
         claimed_at = NULL,
         lease_expires_at = NULL,
         metadata = coalesce(metadata, '{}'::jsonb)
                    || jsonb_build_object(
                         'reprocessed_at', to_jsonb(now()),
                         'reprocessed_by', to_jsonb(actor),
                         'reprocessed_count',
                           coalesce((metadata->>'reprocessed_count')::int, 0) + 1
                       ),
         updated_at = now()
   WHERE id = p_id;

  BEGIN
    INSERT INTO public.platform_admin_audit(actor_user_id, action, target_type, target_id, metadata)
    VALUES (actor, 'message_reprocess', 'outbound_message', p_id,
            jsonb_build_object('previous_status', cur.status::text, 'attempts', cur.attempts));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'id', p_id);
END $$;

REVOKE ALL ON FUNCTION public.admin_message_reprocess(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_message_reprocess(uuid) TO authenticated;
