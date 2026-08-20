-- ============ Nino Agente Autônomo: links curtos, relatório parcial e observabilidade ============

-- 1) Relatório do mês corrente (parcial) passa a ser um tipo válido
ALTER TABLE public.financial_reports DROP CONSTRAINT IF EXISTS financial_reports_report_type_check;
ALTER TABLE public.financial_reports
  ADD CONSTRAINT financial_reports_report_type_check
  CHECK (report_type IN ('weekly','monthly','monthly_partial'));

-- 2) Links curtos para ações compartilhadas
CREATE TABLE IF NOT EXISTS public.short_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  target_path text NOT NULL,
  kind text NOT NULL DEFAULT 'generic',
  user_id uuid,
  expires_at timestamptz,
  click_count integer NOT NULL DEFAULT 0,
  last_click_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS short_links_user_idx ON public.short_links (user_id, created_at DESC);

GRANT SELECT ON public.short_links TO authenticated;
GRANT ALL ON public.short_links TO service_role;

ALTER TABLE public.short_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "short_links_owner_read" ON public.short_links;
CREATE POLICY "short_links_owner_read" ON public.short_links
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.short_link_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  short_link_id uuid NOT NULL REFERENCES public.short_links(id) ON DELETE CASCADE,
  token text NOT NULL,
  clicked_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  outcome text NOT NULL DEFAULT 'resolved'
);
CREATE INDEX IF NOT EXISTS short_link_clicks_link_idx ON public.short_link_clicks (short_link_id, clicked_at DESC);

GRANT ALL ON public.short_link_clicks TO service_role;
ALTER TABLE public.short_link_clicks ENABLE ROW LEVEL SECURITY;
-- Sem policy de leitura: auditoria é consumida por funções com privilégio.

