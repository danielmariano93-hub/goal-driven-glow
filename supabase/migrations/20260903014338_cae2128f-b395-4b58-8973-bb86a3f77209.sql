-- Reconciliação de dívida também cobre dívidas quitadas e sugestões órfãs.
CREATE OR REPLACE FUNCTION public.nino_reconcile_debt_situations(
  _user_id uuid,
  _as_of date DEFAULT CURRENT_DATE
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_owner uuid;
  v_keys text[] := '{}';
  v_sit_ids uuid[] := '{}';
  v_debt_ids uuid[] := '{}';
  v_closed int := 0;
BEGIN
  v_owner := coalesce(_user_id, auth.uid());
  IF v_owner IS NULL THEN RETURN 0; END IF;
  IF auth.uid() IS NOT NULL AND v_owner <> auth.uid() THEN RETURN 0; END IF;

  -- Obrigações que NÃO são mais cobrança: ciclo corrente pago (motor canônico)
  -- ou dívida encerrada/sem saldo.
  SELECT coalesce(array_agg(d), '{}') INTO v_debt_ids
    FROM (
      SELECT st.debt_id AS d
        FROM public.debt_obligation_state(v_owner, _as_of, 7) st
       WHERE coalesce(st.current_cycle_status, 'unknown') = 'paid'
      UNION
      SELECT x.id
        FROM public.debts x
       WHERE x.user_id = v_owner
         AND (x.status <> 'active' OR coalesce(x.outstanding_balance, 0) <= 0)
    ) s;

  IF array_length(v_debt_ids, 1) IS NOT NULL THEN
    SELECT coalesce(array_agg(k), '{}') INTO v_keys
      FROM (
        SELECT 'debt_due_soon:' || d::text AS k FROM unnest(v_debt_ids) d
        UNION ALL SELECT 'debt_overdue:' || d::text FROM unnest(v_debt_ids) d
        UNION ALL SELECT 'future:debt:' || d::text FROM unnest(v_debt_ids) d
      ) x;

    WITH closed AS (
      UPDATE public.financial_situations s
         SET status = 'expired', resolved_at = now(), updated_at = now()
       WHERE s.user_id = v_owner
         AND s.status NOT IN ('expired', 'resolved', 'suppressed')
         AND s.situation_key = ANY(v_keys)
      RETURNING s.id
    )
    SELECT coalesce(array_agg(id), '{}'), count(*)::int
      INTO v_sit_ids, v_closed
      FROM closed;

    UPDATE public.nino_intelligence_items i
       SET status = 'expired', updated_at = now()
     WHERE i.user_id = v_owner
       AND i.status IN ('candidate', 'active')
       AND (
         EXISTS (SELECT 1 FROM unnest(v_sit_ids) s WHERE i.dedup_key = 'diagnosis:situation:' || s::text)
         OR EXISTS (SELECT 1 FROM unnest(v_keys) k WHERE i.logical_topic_key = 'situation:' || k)
       );

    UPDATE public.pending_proactive_suggestions p
       SET status = 'dismissed', dismissed_at = now(), defer_reason = 'debt_cycle_paid'
     WHERE p.user_id = v_owner
       AND p.status = 'pending'
       AND (
         EXISTS (SELECT 1 FROM unnest(v_sit_ids) s WHERE p.dedup_key = 'diagnosis:situation:' || s::text)
         OR EXISTS (SELECT 1 FROM unnest(v_keys) k WHERE p.dedup_key = 'diagnosis:' || k OR p.logical_dedup_key = k)
         OR EXISTS (SELECT 1 FROM unnest(v_debt_ids) d
                     WHERE p.dedup_key LIKE '%debt_due:' || d::text
                        OR p.dedup_key LIKE '%debt_due_soon:' || d::text
                        OR p.dedup_key LIKE '%debt_overdue:' || d::text)
       );

    DELETE FROM public.proactive_signals ps
     WHERE ps.user_id = v_owner
       AND ps.as_of >= _as_of - 1
       AND (
         EXISTS (SELECT 1 FROM unnest(v_debt_ids) d WHERE ps.signal_key = 'debt_due:' || d::text)
         OR EXISTS (SELECT 1 FROM unnest(v_sit_ids) s WHERE ps.signal_key = 'diagnosis:' || s::text)
       );

    DELETE FROM public.proactive_situations pst
     WHERE pst.user_id = v_owner
       AND pst.as_of >= _as_of - 1
       AND pst.last_delivered_at IS NULL
       AND EXISTS (
         SELECT 1 FROM unnest(v_debt_ids) d
          WHERE pst.fingerprint LIKE '%' || d::text || '%'
       );
  END IF;

  -- Sugestão órfã: a situação de dívida que a originou já não está ativa.
  UPDATE public.pending_proactive_suggestions p
     SET status = 'dismissed', dismissed_at = now(), defer_reason = 'debt_situation_not_active'
   WHERE p.user_id = v_owner
     AND p.status = 'pending'
     AND (
       p.dedup_key LIKE '%debt_due_soon:%'
       OR p.dedup_key LIKE '%debt_overdue:%'
       OR p.dedup_key LIKE '%future:debt:%'
       OR p.dedup_key LIKE '%debt_due:%'
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.financial_situations s
        WHERE s.user_id = v_owner
          AND s.status = 'active'
          AND (
            p.dedup_key = 'diagnosis:situation:' || s.id::text
            OR p.dedup_key = 'diagnosis:' || s.situation_key
            OR p.logical_dedup_key = s.situation_key
            OR (p.dedup_key LIKE '%debt_due:%'
                AND s.situation_key = 'debt_due_soon:' || split_part(p.dedup_key, 'debt_due:', 2))
          )
     );

  RETURN v_closed;
END;
$$;

REVOKE ALL ON FUNCTION public.nino_reconcile_debt_situations(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nino_reconcile_debt_situations(uuid, date) TO authenticated, service_role;

DO $$
DECLARE u uuid;
BEGIN
  FOR u IN SELECT DISTINCT user_id FROM public.debts LOOP
    PERFORM public.nino_reconcile_debt_situations(u, CURRENT_DATE);
  END LOOP;
END $$;