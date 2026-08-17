-- 1) Janela real de 7 dias para falhas de mensagem (independente do filtro de período)
CREATE OR REPLACE FUNCTION public.admin_v2_messaging_failure_7d()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_failed numeric; v_total numeric;
BEGIN
  PERFORM public._require_perm('cockpit.read');
  SELECT count(*) FILTER (WHERE om.status::text IN ('failed','dead'))::numeric,
         count(*)::numeric
    INTO v_failed, v_total
  FROM public.outbound_messages om
  JOIN public.v_client_users v ON v.user_id = om.user_id
  WHERE om.created_at >= now() - interval '7 days';

  RETURN jsonb_build_object(
    'window_days', 7,
    'total', coalesce(v_total,0)::int,
    'failed', coalesce(v_failed,0)::int,
    'rate', CASE WHEN coalesce(v_total,0) = 0 THEN null ELSE round(v_failed / v_total * 100, 2) END,
    'measured_at', now()
  );
END; $fn$;

REVOKE ALL ON FUNCTION public.admin_v2_messaging_failure_7d() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_v2_messaging_failure_7d() TO authenticated;

-- 2) Limites globais de convivência proativa (editáveis pelo admin)
CREATE TABLE IF NOT EXISTS public.proactive_global_limits (
  id boolean PRIMARY KEY DEFAULT true,
  max_per_day int NOT NULL DEFAULT 1,
  max_per_week int NOT NULL DEFAULT 3,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT proactive_global_limits_singleton CHECK (id),
  CONSTRAINT proactive_global_limits_day_range CHECK (max_per_day BETWEEN 0 AND 5),
  CONSTRAINT proactive_global_limits_week_range CHECK (max_per_week BETWEEN 1 AND 14)
);

GRANT SELECT ON public.proactive_global_limits TO authenticated;
GRANT ALL ON public.proactive_global_limits TO service_role;

ALTER TABLE public.proactive_global_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proactive_global_limits_read" ON public.proactive_global_limits;
CREATE POLICY "proactive_global_limits_read" ON public.proactive_global_limits
  FOR SELECT TO authenticated USING (public.is_platform_admin());

INSERT INTO public.proactive_global_limits (id, max_per_day, max_per_week)
VALUES (true, 1, 3)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_proactive_limits()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v jsonb;
BEGIN
  PERFORM public._require_perm('messaging.read');
  SELECT jsonb_build_object(
    'max_per_day', max_per_day,
    'max_per_week', max_per_week,
    'updated_at', updated_at
  ) INTO v FROM public.proactive_global_limits WHERE id;
  RETURN coalesce(v, jsonb_build_object('max_per_day',1,'max_per_week',3,'updated_at',null));
END; $fn$;

REVOKE ALL ON FUNCTION public.admin_proactive_limits() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_proactive_limits() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_proactive_limits_update(_max_per_day int, _max_per_week int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_day int := greatest(0, least(5, coalesce(_max_per_day, 1)));
        v_week int := greatest(1, least(14, coalesce(_max_per_week, 3)));
BEGIN
  PERFORM public._require_perm('messaging.write');

  INSERT INTO public.proactive_global_limits (id, max_per_day, max_per_week, updated_at, updated_by)
  VALUES (true, v_day, v_week, now(), auth.uid())
  ON CONFLICT (id) DO UPDATE
    SET max_per_day = excluded.max_per_day,
        max_per_week = excluded.max_per_week,
        updated_at = now(),
        updated_by = excluded.updated_by;

  INSERT INTO public.platform_admin_audit (actor_user_id, action, meta)
  VALUES (auth.uid(), 'proactive_limits_update',
          jsonb_build_object('max_per_day', v_day, 'max_per_week', v_week));

  RETURN jsonb_build_object('max_per_day', v_day, 'max_per_week', v_week);
END; $fn$;

REVOKE ALL ON FUNCTION public.admin_proactive_limits_update(int,int) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_proactive_limits_update(int,int) TO authenticated;