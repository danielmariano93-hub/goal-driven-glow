-- Hotfix: coluna "pseudo_id" ambígua em RPCs admin_v2 (blank Cockpit / Crescimento)
CREATE OR REPLACE FUNCTION public.admin_v2_daily_evolution(_from date, _to date, _tz text DEFAULT 'America/Sao_Paulo'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tz text := coalesce(_tz, 'America/Sao_Paulo');
  v_from date := coalesce(_from, ((now() AT TIME ZONE v_tz)::date - 29));
  v_to date := coalesce(_to, (now() AT TIME ZONE v_tz)::date);
  v_sample int;
  v_activity text[] := public.activity_events();
BEGIN
  PERFORM public._require_perm('cockpit.read');
  IF (v_to - v_from) > 365 THEN
    RAISE EXCEPTION 'invalid_parameter_value: range excede 365 dias';
  END IF;
  IF v_to < v_from THEN
    RAISE EXCEPTION 'invalid_parameter_value: _to menor que _from';
  END IF;

  SELECT count(*)::int INTO v_sample FROM public.v_client_users;

  RETURN jsonb_build_object(
    'series', (
      SELECT coalesce(jsonb_agg(row_to_json(x) ORDER BY x.day),'[]'::jsonb)
      FROM (
        WITH days AS (
          SELECT generate_series(v_from, v_to, '1 day'::interval)::date AS day
        ),
        sig AS (
          SELECT
            e.pseudo_id,
            (e.occurred_at AT TIME ZONE v_tz)::date AS d,
            e.occurred_at,
            e.event_name
          FROM public.product_events e
          JOIN public.v_client_pseudonyms cp ON cp.pseudo_id = e.pseudo_id
          WHERE e.event_name = ANY (v_activity)
            AND e.event_source = 'live'
        ),
        first_sig AS (
          SELECT pseudo_id, min(d) AS first_d
          FROM sig
          GROUP BY pseudo_id
        ),
        last_act_per_day AS (
          SELECT
            d.day,
            s.pseudo_id,
            max(s.d) AS last_active_d
          FROM days d
          JOIN sig s ON s.d <= d.day
          GROUP BY d.day, s.pseudo_id
        )
        SELECT
          d.day,
          (SELECT count(*)::int FROM public.v_client_users v
             WHERE (v.registered_at AT TIME ZONE v_tz)::date = d.day) AS new_clients,
          (SELECT count(*)::int FROM first_sig fs
             WHERE fs.first_d = d.day) AS activated,
          (SELECT count(distinct s.pseudo_id)::int FROM sig s
             WHERE s.d = d.day) AS active_unique,
          (SELECT count(*)::int FROM last_act_per_day lap
             WHERE lap.day = d.day AND lap.last_active_d = d.day - 14) AS went_dormant,
          (SELECT count(*)::int FROM public.v_client_users v
             WHERE (v.registered_at AT TIME ZONE v_tz)::date <= d.day) AS cumulative_clients,
          (SELECT count(distinct t.user_id)::int FROM public.transactions t
             JOIN public.v_client_users v ON v.user_id = t.user_id
             WHERE (t.created_at AT TIME ZONE v_tz)::date = d.day
               AND NOT EXISTS (
                 SELECT 1 FROM public.transactions t2
                 WHERE t2.user_id = t.user_id
                   AND (t2.created_at AT TIME ZONE v_tz)::date < d.day
               )) AS first_financial_action
        FROM days d
      ) x
    ),
    'totals', jsonb_build_object(
      'new_clients', (SELECT count(*)::int FROM public.v_client_users v
        WHERE (v.registered_at AT TIME ZONE v_tz)::date BETWEEN v_from AND v_to),
      'activated_period', (
        SELECT count(*)::int FROM (
          SELECT e.pseudo_id AS pseudo_id, min((e.occurred_at AT TIME ZONE v_tz)::date) AS first_d
          FROM public.product_events e
          JOIN public.v_client_pseudonyms cp ON cp.pseudo_id = e.pseudo_id
          WHERE e.event_name = ANY (v_activity) AND e.event_source = 'live'
          GROUP BY e.pseudo_id
        ) fs WHERE fs.first_d BETWEEN v_from AND v_to
      )
    ),
    'period', jsonb_build_object('from', v_from, 'to', v_to, 'timezone', v_tz),
    'sample_size', v_sample,
    'sufficient_sample', v_sample >= 10,
    'formula_version', 'daily.evolution.v2',
    'universe','clients_only',
    'measured_at', now()
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_v2_growth_summary(_from date, _to date, _tz text DEFAULT 'America/Sao_Paulo'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tz text := coalesce(_tz, 'America/Sao_Paulo');
  v_from date := coalesce(_from, ((now() AT TIME ZONE v_tz)::date - 29));
  v_to date := coalesce(_to, (now() AT TIME ZONE v_tz)::date);
  v_start timestamptz;
  v_end timestamptz;
  v_activity text[] := public.activity_events();
BEGIN
  PERFORM public._require_perm('growth.read');
  IF (v_to - v_from) > 365 THEN
    RAISE EXCEPTION 'invalid_parameter_value: range excede 365 dias';
  END IF;
  IF v_to < v_from THEN
    RAISE EXCEPTION 'invalid_parameter_value: _to menor que _from';
  END IF;
  v_start := (v_from::text || ' 00:00:00')::timestamp AT TIME ZONE v_tz;
  v_end   := ((v_to + 1)::text || ' 00:00:00')::timestamp AT TIME ZONE v_tz;

  RETURN jsonb_build_object(
    'total_clients', (SELECT count(*)::int FROM public.v_client_users),
    'new_clients', (SELECT count(*)::int FROM public.v_client_users v
      WHERE v.registered_at >= v_start AND v.registered_at < v_end),
    'active_clients', (SELECT count(distinct e.pseudo_id)::int
      FROM public.product_events e
      JOIN public.v_client_pseudonyms cp ON cp.pseudo_id = e.pseudo_id
      WHERE e.occurred_at >= v_start AND e.occurred_at < v_end
        AND e.event_name = ANY (v_activity)
        AND e.event_source = 'live'),
    'activated_clients', (
      SELECT count(*)::int FROM (
        SELECT e.pseudo_id AS pseudo_id, min(e.occurred_at) AS first_at
        FROM public.product_events e
        JOIN public.v_client_pseudonyms cp ON cp.pseudo_id = e.pseudo_id
        WHERE e.event_name = ANY (v_activity)
          AND e.event_source = 'live'
        GROUP BY e.pseudo_id
      ) fs WHERE fs.first_at >= v_start AND fs.first_at < v_end
    ),
    'dormant_clients', (SELECT count(*)::int FROM public.v_client_users v
      WHERE NOT EXISTS (
        SELECT 1 FROM public.product_events e
        WHERE e.pseudo_id = v.pseudo_id
          AND e.event_name = ANY (v_activity)
          AND e.event_source = 'live'
          AND e.occurred_at >= v_end - interval '14 days'
          AND e.occurred_at < v_end
      )),
    'with_financial_data', (SELECT count(distinct t.user_id)::int
      FROM public.transactions t
      JOIN public.v_client_users v ON v.user_id = t.user_id),
    'period', jsonb_build_object('from', v_from, 'to', v_to, 'timezone', v_tz),
    'universe','clients_only',
    'formula_version','growth.summary.v3',
    'measured_at', now()
  );
END; $function$;