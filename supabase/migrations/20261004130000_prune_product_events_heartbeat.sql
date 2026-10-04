-- A limpeza diária de product_events rodava (cron ok) mas nunca gravava heartbeat,
-- então o painel admin a mostrava como "sem execução comprovada".
CREATE OR REPLACE FUNCTION public.prune_product_events(_days integer DEFAULT 90)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted int;
BEGIN
  -- Bypass do trigger append-only usando session_replication_role apenas para prune (owner)
  SET LOCAL session_replication_role = replica;
  DELETE FROM public.product_events WHERE occurred_at < now() - make_interval(days => _days);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  SET LOCAL session_replication_role = origin;

  INSERT INTO public.job_heartbeats(job_key, last_run_at, last_ok, last_error_code, processed, failed)
  VALUES ('product_events_prune', now(), true, null, v_deleted, 0)
  ON CONFLICT (job_key) DO UPDATE
    SET last_run_at = excluded.last_run_at, last_ok = true, last_error_code = null,
        processed = excluded.processed, failed = 0, updated_at = now();
  RETURN v_deleted;
END;
$function$;
