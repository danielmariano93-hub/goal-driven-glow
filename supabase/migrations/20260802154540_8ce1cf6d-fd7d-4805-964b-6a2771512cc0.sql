-- Auditoria de conciliação de cartão + heartbeat do job de limpeza.

CREATE OR REPLACE FUNCTION public.audit_card_reconciliation(_user_id uuid DEFAULT auth.uid())
RETURNS TABLE (
  credit_card_id uuid,
  competence_month text,
  statement_status text,
  stated_total numeric,
  reconciled_total numeric,
  outstanding_amount numeric,
  items_total numeric,
  residual numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.credit_card_id,
    s.competence_month::text,
    s.status::text,
    COALESCE(s.stated_total, 0)::numeric,
    COALESCE(s.reconciled_total, 0)::numeric,
    COALESCE(s.outstanding_amount, 0)::numeric,
    COALESCE(i.items_total, 0)::numeric,
    ROUND(COALESCE(s.stated_total, 0)::numeric - COALESCE(i.items_total, 0)::numeric, 2)
  FROM public.credit_card_statements s
  LEFT JOIN (
    SELECT statement_id, SUM(amount)::numeric AS items_total
    FROM public.credit_card_statement_items
    GROUP BY statement_id
  ) i ON i.statement_id = s.id
  WHERE s.user_id = COALESCE(_user_id, auth.uid())
    AND (COALESCE(_user_id, auth.uid()) = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  ORDER BY s.competence_month DESC, s.credit_card_id;
$$;

REVOKE ALL ON FUNCTION public.audit_card_reconciliation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_card_reconciliation(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.audit_card_reconciliation(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.product_events_prune(_days integer DEFAULT 180)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed integer := 0;
  retention integer := GREATEST(COALESCE(_days, 180), 30);
BEGIN
  DELETE FROM public.product_events
  WHERE occurred_at < now() - (retention || ' days')::interval;
  GET DIAGNOSTICS removed = ROW_COUNT;

  INSERT INTO public.job_heartbeats (job_key, last_run_at, last_ok, processed, failed, last_error_code)
  VALUES ('product_events_prune', now(), now(), removed, 0, NULL)
  ON CONFLICT (job_key) DO UPDATE
    SET last_run_at = now(),
        last_ok = now(),
        processed = EXCLUDED.processed,
        failed = 0,
        last_error_code = NULL;

  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.product_events_prune(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.product_events_prune(integer) FROM anon;
REVOKE ALL ON FUNCTION public.product_events_prune(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.product_events_prune(integer) TO service_role;