-- Criação do link (dono autenticado ou edge function)
CREATE OR REPLACE FUNCTION public.create_short_link(
  _target_path text,
  _kind text DEFAULT 'generic',
  _ttl_days integer DEFAULT 30,
  _user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _owner uuid := COALESCE(_user_id, auth.uid());
  _token text;
  _path text := btrim(COALESCE(_target_path, ''));
BEGIN
  IF _path = '' OR left(_path, 1) <> '/' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_target_path');
  END IF;
  IF auth.uid() IS NOT NULL AND _owner <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden_owner');
  END IF;

  LOOP
    _token := lower(substr(replace(encode(gen_random_bytes(8), 'base64'), '/', ''), 1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.short_links WHERE token = _token);
  END LOOP;

  INSERT INTO public.short_links (token, target_path, kind, user_id, expires_at)
  VALUES (_token, _path, COALESCE(NULLIF(btrim(_kind), ''), 'generic'), _owner,
          CASE WHEN _ttl_days IS NULL THEN NULL ELSE now() + make_interval(days => GREATEST(_ttl_days, 1)) END);

  RETURN jsonb_build_object('ok', true, 'token', _token, 'path', '/s/' || _token);
END;
$$;

REVOKE ALL ON FUNCTION public.create_short_link(text, text, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_short_link(text, text, integer, uuid) TO authenticated, service_role;

-- Resolução pública do link (retorna somente o caminho interno de destino)
CREATE OR REPLACE FUNCTION public.resolve_short_link(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _row public.short_links;
BEGIN
  SELECT * INTO _row FROM public.short_links WHERE token = lower(btrim(COALESCE(_token, '')));
  IF _row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF _row.expires_at IS NOT NULL AND _row.expires_at < now() THEN
    INSERT INTO public.short_link_clicks (short_link_id, token, actor_user_id, outcome)
    VALUES (_row.id, _row.token, auth.uid(), 'expired');
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  UPDATE public.short_links
     SET click_count = click_count + 1, last_click_at = now()
   WHERE id = _row.id;

  INSERT INTO public.short_link_clicks (short_link_id, token, actor_user_id, outcome)
  VALUES (_row.id, _row.token, auth.uid(), 'resolved');

  RETURN jsonb_build_object('ok', true, 'path', _row.target_path, 'kind', _row.kind);
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_short_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_short_link(text) TO anon, authenticated, service_role;

-- 3) Observabilidade agentic: funil pedido → plano → ferramenta → escrita → recibo
CREATE OR REPLACE FUNCTION public.admin_v2_agent_autonomy(_days integer DEFAULT 7, _user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _since timestamptz := now() - make_interval(days => GREATEST(COALESCE(_days, 7), 1));
  _funnel jsonb;
  _by_capability jsonb;
  _failures jsonb;
  _tools jsonb;
BEGIN
  PERFORM public._require_perm('clients.read');

  SELECT jsonb_build_object(
    'turns', COUNT(*),
    'planned', COUNT(*) FILTER (WHERE jsonb_array_length(COALESCE(d.planned_steps, '[]'::jsonb)) > 0),
    'write_planned', COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(d.planned_steps, '[]'::jsonb)) s
        WHERE s->>'kind' = 'write')),
    'awaiting_confirmation', COUNT(*) FILTER (WHERE d.policy_decision = 'draft_then_confirm'),
    'auto_executed', COUNT(*) FILTER (WHERE d.policy_decision = 'auto_execute'),
    'tool_errors', COALESCE(SUM((d.metrics->>'tool_call_count')::numeric) FILTER (WHERE d.error IS NOT NULL), 0),
    'fallbacks', COUNT(*) FILTER (WHERE d.fallback_used),
    'errors', COUNT(*) FILTER (WHERE d.error IS NOT NULL)
  ) INTO _funnel
  FROM public.agent_decisions d
  WHERE d.created_at >= _since
    AND (_user_id IS NULL OR d.user_id = _user_id);

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'turns')::int DESC), '[]'::jsonb) INTO _by_capability
  FROM (
    SELECT jsonb_build_object(
             'capability', COALESCE(r.capability, 'desconhecida'),
             'turns', COUNT(*),
             'ok', COUNT(*) FILTER (WHERE r.status = 'done'),
             'errors', COUNT(*) FILTER (WHERE r.status = 'error'),
             'avg_latency_ms', ROUND(AVG(COALESCE(r.latency_ms, 0)))
           ) AS x
    FROM public.agent_runs r
    WHERE r.started_at >= _since
      AND (_user_id IS NULL OR r.user_id = _user_id)
    GROUP BY COALESCE(r.capability, 'desconhecida')
    ORDER BY COUNT(*) DESC
    LIMIT 20
  ) q;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'calls')::int DESC), '[]'::jsonb) INTO _tools
  FROM (
    SELECT jsonb_build_object(
             'tool', c.tool_name,
             'calls', COUNT(*),
             'ok', COUNT(*) FILTER (WHERE c.ok),
             'failed', COUNT(*) FILTER (WHERE NOT c.ok),
             'avg_ms', ROUND(AVG(COALESCE(c.duration_ms, 0)))
           ) AS x
    FROM public.agent_tool_calls c
    JOIN public.agent_runs r ON r.id = c.run_id
    WHERE r.started_at >= _since
      AND (_user_id IS NULL OR r.user_id = _user_id)
    GROUP BY c.tool_name
    ORDER BY COUNT(*) DESC
    LIMIT 25
  ) q;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at' DESC), '[]'::jsonb) INTO _failures
  FROM (
    SELECT jsonb_build_object(
             'at', c.created_at,
             'tool', c.tool_name,
             'error', LEFT(COALESCE(c.error, 'erro não informado'), 180),
             'capability', r.capability,
             'channel', r.channel
           ) AS x
    FROM public.agent_tool_calls c
    JOIN public.agent_runs r ON r.id = c.run_id
    WHERE r.started_at >= _since
      AND NOT c.ok
      AND (_user_id IS NULL OR r.user_id = _user_id)
    ORDER BY c.created_at DESC
    LIMIT 30
  ) q;

  RETURN jsonb_build_object(
    'ok', true,
    'since', _since,
    'days', GREATEST(COALESCE(_days, 7), 1),
    'funnel', COALESCE(_funnel, '{}'::jsonb),
    'capabilities', _by_capability,
    'tools', _tools,
    'failures', _failures,
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_v2_agent_autonomy(integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_v2_agent_autonomy(integer, uuid) TO authenticated, service_role;