-- ===== 1. Auditoria automática de categorização + encerramento de dicas =====
CREATE OR REPLACE FUNCTION public.tg_transactions_category_audit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.category_id IS DISTINCT FROM OLD.category_id THEN
    NEW.previous_category_id := OLD.category_id;
    IF NEW.category_source IS NOT DISTINCT FROM OLD.category_source THEN
      NEW.category_source := 'user';
      NEW.category_confidence := 1;
      NEW.category_reason := coalesce(NEW.category_reason, 'edição manual do usuário');
      NEW.user_edited_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_category_audit ON public.transactions;
CREATE TRIGGER transactions_category_audit
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.tg_transactions_category_audit();

CREATE OR REPLACE FUNCTION public.tg_transactions_resolve_tips()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.category_id IS NOT NULL AND OLD.category_id IS NULL THEN
    UPDATE public.user_insights
      SET status = 'resolved', resolved_at = now()
    WHERE user_id = NEW.user_id
      AND status = 'active'
      AND (evidence->>'transaction_id') = NEW.id::text;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_resolve_tips ON public.transactions;
CREATE TRIGGER transactions_resolve_tips
  AFTER UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.tg_transactions_resolve_tips();

-- ===== 2. Feedback unificado das dicas =====
CREATE OR REPLACE FUNCTION public.my_tip_feedback(_insight_id uuid, _feedback text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.user_insights%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING errcode = '42501';
  END IF;
  IF _feedback NOT IN ('useful','not_useful','dismissed','acted') THEN
    RAISE EXCEPTION 'invalid_feedback' USING errcode = '22023';
  END IF;

  SELECT * INTO v_row FROM public.user_insights
  WHERE id = _insight_id AND user_id = v_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'insight_not_found' USING errcode = 'P0002';
  END IF;

  UPDATE public.user_insights
    SET feedback = _feedback,
        status = CASE WHEN _feedback = 'acted' THEN 'resolved' ELSE 'dismissed' END,
        resolved_at = CASE WHEN _feedback = 'acted' THEN now() ELSE resolved_at END
  WHERE id = _insight_id;

  INSERT INTO public.communication_feedback (user_id, source_table, source_id, kind, family, dedup_key, feedback)
  VALUES (v_user, 'user_insights', _insight_id, coalesce(v_row.type,'tip'), v_row.family, v_row.dedup_key, _feedback)
  ON CONFLICT (user_id, source_table, coalesce(dedup_key, ''), coalesce(source_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET feedback = excluded.feedback, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.my_tip_feedback(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_tip_feedback(uuid, text) TO authenticated, service_role;

-- ===== 3. Prontidão de revisão =====
CREATE OR REPLACE FUNCTION public.my_advisor_readiness()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tx integer;
  v_months integer;
  v_missing text[] := ARRAY[]::text[];
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING errcode = '42501';
  END IF;

  SELECT count(*) INTO v_tx FROM public.transactions
  WHERE user_id = v_user AND status = 'confirmed'
    AND occurred_at >= (current_date - interval '90 days');

  SELECT coalesce(count(DISTINCT to_char(occurred_at, 'YYYY-MM')), 0) INTO v_months
  FROM public.transactions
  WHERE user_id = v_user AND status = 'confirmed';

  IF v_tx < 20 THEN
    v_missing := v_missing || format('Registrar ao menos 20 lançamentos nos últimos 90 dias (você tem %s).', v_tx);
  END IF;
  IF v_months < 1 THEN
    v_missing := v_missing || 'Ter ao menos um mês de histórico registrado.';
  END IF;

  RETURN jsonb_build_object(
    'eligible', array_length(v_missing, 1) IS NULL,
    'transactions_90d', v_tx,
    'months_observed', v_months,
    'missing', to_jsonb(v_missing),
    'weekly_last_generated_at', (
      SELECT max(last_generated_at) FROM public.advisor_reviews
      WHERE user_id = v_user AND period_kind = 'weekly'
    ),
    'monthly_last_generated_at', (
      SELECT max(last_generated_at) FROM public.advisor_reviews
      WHERE user_id = v_user AND period_kind = 'monthly'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.my_advisor_readiness() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_advisor_readiness() TO authenticated, service_role;

-- ===== 4. Contexto do Nino sem memórias técnicas =====
CREATE OR REPLACE FUNCTION public.my_nino_context()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING errcode = '42501';
  END IF;

  RETURN jsonb_build_object(
    'memory', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'kind', m.kind, 'key', m.key, 'value', m.value,
        'confidence', m.confidence, 'source', m.source, 'visibility', m.visibility,
        'expires_at', m.expires_at, 'last_used_at', m.last_used_at,
        'created_at', m.created_at, 'updated_at', m.updated_at
      ) ORDER BY m.confidence DESC, m.updated_at DESC)
      FROM public.agent_memory m
      WHERE m.user_id = v_user
        AND coalesce(m.visibility, 'user') = 'user'
        AND (m.expires_at IS NULL OR m.expires_at > now())
    ), '[]'::jsonb),
    'hypotheses', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', h.id, 'kind', h.kind, 'title', h.title, 'explanation', h.explanation,
        'confidence', h.confidence, 'evidence', h.evidence, 'dedup_key', h.dedup_key,
        'status', h.status, 'user_feedback', h.user_feedback,
        'created_at', h.created_at, 'updated_at', h.updated_at, 'expires_at', h.expires_at
      ) ORDER BY h.updated_at DESC)
      FROM public.behavior_hypotheses h
      WHERE h.user_id = v_user AND h.status <> 'expired'
        AND (h.expires_at IS NULL OR h.expires_at > now())
    ), '[]'::jsonb),
    'reviews', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'period_kind', r.period_kind, 'period_start', r.period_start,
        'period_end', r.period_end, 'summary', r.summary, 'actions', r.actions,
        'status', r.status, 'formula_version', r.formula_version,
        'generated_at', r.generated_at, 'updated_at', r.updated_at,
        'last_generated_at', r.last_generated_at
      ) ORDER BY r.period_start DESC, r.generated_at DESC)
      FROM (
        SELECT * FROM public.advisor_reviews
        WHERE user_id = v_user
        ORDER BY period_start DESC, generated_at DESC LIMIT 12
      ) r
    ), '[]'::jsonb),
    'recent_deliveries', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id, 'kind', d.kind, 'channel', d.channel, 'status', d.status,
        'reason', d.reason, 'created_at', d.created_at, 'interacted_at', d.interacted_at,
        'false_positive', d.false_positive, 'user_feedback', d.user_feedback
      ) ORDER BY d.created_at DESC)
      FROM (
        SELECT * FROM public.communication_deliveries
        WHERE user_id = v_user
          AND created_at >= now() - interval '30 days'
          AND status IN ('queued','sent','delivered','acted')
        ORDER BY created_at DESC LIMIT 20
      ) d
    ), '[]'::jsonb),
    'preferences', coalesce((
      SELECT to_jsonb(p) - 'id' - 'user_id' - 'created_at' - 'updated_at'
      FROM public.notification_preferences p WHERE p.user_id = v_user
    ), '{}'::jsonb),
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.my_nino_context() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_nino_context() TO authenticated, service_role;

