CREATE OR REPLACE FUNCTION public.admin_v2_metrics_universe()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
BEGIN
  PERFORM public._require_perm('cockpit.read');

  SELECT jsonb_build_object(
    'clients', (SELECT count(*)::int FROM public.v_client_users),
    'accounts', (SELECT count(*)::int FROM public.profiles),
    'platform_admins', (SELECT count(*)::int FROM public.platform_admins WHERE active),
    'test_accounts', (SELECT count(*)::int FROM public.profiles WHERE is_test),
    'pseudonyms', (SELECT count(*)::int FROM public.user_pseudonyms),
    'event_pseudonyms', (SELECT count(DISTINCT pseudo_id)::int FROM public.product_events),
    'event_pseudonyms_orphan', (
      SELECT count(DISTINCT e.pseudo_id)::int
      FROM public.product_events e
      WHERE NOT EXISTS (SELECT 1 FROM public.user_pseudonyms p WHERE p.pseudo_id = e.pseudo_id)
    ),
    'events_total', (SELECT count(*)::int FROM public.product_events),
    'events_live', (SELECT count(*)::int FROM public.product_events WHERE event_source = 'live'),
    'events_reconstructed', (SELECT count(*)::int FROM public.product_events WHERE event_source <> 'live'),
    'events_last_at', (SELECT max(occurred_at) FROM public.product_events),
    'agent_runs', (SELECT count(*)::int FROM public.agent_runs),
    'measured_at', now(),
    'formula_version', 'universe.v1'
  ) INTO v;

  RETURN v;
END; $function$;

REVOKE ALL ON FUNCTION public.admin_v2_metrics_universe() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_v2_metrics_universe() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_v2_client_profile(_pseudo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid;
  v_activity text[] := public.activity_events();
  v jsonb;
BEGIN
  PERFORM public._require_perm('clients.read');

  SELECT up.user_id INTO v_user
  FROM public.user_pseudonyms up
  WHERE up.pseudo_id = _pseudo_id
    AND public.is_client_user(up.user_id);

  IF v_user IS NULL THEN
    RETURN jsonb_build_object('found', false, 'pseudo_id', _pseudo_id);
  END IF;

  SELECT jsonb_build_object(
    'found', true,
    'pseudo_id', _pseudo_id,
    'summary', (
      SELECT jsonb_build_object(
        'registered_at', up.created_at,
        'onboarding_completed_at', pr.onboarding_completed_at,
        'timezone', pr.timezone,
        'detached_at', up.detached_at
      )
      FROM public.user_pseudonyms up
      LEFT JOIN public.profiles pr ON pr.id = up.user_id
      WHERE up.pseudo_id = _pseudo_id
    ),
    'journey', (
      SELECT jsonb_build_object(
        'first_event_at', min(e.occurred_at),
        'last_event_at', max(e.occurred_at),
        'total_events', count(*)::int,
        'significant_actions', count(*) FILTER (WHERE e.event_name = ANY (v_activity))::int,
        'active_days', count(DISTINCT (e.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date)::int,
        'reconstructed_events', count(*) FILTER (WHERE e.event_source <> 'live')::int
      )
      FROM public.product_events e
      WHERE e.pseudo_id = _pseudo_id
    ),
    'finance', (
      SELECT jsonb_build_object(
        'transactions', (SELECT count(*)::int FROM public.transactions t WHERE t.user_id = v_user),
        'last_transaction_at', (SELECT max(t.created_at) FROM public.transactions t WHERE t.user_id = v_user),
        'accounts', (SELECT count(*)::int FROM public.accounts a WHERE a.user_id = v_user),
        'goals', (SELECT count(*)::int FROM public.goals g WHERE g.user_id = v_user),
        'documents', (SELECT count(*)::int FROM public.document_imports d WHERE d.user_id = v_user)
      )
    ),
    'nino', (
      SELECT jsonb_build_object(
        'runs', count(*)::int,
        'errors', count(*) FILTER (WHERE r.status = 'error')::int,
        'cost_cents', coalesce(sum(r.cost_cents), 0)::int,
        'last_run_at', max(r.started_at),
        'p95_latency_ms', coalesce(percentile_disc(0.95) WITHIN GROUP (ORDER BY r.latency_ms), 0)::int
      )
      FROM public.agent_runs r
      WHERE r.user_id = v_user
    ),
    'communications', (
      SELECT jsonb_build_object(
        'attempted', count(*)::int,
        'delivered', count(*) FILTER (WHERE d.status = 'delivered')::int,
        'suppressed', count(*) FILTER (WHERE d.status = 'suppressed')::int,
        'interacted', count(*) FILTER (WHERE d.interacted_at IS NOT NULL)::int,
        'last_at', max(d.created_at),
        'suppression_reasons', coalesce(
          (SELECT jsonb_agg(DISTINCT d2.reason)
           FROM public.communication_deliveries d2
           WHERE d2.user_id = v_user AND d2.status = 'suppressed' AND d2.reason IS NOT NULL),
          '[]'::jsonb)
      )
      FROM public.communication_deliveries d
      WHERE d.user_id = v_user
    ),
    'channel', (
      SELECT jsonb_build_object(
        'whatsapp_linked', EXISTS(
          SELECT 1 FROM public.whatsapp_links w
          WHERE w.user_id = v_user AND w.status = 'active'),
        'messages_sent', (SELECT count(*)::int FROM public.outbound_messages o WHERE o.user_id = v_user),
        'messages_failed', (SELECT count(*)::int FROM public.outbound_messages o WHERE o.user_id = v_user AND o.status = 'failed'),
        'last_message_at', (SELECT max(o.created_at) FROM public.outbound_messages o WHERE o.user_id = v_user)
      )
    ),
    'timeline', (
      SELECT coalesce(jsonb_agg(row_to_json(t) ORDER BY t.occurred_at DESC), '[]'::jsonb)
      FROM (
        SELECT e.event_name, e.feature, e.surface, e.outcome, e.event_source, e.occurred_at
        FROM public.product_events e
        WHERE e.pseudo_id = _pseudo_id
        ORDER BY e.occurred_at DESC
        LIMIT 40
      ) t
    ),
    'formula_version', 'client_profile.v1',
    'measured_at', now()
  ) INTO v;

  RETURN v;
END; $function$;

REVOKE ALL ON FUNCTION public.admin_v2_client_profile(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_v2_client_profile(uuid) TO authenticated;