-- 1) Modo de redação e moldura editável por template
ALTER TABLE public.communication_templates
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS frame_template text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'communication_templates_mode_check'
  ) THEN
    ALTER TABLE public.communication_templates
      ADD CONSTRAINT communication_templates_mode_check CHECK (mode IN ('fixed','ai_framed'));
  END IF;
END $$;

-- 2) Leitura: só a versão vigente, com o modo do fluxo no catálogo
CREATE OR REPLACE FUNCTION public.admin_communication_templates(_kind text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._require_perm('messaging.read');
  RETURN coalesce((
    SELECT jsonb_agg(
      to_jsonb(t) || jsonb_build_object('catalog_content_mode', c.content_mode, 'catalog_label', c.label)
      ORDER BY t.kind, t.channel
    )
    FROM public.communication_templates t
    JOIN public.communication_catalog c ON c.kind = t.kind
    WHERE t.active AND (_kind IS NULL OR t.kind = _kind)
  ), '[]'::jsonb);
END;
$function$;

-- 3) Cobertura de texto publicado por fluxo/canal (para o painel sinalizar lacunas)
CREATE OR REPLACE FUNCTION public.admin_communication_template_coverage()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._require_perm('messaging.read');
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'kind', c.kind,
      'content_mode', c.content_mode,
      'allowed_channels', c.allowed_channels,
      'has_app', EXISTS (SELECT 1 FROM public.communication_templates t WHERE t.kind = c.kind AND t.channel = 'app' AND t.active),
      'has_whatsapp', EXISTS (SELECT 1 FROM public.communication_templates t WHERE t.kind = c.kind AND t.channel = 'whatsapp' AND t.active)
    ) ORDER BY c.kind)
    FROM public.communication_catalog c
    WHERE c.active
  ), '[]'::jsonb);
END;
$function$;

-- 4) Publicação: aceita modo e moldura, mantendo versionamento
CREATE OR REPLACE FUNCTION public.admin_communication_template_upsert(
  _kind text,
  _channel text,
  _title_template text,
  _body_template text,
  _active boolean DEFAULT true,
  _mode text DEFAULT NULL,
  _frame_template text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_version integer;
  v_row public.communication_templates%ROWTYPE;
  v_unknown text[];
  v_mode text;
  v_allowed constant text[] := ARRAY[
    'title','body','kind','severity','dedup_key','action_url',
    'amount','count','description','remaining','days_left','monthly_needed',
    'category','share','current','avg','due','occurred_at'
  ];
BEGIN
  PERFORM public._require_perm('messaging.write');
  IF _channel NOT IN ('app', 'whatsapp') THEN
    RAISE EXCEPTION 'invalid_channel';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.communication_catalog WHERE kind = _kind) THEN
    RAISE EXCEPTION 'kind_not_found';
  END IF;
  IF length(trim(coalesce(_title_template, ''))) = 0
     OR length(trim(coalesce(_body_template, ''))) = 0 THEN
    RAISE EXCEPTION 'template_required';
  END IF;

  v_mode := coalesce(nullif(trim(coalesce(_mode, '')), ''), 'fixed');
  IF v_mode NOT IN ('fixed','ai_framed') THEN
    RAISE EXCEPTION 'invalid_mode';
  END IF;

  SELECT array_agg(DISTINCT variable_name)
    INTO v_unknown
    FROM (
      SELECT variable_match[1] AS variable_name
      FROM regexp_matches(
        _title_template || ' ' || _body_template || ' ' || coalesce(_frame_template, ''),
        '\{\{\s*([a-zA-Z0-9_]+)\s*\}\}',
        'g'
      ) AS m(variable_match)
    ) vars
   WHERE NOT (variable_name = ANY(v_allowed));

  IF coalesce(array_length(v_unknown, 1), 0) > 0 THEN
    RAISE EXCEPTION 'unknown_template_variables:%', array_to_string(v_unknown, ',');
  END IF;

  SELECT coalesce(max(version), 0) + 1
    INTO v_version
    FROM public.communication_templates
   WHERE kind = _kind AND channel = _channel;

  IF _active THEN
    UPDATE public.communication_templates
       SET active = false, updated_by = auth.uid(), updated_at = now()
     WHERE kind = _kind AND channel = _channel AND active;
  END IF;

  INSERT INTO public.communication_templates (
    kind, channel, title_template, body_template, allowed_variables,
    active, version, mode, frame_template, created_by, updated_by
  ) VALUES (
    _kind, _channel, trim(_title_template), trim(_body_template), v_allowed,
    _active, v_version, v_mode, nullif(trim(coalesce(_frame_template, '')), ''), auth.uid(), auth.uid()
  )
  RETURNING * INTO v_row;

  INSERT INTO public.platform_admin_audit (actor_user_id, action, meta)
  VALUES (
    auth.uid(),
    'communication_template_upsert',
    jsonb_build_object(
      'target_type', 'communication_template',
      'target_id', v_row.id,
      'kind', _kind,
      'channel', _channel,
      'version', v_version,
      'mode', v_mode,
      'active', _active
    )
  );

  RETURN to_jsonb(v_row);
END;
$function$;

-- 5) Reconciliação: entrega no WhatsApp fecha o registro do fluxo
CREATE OR REPLACE FUNCTION public.sync_communication_delivery_from_outbound()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.context_type IS DISTINCT FROM 'proactive_suggestion' OR NEW.context_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('sent','delivered','read') THEN
    UPDATE public.communication_deliveries
       SET status = 'delivered',
           delivered_at = coalesce(NEW.delivered_at, now()),
           reason = coalesce(reason, 'whatsapp_queued')
     WHERE suggestion_id = NEW.context_id
       AND channel = 'whatsapp'
       AND status = 'queued';
  ELSIF NEW.status IN ('failed','dead') THEN
    UPDATE public.communication_deliveries
       SET status = 'failed',
           reason = coalesce(nullif(NEW.last_error, ''), 'whatsapp_send_failed')
     WHERE suggestion_id = NEW.context_id
       AND channel = 'whatsapp'
       AND status = 'queued';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_communication_delivery ON public.outbound_messages;
CREATE TRIGGER trg_sync_communication_delivery
AFTER UPDATE OF status ON public.outbound_messages
FOR EACH ROW EXECUTE FUNCTION public.sync_communication_delivery_from_outbound();

-- 6) Saúde da fila: aguardando envio x preso
CREATE OR REPLACE FUNCTION public.admin_v2_delivery_queue_health(_stuck_minutes integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cut timestamptz := now() - make_interval(mins => greatest(coalesce(_stuck_minutes, 30), 1));
BEGIN
  PERFORM public._require_perm('operations.read');
  RETURN jsonb_build_object(
    'stuck_minutes', greatest(coalesce(_stuck_minutes, 30), 1),
    'waiting', (SELECT count(*) FROM public.communication_deliveries WHERE status = 'queued' AND created_at >= v_cut),
    'stuck', (SELECT count(*) FROM public.communication_deliveries WHERE status = 'queued' AND created_at < v_cut),
    'items', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id,
        'kind', d.kind,
        'channel', d.channel,
        'created_at', d.created_at,
        'waiting_minutes', round(extract(epoch from (now() - d.created_at)) / 60)::int,
        'stuck', d.created_at < v_cut,
        'outbound_status', o.status::text,
        'outbound_error', o.last_error
      ) ORDER BY d.created_at)
      FROM public.communication_deliveries d
      LEFT JOIN public.outbound_messages o
        ON o.context_id = d.suggestion_id AND o.context_type = 'proactive_suggestion'
      WHERE d.status = 'queued'
    ), '[]'::jsonb)
  );
END;
$function$;