-- ===== 5. Admin: status do motor, fila e catálogo =====
CREATE OR REPLACE FUNCTION public.admin_proactive_engine_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM public._require_perm('ops.read');

  SELECT jsonb_build_object(
    'enabled', s.proactive_enabled,
    'channels', to_jsonb(s.proactive_channels),
    'rollout_user_ids', to_jsonb(s.proactive_rollout_user_ids),
    'last_tick_at', s.last_tick_at,
    'last_tick_duration_ms', s.last_tick_duration_ms,
    'last_tick_users', s.last_tick_users,
    'last_tick_errors', s.last_tick_errors,
    'next_tick_at', s.next_tick_at
  ) INTO v_result
  FROM public.agent_settings s WHERE s.id = 1;

  RETURN coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'cron', coalesce((
      SELECT jsonb_agg(jsonb_build_object('jobname', j.jobname, 'schedule', j.schedule, 'active', j.active))
      FROM cron.job j WHERE j.jobname LIKE 'agent-proactive%'
    ), '[]'::jsonb),
    'pending_suggestions', (SELECT count(*) FROM public.pending_proactive_suggestions WHERE status = 'pending'),
    'deliveries_7d', (SELECT count(*) FROM public.communication_deliveries WHERE created_at >= now() - interval '7 days'),
    'blocked_7d', (SELECT count(*) FROM public.communication_deliveries WHERE created_at >= now() - interval '7 days' AND status = 'suppressed')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_proactive_engine_status() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_proactive_engine_status() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_proactive_queue(_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_perm('ops.read');
  RETURN jsonb_build_object(
    'pending', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'kind', p.kind, 'severity', p.severity, 'title', p.title,
        'dedup_key', p.dedup_key, 'created_at', p.created_at, 'channel_ready', p.channel_ready
      ) ORDER BY p.created_at DESC)
      FROM (SELECT * FROM public.pending_proactive_suggestions WHERE status = 'pending'
            ORDER BY created_at DESC LIMIT least(coalesce(_limit,50), 200)) p
    ), '[]'::jsonb),
    'recent', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id, 'kind', d.kind, 'channel', d.channel, 'status', d.status,
        'reason', d.reason, 'created_at', d.created_at
      ) ORDER BY d.created_at DESC)
      FROM (SELECT * FROM public.communication_deliveries
            ORDER BY created_at DESC LIMIT least(coalesce(_limit,50), 200)) d
    ), '[]'::jsonb),
    'blocks', coalesce((
      SELECT jsonb_agg(jsonb_build_object('reason', b.reason, 'total', b.total) ORDER BY b.total DESC)
      FROM (SELECT coalesce(reason,'desconhecido') AS reason, count(*) AS total
            FROM public.communication_deliveries
            WHERE status = 'suppressed' AND created_at >= now() - interval '30 days'
            GROUP BY 1) b
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_proactive_queue(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_proactive_queue(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_communication_catalog()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_perm('ops.read');
  RETURN coalesce((
    SELECT jsonb_agg(to_jsonb(c) ORDER BY c.base_priority DESC, c.kind)
    FROM public.communication_catalog c
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_communication_catalog() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_communication_catalog() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_communication_catalog_update(
  _kind text,
  _active boolean DEFAULT NULL,
  _base_priority integer DEFAULT NULL,
  _allowed_channels text[] DEFAULT NULL,
  _cooldown_hours integer DEFAULT NULL,
  _max_per_day integer DEFAULT NULL,
  _requires_manual_approval boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.communication_catalog%ROWTYPE;
BEGIN
  PERFORM public._require_perm('ops.write');

  UPDATE public.communication_catalog SET
    active = coalesce(_active, active),
    base_priority = coalesce(_base_priority, base_priority),
    allowed_channels = coalesce(_allowed_channels, allowed_channels),
    cooldown_hours = coalesce(_cooldown_hours, cooldown_hours),
    max_per_day = coalesce(_max_per_day, max_per_day),
    requires_manual_approval = coalesce(_requires_manual_approval, requires_manual_approval),
    updated_at = now()
  WHERE kind = _kind
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'kind_not_found' USING errcode = 'P0002';
  END IF;

  INSERT INTO public.platform_admin_audit (actor_user_id, action, target_type, target_id, metadata)
  VALUES (auth.uid(), 'communication_catalog_update', 'communication_catalog', _kind,
          jsonb_build_object('active', v_row.active, 'base_priority', v_row.base_priority,
                             'allowed_channels', to_jsonb(v_row.allowed_channels)));

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_communication_catalog_update(text, boolean, integer, text[], integer, integer, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_communication_catalog_update(text, boolean, integer, text[], integer, integer, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_proactive_engine_toggle(
  _enabled boolean DEFAULT NULL,
  _channels text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.agent_settings%ROWTYPE;
BEGIN
  PERFORM public._require_perm('ops.write');

  UPDATE public.agent_settings SET
    proactive_enabled = coalesce(_enabled, proactive_enabled),
    proactive_channels = coalesce(_channels, proactive_channels)
  WHERE id = 1
  RETURNING * INTO v_row;

  INSERT INTO public.platform_admin_audit (actor_user_id, action, target_type, target_id, metadata)
  VALUES (auth.uid(), 'proactive_engine_toggle', 'agent_settings', '1',
          jsonb_build_object('enabled', v_row.proactive_enabled, 'channels', to_jsonb(v_row.proactive_channels)));

  RETURN jsonb_build_object('enabled', v_row.proactive_enabled, 'channels', to_jsonb(v_row.proactive_channels));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_proactive_engine_toggle(boolean, text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_proactive_engine_toggle(boolean, text[]) TO authenticated, service_role;
