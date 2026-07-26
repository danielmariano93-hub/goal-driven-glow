
-- 1) Coluna de custo para observabilidade FinOps
ALTER TABLE public.communication_deliveries
  ADD COLUMN IF NOT EXISTS cost_usd numeric(12,6);

COMMENT ON COLUMN public.communication_deliveries.cost_usd IS
  'Custo estimado da entrega (USD). Preenchido pelo dispatcher quando houver custo de IA/mensageria associado.';

-- 2) RPC de resumo para o painel Admin
CREATE OR REPLACE FUNCTION public.admin_v2_proactive_summary(
  _days integer DEFAULT 30,
  _channel text DEFAULT NULL,
  _kind text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from timestamptz := now() - make_interval(days => GREATEST(1, LEAST(365, _days)));
  v_totals jsonb;
  v_by_kind jsonb;
  v_by_channel jsonb;
  v_daily jsonb;
BEGIN
  -- Gate: somente administradores da plataforma
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
           SUM(CASE WHEN acted_at IS NOT NULL THEN 1 ELSE 0 END)::int AS acted,
           ROUND(COALESCE(SUM(cost_usd), 0)::numeric, 4) AS cost_usd
    FROM public.communication_deliveries
    WHERE created_at >= v_from
      AND (_channel IS NULL OR channel = _channel)
      AND (_kind IS NULL OR kind = _kind)
    GROUP BY channel
    ORDER BY channel
  ) c;

  SELECT COALESCE(jsonb_agg(row_to_json(d) ORDER BY d.day), '[]'::jsonb)
  INTO v_daily
  FROM (
    SELECT (date_trunc('day', created_at) AT TIME ZONE 'America/Sao_Paulo')::date AS day,
           COUNT(*)::int AS total,
           SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END)::int AS delivered,
           SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END)::int AS failed,
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
    'daily', v_daily
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_v2_proactive_summary(integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_v2_proactive_summary(integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_v2_proactive_summary(integer, text, text) TO service_role;
