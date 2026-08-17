CREATE OR REPLACE FUNCTION public.admin_v2_proactive_summary(_days integer DEFAULT 30, _channel text DEFAULT NULL::text, _kind text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_from timestamptz := now() - make_interval(days => GREATEST(1, LEAST(365, _days)));
  v_totals jsonb;
  v_by_kind jsonb;
  v_by_channel jsonb;
  v_by_reason jsonb;
  v_daily jsonb;
BEGIN
  PERFORM public._require_perm('messaging.read');
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'generated',   COALESCE(SUM(CASE WHEN status IN ('selected','queued','sent','delivered','acted','failed','suppressed','dismissed') THEN 1 ELSE 0 END), 0),
    'suppressed',  COALESCE(SUM(CASE WHEN status = 'suppressed' THEN 1 ELSE 0 END), 0),
    'queued',      COALESCE(SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END), 0),
    'sent',        COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END), 0),
    'delivered',   COALESCE(SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END), 0),
    'failed',      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0),
    'acted',       COALESCE(SUM(CASE WHEN status = 'acted' OR acted_at IS NOT NULL THEN 1 ELSE 0 END), 0),
    'dismissed',   COALESCE(SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END), 0),
    'opt_out',     COALESCE(SUM(CASE WHEN status = 'suppressed' AND reason ILIKE '%opt%out%' THEN 1 ELSE 0 END), 0),
    'released',    COALESCE(SUM(CASE WHEN status IN ('queued','sent','delivered','acted','failed') THEN 1 ELSE 0 END), 0),
    'cost_usd',    ROUND(COALESCE(SUM(cost_usd), 0)::numeric, 4)
  )
  INTO v_totals
  FROM public.communication_deliveries
  WHERE created_at >= v_from
    AND (_channel IS NULL OR channel = _channel)
    AND (_kind IS NULL OR kind = _kind);

  SELECT COALESCE(jsonb_agg(row_to_json(k)), '[]'::jsonb)
  INTO v_by_kind
  FROM (
    SELECT kind,
           COUNT(*)::int AS total,
           SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END)::int AS delivered,
           SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END)::int AS failed,
           SUM(CASE WHEN status = 'suppressed' THEN 1 ELSE 0 END)::int AS suppressed,
           SUM(CASE WHEN acted_at IS NOT NULL THEN 1 ELSE 0 END)::int AS acted,
           ROUND(COALESCE(SUM(cost_usd), 0)::numeric, 4) AS cost_usd
    FROM public.communication_deliveries
    WHERE created_at >= v_from
      AND (_channel IS NULL OR channel = _channel)
      AND (_kind IS NULL OR kind = _kind)
    GROUP BY kind
    ORDER BY total DESC
  ) k;

  SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb)
  INTO v_by_channel
  FROM (
    SELECT channel,
           COUNT(*)::int AS total,
           SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END)::int AS delivered,
           SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END)::int AS failed,
           SUM(CASE WHEN status = 'suppressed' THEN 1 ELSE 0 END)::int AS suppressed,
           SUM(CASE WHEN acted_at IS NOT NULL THEN 1 ELSE 0 END)::int AS acted,
           ROUND(COALESCE(SUM(cost_usd), 0)::numeric, 4) AS cost_usd
    FROM public.communication_deliveries
    WHERE created_at >= v_from
      AND (_channel IS NULL OR channel = _channel)
      AND (_kind IS NULL OR kind = _kind)
    GROUP BY channel
    ORDER BY channel
  ) c;

  -- Motivos de retenção: por que uma candidata não virou entrega
  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.total DESC), '[]'::jsonb)
  INTO v_by_reason
  FROM (
    SELECT COALESCE(reason, 'sem_motivo_registrado') AS reason,
           channel,
           COUNT(*)::int AS total,
           MAX(created_at) AS last_at
    FROM public.communication_deliveries
    WHERE created_at >= v_from
      AND status = 'suppressed'
      AND (_channel IS NULL OR channel = _channel)
      AND (_kind IS NULL OR kind = _kind)
    GROUP BY 1, 2
  ) r;

  SELECT COALESCE(jsonb_agg(row_to_json(d) ORDER BY d.day), '[]'::jsonb)
  INTO v_daily
  FROM (
    SELECT (date_trunc('day', created_at) AT TIME ZONE 'America/Sao_Paulo')::date AS day,
           COUNT(*)::int AS total,
           SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END)::int AS delivered,
           SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END)::int AS failed,
           SUM(CASE WHEN status = 'suppressed' THEN 1 ELSE 0 END)::int AS suppressed,
           SUM(CASE WHEN acted_at IS NOT NULL THEN 1 ELSE 0 END)::int AS acted
    FROM public.communication_deliveries
    WHERE created_at >= v_from
      AND (_channel IS NULL OR channel = _channel)
      AND (_kind IS NULL OR kind = _kind)
    GROUP BY 1
  ) d;

  RETURN jsonb_build_object(
    'period_days', _days,
    'from', v_from,
    'to', now(),
    'timezone', 'America/Sao_Paulo',
    'totals', v_totals,
    'by_kind', v_by_kind,
    'by_channel', v_by_channel,
    'by_reason', v_by_reason,
    'daily', v_daily,
    'formula_version', 'proactive.summary.v2.funnel'
  );
END;
$function$;